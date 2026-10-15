"""Search index lifecycle: request, build, readiness.

A request is idempotent and cheap: it records a generation for the bound
revision and admits one durable job, never embedding inline. The job builds
the documents, reuses cached vectors, embeds the rest in committed batches and
declares the generation ready only when every record is covered. It never
touches the AGE graph, the binding or the population rows, so an embedding
outage cannot break population or the graph.

A generation is built incrementally when it can be (``incremental.py``): the records unchanged since the
model's previous ready generation are copied from it, and only the others are built and embedded. Else it
is built in full, and the generation records why.

The vector indexes (HNSW) of a generation are not maintained row by row while it is filled: they are built
once, in bulk, after the last vector is stored and before the generation is ready (``vector_indexes.py``).

A generation is built with index settings (card and passage sizes, per-field
overrides) recorded on it and named by its fingerprint: other settings make
another generation. A request without settings (after a population run) reuses
the settings of the model's latest generation.

How a generation is built (embedding batch size, parallel calls, timeout, records per page) is not
part of those settings: ``IndexBuildSettings`` travel with the job and never change a fingerprint.
A build can be stopped; it then ends ``failed`` with the error code ``cancelled`` and only an
explicit request (never a search or a data hook) builds it again.
"""

from __future__ import annotations

import asyncio
import logging
import time
from functools import partial
from functools import wraps
from typing import Any, Awaitable, Callable

import httpx

from app.jobs.models import JobCommand
from app.jobs.service import INDEX_BUILD_PAYLOAD_KEY
from app.persistence import graph_search_store as search_store
from app.persistence import population_store
from app.population.age_projection import is_live_projection_ref
from app.population.compiler import compile_specification
from app.workers.celery_app import SEARCH_QUEUES

from . import incremental
from .documents import MAX_LINKED_NAMES, build_document
from .embeddings import EmbeddingError, EmbeddingProfile, embed, profile_from_env, vector_literal
from .settings import IndexBuildSettings, IndexSettings, ValidationError, index_fingerprint

logger = logging.getLogger(__name__)

INDEX_JOB_TYPE = "graph_search.index"
INDEX_TASK_NAME = "semantic-model-search.index"
# Index jobs belong to no person: one job per generation attempt, whoever asked.
SYSTEM_ACTOR = "system:graph-search"
GENERATION_LEASE_SECONDS = 300
# Records read and written per step of a build.
ENTITY_PAGE_SIZE = 5000
# While a vector index is built (one long statement), how often the build renews its lease and reports.
VECTOR_INDEX_HEARTBEAT_SECONDS = 20
# A generation stopped on request: failed, but a search or a data hook does not restart it.
CANCELLED_CODE = "cancelled"
TERMINAL_JOB_STATES = ("completed", "completed_with_gaps", "failed", "cancelled", "superseded")


class IndexUnavailable(RuntimeError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def stored_settings(value: Any) -> IndexSettings:
    """Index settings as recorded on a generation; unreadable ones count as the defaults."""
    if not value:
        return IndexSettings()
    try:
        return IndexSettings.model_validate(value)
    except ValidationError:
        logger.warning("Unreadable search index settings; defaults used")
        return IndexSettings()


async def settings_for_revision(pool: Any, revision_id: str, profile: EmbeddingProfile,
                                settings: IndexSettings | None) -> IndexSettings:
    """``settings`` when given, else those of the model's latest generation (defaults if none)."""
    if settings is not None:
        return settings
    revision = await population_store.get_data_revision(pool, revision_id)
    if revision is None:
        return IndexSettings()
    return stored_settings(await search_store.latest_index_settings(pool, revision["model_id"], profile.fingerprint))


async def request_index(pool: Any, admit: Callable[..., Awaitable[Any]] | None, *,
                        revision_id: str, settings: IndexSettings | None = None,
                        build: IndexBuildSettings | None = None, explicit: bool = True) -> dict[str, Any]:
    """Make sure the revision has (or is getting) a search index for the current profile and
    index settings (None: the model's latest ones).

    ``admit`` is ``JobService.admit``; None only reads the current state. ``build`` (performance
    knobs, see ``IndexBuildSettings``) goes with the job. A generation stopped on request is built
    again only when ``explicit``.
    Returns ``{"generation": row | None, "jobId": str | None, "fingerprint": str}``.
    """
    profile = profile_from_env()
    if profile is None:
        raise IndexUnavailable("embedding_not_configured")
    settings = await settings_for_revision(pool, revision_id, profile, settings)
    fingerprint = index_fingerprint(profile.fingerprint, settings)
    requested = await _request(pool, admit, revision_id, settings, fingerprint, profile.vector_fingerprint,
                               build, explicit)
    return {**requested, "fingerprint": fingerprint}


async def _request(pool: Any, admit: Callable[..., Awaitable[Any]] | None, revision_id: str,
                   settings: IndexSettings, fingerprint: str, vector_fingerprint: str,
                   build: IndexBuildSettings | None = None, explicit: bool = True) -> dict[str, Any]:
    generation = await search_store.get_generation(pool, revision_id, fingerprint)
    if admit is None or (generation is not None and generation["state"] == "ready"):
        return {"generation": generation, "jobId": generation["job_id"] if generation else None}
    if generation is None:
        revision = await population_store.get_data_revision(pool, revision_id)
        if revision is None or revision["validation_state"] != "valid":
            raise IndexUnavailable("revision_not_valid")
        if not is_live_projection_ref(revision["projection_ref"]):
            raise IndexUnavailable("revision_not_projected")
        generation = await search_store.create_generation(
            pool, model_id=revision["model_id"], data_revision_id=revision_id,
            projection_ref=revision["projection_ref"], spec_hash=revision["spec_hash"],
            fingerprint=fingerprint, index_settings=None if settings.is_default() else settings.canonical(),
            vector_fingerprint=vector_fingerprint)
    if (not explicit and generation["state"] == "failed"
            and generation.get("last_error_code") == CANCELLED_CODE):
        return {"generation": generation, "jobId": generation["job_id"]}
    for _ in range(3):
        if generation["state"] == "failed":
            generation = await search_store.retry_generation(pool, generation["index_id"]) \
                or await search_store.get_generation_by_id(pool, generation["index_id"])
        if generation is None or generation["state"] in ("ready", "failed"):
            break
        admission = await admit(
            job_type=INDEX_JOB_TYPE,
            command=JobCommand(actorUserId=SYSTEM_ACTOR, modelId=generation["model_id"],
                               payload={"indexId": generation["index_id"],
                                        "dataRevisionId": revision_id,
                                        **({INDEX_BUILD_PAYLOAD_KEY: build.given()} if build and build.given() else {})}),
            idempotency_key=f"gsi:{generation['index_id']}:{generation['attempt']}",
            task_name=INDEX_TASK_NAME, queue_name=SEARCH_QUEUES[0])
        if admission.reused and admission.state in TERMINAL_JOB_STATES:
            # The job of this attempt ended without finishing the generation: start a new attempt.
            await search_store.fail_generation(pool, generation["index_id"], "job_ended")
            generation = await search_store.get_generation_by_id(pool, generation["index_id"])
            continue
        await search_store.set_generation_job(pool, generation["index_id"], generation["attempt"],
                                              admission.job_id)
        generation = await search_store.get_generation_by_id(pool, generation["index_id"])
        return {"generation": generation, "jobId": admission.job_id}
    return {"generation": generation, "jobId": generation["job_id"] if generation else None}


async def request_index_quietly(pool: Any, admit: Callable[..., Awaitable[Any]] | None,
                                revision_id: str, settings: IndexSettings | None = None,
                                build: IndexBuildSettings | None = None) -> None:
    """Hook form: a search index that cannot be requested never fails the caller, and one stopped
    on request is left stopped."""
    try:
        await request_index(pool, admit, revision_id=revision_id, settings=settings, build=build,
                            explicit=False)
    except IndexUnavailable as exc:
        logger.info("Search index not requested for %s: %s", revision_id, exc.code)
    except Exception as exc:
        logger.warning("Search index request failed for %s: %s", revision_id, type(exc).__name__)


async def _stopped(pool: Any, index_id: str, owner: str) -> dict[str, Any]:
    """End the build on request: the generation fails with ``cancelled`` and keeps what is embedded."""
    await search_store.fail_generation(pool, index_id, CANCELLED_CODE, owner)
    return {"state": "cancelled"}


def build_lease_seconds(profile: EmbeddingProfile) -> int:
    """How long a build's leases last between renewals: the default, or longer for a long call timeout
    (a wave of embedding calls is as slow as its slowest one)."""
    return max(GENERATION_LEASE_SECONDS, int(profile.timeout_seconds) + 120)


async def _embed_pending(pool: Any, *, index_id: str, owner: str, model_id: str, profile: EmbeddingProfile,
                         embedder: Callable[..., Awaitable[list[list[float]]]] | None, lease_seconds: int,
                         progress: dict[str, Any], record: Callable[[], Awaitable[None]],
                         report: Callable[[dict[str, Any]], Awaitable[None]],
                         should_stop: Callable[[], Awaitable[bool]] | None) -> str | None:
    """Embed what is pending (records first, then passages), ``profile.parallel_calls`` batches at a
    time. Each wave reads ``parallel_calls * batch_size`` pending rows once and splits them into
    distinct batches: this job is the only one writing the generation (it holds its lease), so no row
    is embedded twice, and a stored batch leaves the pending rows, so a crash resumes with the rest.
    Returns None when nothing is pending, else ``lease_lost`` or ``cancelled``."""
    client = httpx.AsyncClient(timeout=profile.timeout_seconds) if embedder is None else None
    call = embedder or partial(embed, client=client)

    async def embed_batch(kind: str, batch: list[dict[str, Any]]) -> None:
        vectors = await call(profile, [row["search_text"] for row in batch])
        if kind == "documents":
            await search_store.store_vectors(
                pool, index_id=index_id, model_id=model_id, fingerprint=profile.vector_fingerprint,
                vectors=[(row["entity_id"], row["content_hash"], vector_literal(vector))
                         for row, vector in zip(batch, vectors)])
            progress["embedded"] += len(batch)
        else:
            await search_store.store_passage_vectors(
                pool, index_id=index_id, model_id=model_id, fingerprint=profile.vector_fingerprint,
                vectors=[(row["entity_id"], row["ordinal"], row["content_hash"], vector_literal(vector))
                         for row, vector in zip(batch, vectors)])
            progress["passagesEmbedded"] += len(batch)

    size = profile.batch_size
    try:
        for kind in ("documents", "passages"):
            pending = search_store.pending_documents if kind == "documents" else search_store.pending_passages
            while True:
                if should_stop is not None and await should_stop():
                    return "cancelled"
                rows = await pending(pool, index_id, size * profile.parallel_calls)
                if not rows:
                    break
                batches = [rows[start:start + size] for start in range(0, len(rows), size)]
                outcomes = await asyncio.gather(*(embed_batch(kind, batch) for batch in batches),
                                                return_exceptions=True)
                # Finished batches are stored; the error that cannot pass (not retryable) wins.
                failures = [outcome for outcome in outcomes if isinstance(outcome, BaseException)]
                if failures:
                    raise min(failures, key=lambda error: isinstance(error, EmbeddingError) and error.retryable)
                if not await search_store.renew_generation(pool, index_id, owner, lease_seconds, len(batches)):
                    return "lease_lost"
                await record()
                await report(dict(progress))
    finally:
        if client is not None:
            await client.aclose()
    return None


async def _index_vectors(pool: Any, *, index_id: str, owner: str, lease_seconds: int, progress: dict[str, Any],
                         report: Callable[[dict[str, Any]], Awaitable[None]],
                         should_stop: Callable[[], Awaitable[bool]] | None) -> str | None:
    """Build the generation's HNSW indexes (``vector_indexes``). One statement per index cannot be
    chunked, so while it runs the build keeps its lease and its progress clock alive every
    ``VECTOR_INDEX_HEARTBEAT_SECONDS`` and can still be stopped: the statement is then cancelled (it leaves
    no index) and a later attempt starts it again. Returns None when the indexes exist, else
    ``cancelled`` or ``lease_lost``."""
    building = asyncio.ensure_future(search_store.build_vector_indexes(pool, index_id))
    try:
        while True:
            done, _ = await asyncio.wait({building}, timeout=VECTOR_INDEX_HEARTBEAT_SECONDS)
            if done:
                building.result()
                return None
            if should_stop is not None and await should_stop():
                halt = "cancelled"
            elif not await search_store.renew_generation(pool, index_id, owner, lease_seconds, 0):
                halt = "lease_lost"
            else:
                await report(dict(progress))
                continue
            building.cancel()
            await asyncio.gather(building, return_exceptions=True)
            return halt
    finally:
        if not building.done():
            building.cancel()
            await asyncio.gather(building, return_exceptions=True)


async def _reuse_cached(pool: Any, *, index_id: str, owner: str, model_id: str, profile: EmbeddingProfile,
                        lease_seconds: int, loaded: int, expected: int, passages: int,
                        report: Callable[[dict[str, Any]], Awaitable[None]],
                        should_stop: Callable[[], Awaitable[bool]] | None) -> dict[str, Any]:
    """Fill what the vector cache already holds (records, then passages), chunk by chunk, so the build
    shows ``reusing`` instead of a finished read it seems stuck at, keeps its lease, and can be stopped.
    ``halt``: None, ``cancelled`` or ``lease_lost``."""
    done = {"reused": 0, "passagesReused": 0, "halt": None}

    async def after_chunk(kind: str, count: int) -> bool:
        done["reused" if kind == "documents" else "passagesReused"] = count
        if should_stop is not None and await should_stop():
            done["halt"] = "cancelled"
            return False
        if not await search_store.renew_generation(pool, index_id, owner, lease_seconds, 0):
            done["halt"] = "lease_lost"
            return False
        await search_store.record_progress(
            pool, index_id, owner, stage="reusing", loaded=loaded, expected=expected,
            indexed=done["reused"], passages=passages, passages_indexed=done["passagesReused"])
        await report({"stage": "reusing", "expected": expected, "loaded": loaded, "reused": done["reused"],
                      "passages": passages, "passagesReused": done["passagesReused"]})
        return True

    # Shown before the first chunk: finding what is cached may itself take a moment on a large revision.
    await search_store.record_progress(pool, index_id, owner, stage="reusing", loaded=loaded, expected=expected,
                                       passages=passages)
    await report({"stage": "reusing", "expected": expected, "loaded": loaded, "reused": 0,
                  "passages": passages, "passagesReused": 0})
    for kind in ("documents", "passages"):
        await search_store.fill_from_cache(pool, index_id, model_id, profile.cache_fingerprints, kind=kind,
                                           on_chunk=partial(after_chunk, kind))
        if done["halt"]:
            break
    return done


async def _write_cards(pool: Any, *, generation: dict[str, Any], owner: str, concepts: dict[str, Any],
                       settings: IndexSettings, expected: int, page_size: int, lease_seconds: int,
                       report: Callable[[dict[str, Any]], Awaitable[None]],
                       should_stop: Callable[[], Awaitable[bool]] | None,
                       mode: dict[str, Any]) -> tuple[dict[str, Any] | None, int, int]:
    """Write the generation's cards and passages: carried over from the previous generation where they did
    not change, built from the records otherwise (see ``incremental``). ``mode`` receives the path taken and
    the counts. Returns ``(outcome, records, passages)``: an outcome when the build ends here (stopped, or the
    lease lost), else the records and passages the generation now holds."""
    index_id, revision_id = generation["index_id"], generation["data_revision_id"]

    async def checkpoint(stage: str, *, loaded: int, **counts: int) -> None:
        """Between steps of an incremental build: stop if asked to, keep the lease, show where it is."""
        if should_stop is not None and await should_stop():
            raise incremental.BuildHalt("cancelled")
        if not await search_store.renew_generation(pool, index_id, owner, lease_seconds, 0):
            raise incremental.BuildHalt("lease_lost")
        await search_store.record_progress(pool, index_id, owner, stage=stage, loaded=loaded, expected=expected,
                                           **{key: value for key, value in counts.items() if key in ("carried", "rebuilt")})
        await report({"stage": stage, "expected": expected, "loaded": loaded,
                      **({"mode": mode["mode"]} if mode["mode"] else {}), **counts})

    async def write_page(entities: list[dict[str, Any]]) -> int:
        """Build, digest and store the cards (and passages) of these records; returns the passages."""
        ids = [entity["entityId"] for entity in entities]
        # The names of their linked records go on their cards (only those read from no other workspace).
        linked = await search_store.linked_names(pool, revision_id, ids, MAX_LINKED_NAMES)
        digests = await search_store.entity_digests(pool, revision_id, ids)
        documents = [{**build_document(entity, concepts.get(entity["conceptId"]), settings,
                                       links=[{**link, "concept": (concepts.get(link["conceptId"]) or {}).get("label")}
                                              for link in linked.get(entity["entityId"], [])]),
                      "sourceDigest": digests.get(entity["entityId"])}
                     for entity in entities]
        await search_store.insert_documents(pool, index_id, documents)
        return await search_store.insert_passages(pool, index_id, documents)

    loaded = passages = 0
    digest = incremental.card_digest(concepts)
    await search_store.record_progress(pool, index_id, owner, stage="comparing", loaded=0, expected=expected)
    try:
        plan = await incremental.plan_build(pool, generation=generation, digest=digest, expected=expected,
                                            page_size=page_size, checkpoint=checkpoint)
        mode.update(mode=plan.mode, reason=plan.reason)
        await search_store.record_build_plan(pool, index_id, owner, card_digest=digest, mode=plan.mode,
                                             reason=plan.reason, carried_from=plan.previous_index_id)
        if plan.incremental:
            carried = await incremental.carry(pool, generation=generation, plan=plan, checkpoint=checkpoint)
            rebuilt = await incremental.rebuild(pool, generation=generation, plan=plan, carried=carried,
                                                page_size=page_size, write_page=write_page, checkpoint=checkpoint)
            mode.update(carried=carried, rebuilt=rebuilt)
            counts = await search_store.generation_counts(pool, index_id)
            return None, counts["total"], counts["passages"]
        await search_store.record_progress(pool, index_id, owner, stage="documents", loaded=0, expected=expected,
                                           carried=0, rebuilt=0)
        # A page of records at a time: a large mailbox gives hundreds of thousands of them.
        async for entities in population_store.iter_revision_entities(pool, revision_id, page_size):
            if should_stop is not None and await should_stop():
                return await _stopped(pool, index_id, owner), loaded, passages
            passages += await write_page(entities)
            loaded += len(entities)
            if not await search_store.renew_generation(pool, index_id, owner, lease_seconds, 0):
                return {"state": "lease_lost"}, loaded, passages
            await search_store.record_progress(pool, index_id, owner, stage="documents", loaded=loaded,
                                               expected=expected, passages=passages, rebuilt=loaded)
            await report({"stage": "documents", "expected": expected, "loaded": loaded, "passages": passages,
                          "mode": plan.mode, "reason": plan.reason})
        mode.update(rebuilt=loaded)
    except incremental.BuildHalt as halt:
        ended = await _stopped(pool, index_id, owner) if halt.reason == "cancelled" else {"state": halt.reason}
        return ended, loaded, passages
    return None, loaded, passages


def _with_generation_owner(function):
    @wraps(function)
    async def build(pool: Any, *, owner: str, **kwargs: Any):
        token = search_store._generation_owner.set(owner)
        try:
            return await function(pool, owner=owner, **kwargs)
        finally:
            search_store._generation_owner.reset(token)
    return build


@_with_generation_owner
async def build_index(pool: Any, *, index_id: str, owner: str,
                      report: Callable[[dict[str, Any]], Awaitable[None]],
                      profile: EmbeddingProfile | None = None,
                      embedder: Callable[..., Awaitable[list[list[float]]]] | None = None,
                      build: IndexBuildSettings | None = None,
                      should_stop: Callable[[], Awaitable[bool]] | None = None) -> dict[str, Any]:
    """Build one generation. Raises ``EmbeddingError`` (retryable or not) on provider failure,
    leaving finished batches committed so a retry resumes where this one stopped. ``build`` are the
    administrator's performance knobs over the environment's; ``should_stop`` is asked between pages
    and batches and ends the build as ``cancelled``."""
    profile = profile or profile_from_env()
    generation = await search_store.get_generation_by_id(pool, index_id)
    if generation is None:
        return {"state": "missing"}
    if generation["state"] == "ready":
        return {"state": "ready", "reused": True}
    settings = stored_settings(generation.get("index_settings"))
    if profile is None or index_fingerprint(profile.fingerprint, settings) != generation["embedding_fingerprint"]:
        await search_store.fail_generation(pool, index_id, "embedding_profile_changed")
        return {"state": "failed", "errorCode": "embedding_profile_changed"}
    profile = profile.with_build(build)
    page_size = (build.index_read_page_rows if build else None) or ENTITY_PAGE_SIZE
    lease_seconds = build_lease_seconds(profile)
    if not await search_store.claim_generation(pool, index_id, owner, lease_seconds):
        current = await search_store.get_generation_by_id(pool, index_id)
        return {"state": current["state"] if current else "missing", "busy": True}
    revision_id = generation["data_revision_id"]
    specification = await population_store.get_revision_specification(pool, revision_id)
    if specification is None:
        await search_store.fail_generation(pool, index_id, "revision_specification_not_found", owner)
        return {"state": "failed", "errorCode": "revision_specification_not_found"}
    concepts = compile_specification(specification)["concepts"]
    expected = (await population_store.count_revision_rows(pool, revision_id))["entities"]
    # How this attempt builds (None until chosen) and the records it carried over and built again.
    mode: dict[str, Any] = {"mode": None, "reason": None, "carried": 0, "rebuilt": 0}
    ended, loaded, passages = await _write_cards(
        pool, generation=generation, owner=owner, concepts=concepts, settings=settings, expected=expected,
        page_size=page_size, lease_seconds=lease_seconds, report=report, should_stop=should_stop, mode=mode)
    if ended is not None:
        return ended
    if expected != loaded:
        # The revision changed under the build: a later request builds it again.
        await search_store.fail_generation(pool, index_id, "revision_changed", owner)
        return {"state": "failed", "errorCode": "revision_changed"}
    model_id = generation["model_id"]
    reuse = await _reuse_cached(pool, index_id=index_id, owner=owner, model_id=model_id, profile=profile,
                                lease_seconds=lease_seconds, loaded=loaded, expected=expected, passages=passages,
                                report=report, should_stop=should_stop)
    if reuse["halt"] == "cancelled":
        return await _stopped(pool, index_id, owner)
    if reuse["halt"]:
        return {"state": reuse["halt"]}
    reused, passages_reused = reuse["reused"], reuse["passagesReused"]
    progress = {"stage": "embedding", "expected": expected, "reused": reused, "embedded": 0,
                "passages": passages, "passagesReused": passages_reused, "passagesEmbedded": 0,
                "mode": mode["mode"], "reason": mode["reason"], "carried": mode["carried"],
                "rebuilt": mode["rebuilt"]}
    await report(dict(progress))
    # What is already embedded (this attempt's cache hits, an earlier attempt's batches), counted once;
    # each batch then adds its own size.
    done = await search_store.generation_counts(pool, index_id)
    # Records embedded by every attempt at this generation: this one's batches add to the earlier ones'.
    embedded_before = int(generation.get("embedded_count") or 0)

    async def record_embedding() -> None:
        await search_store.record_progress(
            pool, index_id, owner, stage="embedding", loaded=loaded, expected=expected,
            indexed=done["ready"] + progress["embedded"], exact_only=done["exact_only"],
            passages=done["passages"], passages_indexed=done["passages_ready"] + progress["passagesEmbedded"],
            embedded=embedded_before + progress["embedded"])

    await record_embedding()
    stopped = await _embed_pending(
        pool, index_id=index_id, owner=owner, model_id=model_id, profile=profile, embedder=embedder,
        lease_seconds=lease_seconds, progress=progress, record=record_embedding, report=report,
        should_stop=should_stop)
    if stopped == "cancelled":
        return await _stopped(pool, index_id, owner)
    if stopped:
        return {"state": stopped}
    # Every vector is stored: the generation's vector indexes are built once, in bulk, and only then is it ready.
    indexing_started = time.monotonic()
    halted = await _index_vectors(pool, index_id=index_id, owner=owner, lease_seconds=lease_seconds,
                                  progress=progress, report=report, should_stop=should_stop)
    progress["vectorIndexSeconds"] = round(time.monotonic() - indexing_started, 1)
    if halted == "cancelled":
        return await _stopped(pool, index_id, owner)
    if halted:
        return {"state": halted}
    state = await search_store.finish_generation(pool, index_id, owner, expected)
    if state == "ready":
        await search_store.prune_generations(pool, model_id)
    return {"state": state, **{key: value for key, value in progress.items() if key != "stage"}}


__all__ = ["CANCELLED_CODE", "EmbeddingError", "build_lease_seconds", "IndexUnavailable", "build_index", "request_index",
           "request_index_quietly", "settings_for_revision", "stored_settings", "INDEX_JOB_TYPE", "INDEX_TASK_NAME", "SYSTEM_ACTOR"]
