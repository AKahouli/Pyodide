"""Search index lifecycle: request, build, readiness.

A request is idempotent and cheap: it records a generation for the bound
revision and admits one durable job, never embedding inline. The job builds
the documents, reuses cached vectors, embeds the rest in committed batches and
declares the generation ready only when every record is covered. It never
touches the AGE graph, the binding or the population rows, so an embedding
outage cannot break population or the graph.

A generation is built with index settings (card and passage sizes, per-field
overrides) recorded on it and named by its fingerprint: other settings make
another generation. A request without settings (after a population run) reuses
the settings of the model's latest generation.
"""

from __future__ import annotations

import logging
from typing import Any, Awaitable, Callable

from app.jobs.models import JobCommand
from app.persistence import graph_search_store as search_store
from app.persistence import population_store
from app.population.age_projection import is_live_projection_ref
from app.population.compiler import compile_specification
from app.workers.celery_app import SEARCH_QUEUES

from .documents import build_document
from .embeddings import EmbeddingError, EmbeddingProfile, embed, profile_from_env, vector_literal
from .settings import IndexSettings, ValidationError, index_fingerprint

logger = logging.getLogger(__name__)

INDEX_JOB_TYPE = "graph_search.index"
INDEX_TASK_NAME = "semantic-model-search.index"
# Index jobs belong to no person: one job per generation attempt, whoever asked.
SYSTEM_ACTOR = "system:graph-search"
GENERATION_LEASE_SECONDS = 300
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
                        revision_id: str, settings: IndexSettings | None = None) -> dict[str, Any]:
    """Make sure the revision has (or is getting) a search index for the current profile and
    index settings (None: the model's latest ones).

    ``admit`` is ``JobService.admit``; None only reads the current state.
    Returns ``{"generation": row | None, "jobId": str | None, "fingerprint": str}``.
    """
    profile = profile_from_env()
    if profile is None:
        raise IndexUnavailable("embedding_not_configured")
    settings = await settings_for_revision(pool, revision_id, profile, settings)
    fingerprint = index_fingerprint(profile.fingerprint, settings)
    requested = await _request(pool, admit, revision_id, settings, fingerprint)
    return {**requested, "fingerprint": fingerprint}


async def _request(pool: Any, admit: Callable[..., Awaitable[Any]] | None, revision_id: str,
                   settings: IndexSettings, fingerprint: str) -> dict[str, Any]:
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
            fingerprint=fingerprint, index_settings=None if settings.is_default() else settings.canonical())
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
                                        "dataRevisionId": revision_id}),
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
                                revision_id: str, settings: IndexSettings | None = None) -> None:
    """Hook form: a search index that cannot be requested never fails the caller."""
    try:
        await request_index(pool, admit, revision_id=revision_id, settings=settings)
    except IndexUnavailable as exc:
        logger.info("Search index not requested for %s: %s", revision_id, exc.code)
    except Exception as exc:
        logger.warning("Search index request failed for %s: %s", revision_id, type(exc).__name__)


async def build_index(pool: Any, *, index_id: str, owner: str,
                      report: Callable[[dict[str, Any]], Awaitable[None]],
                      profile: EmbeddingProfile | None = None,
                      embedder: Callable[..., Awaitable[list[list[float]]]] | None = None) -> dict[str, Any]:
    """Build one generation. Raises ``EmbeddingError`` (retryable or not) on provider failure,
    leaving finished batches committed so a retry resumes where this one stopped."""
    profile = profile or profile_from_env()
    embedder = embedder or embed
    generation = await search_store.get_generation_by_id(pool, index_id)
    if generation is None:
        return {"state": "missing"}
    if generation["state"] == "ready":
        return {"state": "ready", "reused": True}
    settings = stored_settings(generation.get("index_settings"))
    if profile is None or index_fingerprint(profile.fingerprint, settings) != generation["embedding_fingerprint"]:
        await search_store.fail_generation(pool, index_id, "embedding_profile_changed")
        return {"state": "failed", "errorCode": "embedding_profile_changed"}
    if not await search_store.claim_generation(pool, index_id, owner, GENERATION_LEASE_SECONDS):
        current = await search_store.get_generation_by_id(pool, index_id)
        return {"state": current["state"] if current else "missing", "busy": True}
    revision_id = generation["data_revision_id"]
    specification = await population_store.get_revision_specification(pool, revision_id)
    if specification is None:
        await search_store.fail_generation(pool, index_id, "revision_specification_not_found", owner)
        return {"state": "failed", "errorCode": "revision_specification_not_found"}
    concepts = compile_specification(specification)["concepts"]
    entities = await population_store.list_revision_entities(pool, revision_id)
    expected = (await population_store.count_revision_rows(pool, revision_id))["entities"]
    if expected != len(entities):
        await search_store.fail_generation(pool, index_id, "revision_too_large", owner)
        return {"state": "failed", "errorCode": "revision_too_large"}
    documents = [build_document(entity, concepts.get(entity["conceptId"]), settings) for entity in entities]
    await search_store.insert_documents(pool, index_id, documents)
    passages = await search_store.insert_passages(pool, index_id, documents)
    model_id = generation["model_id"]
    reused = await search_store.fill_from_cache(pool, index_id, model_id, profile.fingerprint)
    passages_reused = await search_store.fill_from_cache(pool, index_id, model_id, profile.fingerprint,
                                                         kind="passages")
    progress = {"stage": "embedding", "expected": expected, "reused": reused, "embedded": 0,
                "passages": passages, "passagesReused": passages_reused, "passagesEmbedded": 0}
    await report(dict(progress))
    # Records first (the cards answer most requests), then the passages of long fields.
    for kind in ("documents", "passages"):
        while True:
            if kind == "documents":
                batch = await search_store.pending_documents(pool, index_id, profile.batch_size)
            else:
                batch = await search_store.pending_passages(pool, index_id, profile.batch_size)
            if not batch:
                break
            vectors = await embedder(profile, [row["search_text"] for row in batch])
            if kind == "documents":
                await search_store.store_vectors(
                    pool, index_id=index_id, model_id=model_id, fingerprint=profile.fingerprint,
                    vectors=[(row["entity_id"], row["content_hash"], vector_literal(vector))
                             for row, vector in zip(batch, vectors)])
                progress["embedded"] += len(batch)
            else:
                await search_store.store_passage_vectors(
                    pool, index_id=index_id, model_id=model_id, fingerprint=profile.fingerprint,
                    vectors=[(row["entity_id"], row["ordinal"], row["content_hash"], vector_literal(vector))
                             for row, vector in zip(batch, vectors)])
                progress["passagesEmbedded"] += len(batch)
            if not await search_store.renew_generation(pool, index_id, owner, GENERATION_LEASE_SECONDS, 1):
                return {"state": "lease_lost"}
            await report(dict(progress))
    state = await search_store.finish_generation(pool, index_id, owner, expected)
    if state == "ready":
        await search_store.prune_generations(pool, model_id)
    return {"state": state, **{key: value for key, value in progress.items() if key != "stage"}}


__all__ = ["EmbeddingError", "IndexUnavailable", "build_index", "request_index",
           "request_index_quietly", "settings_for_revision", "stored_settings", "INDEX_JOB_TYPE", "INDEX_TASK_NAME", "SYSTEM_ACTOR"]
