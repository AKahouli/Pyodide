"""Search index build: parallel embedding waves, administrator build knobs, stopping a build."""

from __future__ import annotations

import asyncio
import os
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import HTTPException

from app.api import graph_search_routes as routes
from app.graph_search import indexer
from app.graph_search.embeddings import EmbeddingError, EmbeddingProfile
from app.graph_search.settings import IndexBuildSettings, IndexSettings, ValidationError, index_fingerprint
from app.jobs.models import JobCommand
from app.jobs.service import INDEX_BUILD_PAYLOAD_KEY, JobService, _identity_command
from app.population.run_limits import identity_limits, index_build_limits

PROFILE = EmbeddingProfile(base_url="http://embed.test", api_key="k", model="m", dimension=4, batch_size=2)
FINGERPRINT = index_fingerprint(PROFILE.fingerprint, IndexSettings())


class _Store:
    """The generation of one build, in memory: pending rows leave when their vectors are stored."""

    def __init__(self, documents: int, passages: int = 0) -> None:
        self.pending_docs = [f"e{n}" for n in range(documents)]
        self.pending_passages_ = [("e0", n) for n in range(passages)]
        self.documents, self.passages = documents, passages
        self.stored: list[str] = []
        self.stored_passages: list[tuple[str, int]] = []
        self.progress: list[dict[str, Any]] = []
        self.renewals: list[int] = []
        self.failed_with: tuple[str, str | None] | None = None

    async def get_generation_by_id(self, pool: Any, index_id: str) -> dict[str, Any]:
        return {"index_id": index_id, "state": "queued", "model_id": "m", "data_revision_id": "dr-1",
                "embedding_fingerprint": FINGERPRINT, "index_settings": None}

    async def claim_generation(self, *args: Any) -> bool:
        return True

    async def renew_generation(self, pool: Any, index_id: str, owner: str, lease: int, calls: int = 0) -> bool:
        self.renewals.append(calls)
        return True

    async def linked_names(self, *args: Any) -> dict[str, Any]:
        return {}

    async def insert_documents(self, *args: Any) -> None:
        return None

    async def insert_passages(self, pool: Any, index_id: str, documents: list[dict[str, Any]]) -> int:
        return 0

    async def fill_from_cache(self, *args: Any, **kwargs: Any) -> int:
        return 0

    async def generation_counts(self, *args: Any) -> dict[str, int]:
        ready = self.documents - len(self.pending_docs)
        return {"total": self.documents, "ready": ready, "exact_only": 0, "pending": len(self.pending_docs),
                "truncated": 0, "passages": self.passages,
                "passages_ready": self.passages - len(self.pending_passages_)}

    async def pending_documents(self, pool: Any, index_id: str, limit: int) -> list[dict[str, Any]]:
        return [{"entity_id": entity, "search_text": entity, "content_hash": "h"} for entity in self.pending_docs[:limit]]

    async def pending_passages(self, pool: Any, index_id: str, limit: int) -> list[dict[str, Any]]:
        return [{"entity_id": entity, "ordinal": ordinal, "search_text": f"{entity}/{ordinal}", "content_hash": "h"}
                for entity, ordinal in self.pending_passages_[:limit]]

    async def store_vectors(self, pool: Any, *, vectors: list[Any], **kwargs: Any) -> None:
        for entity, _, _ in vectors:
            self.pending_docs.remove(entity)
            self.stored.append(entity)

    async def store_passage_vectors(self, pool: Any, *, vectors: list[Any], **kwargs: Any) -> None:
        for entity, ordinal, _, _ in vectors:
            self.pending_passages_.remove((entity, ordinal))
            self.stored_passages.append((entity, ordinal))

    async def record_progress(self, pool: Any, index_id: str, owner: str, **fields: Any) -> None:
        self.progress.append(fields)

    async def build_vector_indexes(self, pool: Any, index_id: str, **kwargs: Any) -> dict[str, int]:
        self.indexed = getattr(self, "indexed", 0) + 1
        return {}

    async def finish_generation(self, pool: Any, index_id: str, owner: str, expected: int) -> str:
        return "ready" if not self.pending_docs and not self.pending_passages_ else "failed"

    async def fail_generation(self, pool: Any, index_id: str, code: str, owner: str | None = None) -> None:
        self.failed_with = (code, owner)

    async def prune_generations(self, *args: Any) -> int:
        return 0

    async def previous_ready_generation(self, *args: Any) -> None:
        return None

    async def entity_digests(self, *args: Any) -> dict[str, str]:
        return {}

    async def record_build_plan(self, pool: Any, index_id: str, owner: str, **fields: Any) -> None:
        self.plan = fields


def _patch(monkeypatch: pytest.MonkeyPatch, store: _Store, entities: int) -> None:
    async def pages(pool: Any, revision_id: str, size: int):  # type: ignore[no-untyped-def]
        pages.sizes.append(size)  # type: ignore[attr-defined]
        for start in range(0, entities, size):
            yield [{"entityId": f"e{n}", "conceptId": "c"} for n in range(start, min(start + size, entities))]

    pages.sizes = []  # type: ignore[attr-defined]

    async def count_rows(pool: Any, revision_id: str) -> dict[str, int]:
        return {"entities": entities}

    async def specification(pool: Any, revision_id: str) -> dict[str, Any]:
        return {}

    for name in ("get_generation_by_id", "claim_generation", "renew_generation", "linked_names", "insert_documents",
                 "insert_passages", "fill_from_cache", "generation_counts", "pending_documents", "pending_passages",
                 "store_vectors", "store_passage_vectors", "record_progress", "build_vector_indexes", "finish_generation",
                 "fail_generation", "prune_generations", "previous_ready_generation", "entity_digests",
                 "record_build_plan"):
        monkeypatch.setattr(indexer.search_store, name, getattr(store, name))
    monkeypatch.setattr(indexer.population_store, "iter_revision_entities", pages)
    monkeypatch.setattr(indexer.population_store, "count_revision_rows", count_rows)
    monkeypatch.setattr(indexer.population_store, "get_revision_specification", specification)
    monkeypatch.setattr(indexer, "compile_specification", lambda spec: {"concepts": {}})
    monkeypatch.setattr(indexer, "build_document",
                        lambda entity, concept, settings, links=None: {"passages": []})
    monkeypatch.setattr(_patch, "pages", pages, raising=False)


async def _report(progress: dict[str, Any]) -> None:
    return None


@pytest.mark.asyncio
async def test_parallel_waves_embed_every_row_once_with_the_calls_in_flight_together(monkeypatch: pytest.MonkeyPatch) -> None:
    store = _Store(documents=11, passages=5)
    _patch(monkeypatch, store, 11)
    in_flight = peak = 0
    texts: list[str] = []

    async def embedder(profile: Any, batch: list[str]) -> list[list[float]]:
        nonlocal in_flight, peak
        in_flight += 1
        peak = max(peak, in_flight)
        await asyncio.sleep(0.01)
        texts.extend(batch)
        in_flight -= 1
        assert len(batch) <= 2
        return [[0.0] * 4 for _ in batch]

    profile = EmbeddingProfile(**{**PROFILE.__dict__, "parallel_calls": 3})
    outcome = await indexer.build_index(object(), index_id="ix", owner="w", report=_report, profile=profile,
                                        embedder=embedder)

    assert outcome["state"] == "ready"
    assert peak == 3
    assert sorted(texts) == sorted([f"e{n}" for n in range(11)] + [f"e0/{n}" for n in range(5)])
    assert (outcome["embedded"], outcome["passagesEmbedded"]) == (11, 5)
    embedding = [p for p in store.progress if p["stage"] == "embedding"]
    # Progress counts what is stored, wave by wave: 6 per wave of 3 batches of 2 rows.
    assert [p["indexed"] for p in embedding] == [0, 6, 11, 11]
    assert [p["passages_indexed"] for p in embedding] == [0, 0, 0, 5]
    assert sum(store.renewals) == 6 + 3  # one embedding call per batch (11 rows -> 6 batches, 5 passages -> 3)


@pytest.mark.asyncio
async def test_a_build_without_a_previous_generation_is_full_and_says_so(monkeypatch: pytest.MonkeyPatch) -> None:
    store = _Store(documents=5)
    _patch(monkeypatch, store, 5)
    reports: list[dict[str, Any]] = []

    async def report(progress: dict[str, Any]) -> None:
        reports.append(progress)

    async def embedder(profile: Any, batch: list[str]) -> list[list[float]]:
        return [[0.0] * 4 for _ in batch]

    outcome = await indexer.build_index(object(), index_id="ix", owner="w", report=report, profile=PROFILE,
                                        embedder=embedder)
    assert outcome["state"] == "ready"
    assert (outcome["mode"], outcome["reason"], outcome["carried"], outcome["rebuilt"], outcome["embedded"]) == (
        "full", "no_previous_generation", 0, 5, 5)
    assert store.plan["mode"] == "full" and store.plan["reason"] == "no_previous_generation"
    assert store.plan["card_digest"].startswith("sha256:") and store.plan["carried_from"] is None
    # The progress of every step names the path once it is chosen, and the embedded count is recorded.
    assert all(report_["mode"] == "full" for report_ in reports if report_["stage"] == "documents")
    assert store.progress[-1]["embedded"] == 5
    assert [p["rebuilt"] for p in store.progress if p["stage"] == "documents"] == [0, 5]


@pytest.mark.asyncio
async def test_a_failing_batch_keeps_the_finished_ones_and_the_error_that_cannot_pass_wins(monkeypatch: pytest.MonkeyPatch) -> None:
    store = _Store(documents=6)
    _patch(monkeypatch, store, 6)

    async def embedder(profile: Any, batch: list[str]) -> list[list[float]]:
        if "e2" in batch:
            raise EmbeddingError("embedding_timeout", retryable=True)
        if "e4" in batch:
            raise EmbeddingError("embedding_http_400")
        return [[0.0] * 4 for _ in batch]

    profile = EmbeddingProfile(**{**PROFILE.__dict__, "parallel_calls": 3})
    with pytest.raises(EmbeddingError) as raised:
        await indexer.build_index(object(), index_id="ix", owner="w", report=_report, profile=profile,
                                  embedder=embedder)
    assert raised.value.code == "embedding_http_400"
    # The batch that went through is stored; a retry embeds only the other two.
    assert sorted(store.stored) == ["e0", "e1"]
    assert store.pending_docs == ["e2", "e3", "e4", "e5"]


@pytest.mark.asyncio
async def test_a_build_asked_to_stop_ends_between_batches_as_cancelled(monkeypatch: pytest.MonkeyPatch) -> None:
    store = _Store(documents=8)
    _patch(monkeypatch, store, 8)
    calls = 0

    async def embedder(profile: Any, batch: list[str]) -> list[list[float]]:
        return [[0.0] * 4 for _ in batch]

    async def should_stop() -> bool:
        nonlocal calls
        calls += 1
        return calls > 3  # pages of the documents stage first (1), then after one wave

    outcome = await indexer.build_index(object(), index_id="ix", owner="w", report=_report, profile=PROFILE,
                                        embedder=embedder, should_stop=should_stop)
    assert outcome == {"state": "cancelled"}
    assert store.failed_with == ("cancelled", "w")
    assert 0 < len(store.stored) < 8


@pytest.mark.asyncio
async def test_build_settings_override_the_profile_and_the_page_size_but_not_the_fingerprint(monkeypatch: pytest.MonkeyPatch) -> None:
    store = _Store(documents=4)
    _patch(monkeypatch, store, 4)
    seen: list[Any] = []

    async def embedder(profile: Any, batch: list[str]) -> list[list[float]]:
        seen.append(profile)
        return [[0.0] * 4 for _ in batch]

    build = IndexBuildSettings.model_validate({"embeddingBatchSize": 4, "embeddingParallelCalls": 2,
                                               "embeddingTimeoutSeconds": 90, "indexReadPageRows": 500})
    outcome = await indexer.build_index(object(), index_id="ix", owner="w", report=_report, profile=PROFILE,
                                        embedder=embedder, build=build)
    assert outcome["state"] == "ready"
    assert (seen[0].batch_size, seen[0].parallel_calls, seen[0].timeout_seconds) == (4, 2, 90.0)
    assert seen[0].fingerprint == PROFILE.fingerprint and seen[0].vector_fingerprint == PROFILE.vector_fingerprint
    assert _patch.pages.sizes == [500]  # type: ignore[attr-defined]
    assert len(seen) == 1  # one batch of 4 (a second would mean the batch size was ignored)


def test_build_settings_are_bounded_and_named_like_the_run_limits() -> None:
    assert IndexBuildSettings().given() == {}
    for name, bad in (("embeddingBatchSize", 257), ("embeddingBatchSize", 0), ("embeddingParallelCalls", 17),
                      ("embeddingTimeoutSeconds", 4), ("indexReadPageRows", 499), ("indexReadPageRows", 50001)):
        with pytest.raises(ValidationError):
            IndexBuildSettings.model_validate({name: bad})
    assert index_build_limits({"embeddingBatchSize": 64, "embeddingParallelCalls": 99, "saveBatchRows": 2000,
                               "indexReadPageRows": True}) == {"embeddingBatchSize": 64}
    assert index_build_limits(None) == {}


def test_profile_without_build_settings_keeps_the_environment_values(monkeypatch: pytest.MonkeyPatch) -> None:
    assert PROFILE.with_build(None) is PROFILE
    assert PROFILE.with_build(IndexBuildSettings()).batch_size == 2
    monkeypatch.setenv("SEMANTIC_EMBEDDING_BASE_URL", "http://x")
    monkeypatch.setenv("SEMANTIC_EMBEDDING_MODEL", "m")
    monkeypatch.delenv("SEMANTIC_EMBEDDING_PARALLEL_CALLS", raising=False)
    from app.graph_search.embeddings import profile_from_env
    assert profile_from_env().parallel_calls == 4  # type: ignore[union-attr]
    monkeypatch.setenv("SEMANTIC_EMBEDDING_PARALLEL_CALLS", "99")
    assert profile_from_env().parallel_calls == 16  # type: ignore[union-attr]


def test_the_build_knobs_are_not_part_of_a_runs_identity_or_a_jobs_hash() -> None:
    limits = {"maxRunSources": 40, "saveBatchRows": 5000, "embeddingBatchSize": 64, "indexReadPageRows": 1000}
    assert identity_limits(limits) == {"maxRunSources": 40}
    run = {"actorUserId": "u", "payload": {"limits": limits, "scope": "model"}}
    assert _identity_command(run)["payload"] == {"scope": "model", "limits": {"maxRunSources": 40}}
    only_knobs = {"actorUserId": "u", "payload": {"limits": {"embeddingParallelCalls": 8}, "x": 1}}
    assert _identity_command(only_knobs)["payload"] == {"x": 1}
    index_job = {"actorUserId": "u", "payload": {"indexId": "i", INDEX_BUILD_PAYLOAD_KEY: {"embeddingBatchSize": 8}}}
    assert _identity_command(index_job)["payload"] == {"indexId": "i"}
    untouched = {"actorUserId": "u", "payload": {"limits": {"maxRunSources": 40}}}
    assert _identity_command(untouched) is untouched


class _Repository:
    def __init__(self) -> None:
        self.hashes: list[str] = []

    async def admit(self, **kwargs: Any) -> Any:
        self.hashes.append(kwargs["command_hash"])
        return SimpleNamespace(job_id="job-1", reused=False, state="queued")


@pytest.mark.asyncio
async def test_two_index_requests_with_other_build_knobs_are_the_same_job_command() -> None:
    repository = _Repository()
    service = JobService(repository)  # type: ignore[arg-type]
    for knobs in ({}, {"embeddingBatchSize": 8}, {"embeddingBatchSize": 64, "embeddingParallelCalls": 2}):
        payload = {"indexId": "i", "dataRevisionId": "r", **({INDEX_BUILD_PAYLOAD_KEY: knobs} if knobs else {})}
        await service.admit(job_type="graph_search.index", command=JobCommand(actorUserId="s", modelId="m", payload=payload),
                            idempotency_key="k", task_name="t", queue_name="q")
    assert len(set(repository.hashes)) == 1


def _generation(**changes: Any) -> dict[str, Any]:
    return {"index_id": "ix", "model_id": "m", "state": "failed", "attempt": 1, "job_id": "job-0",
            "last_error_code": "cancelled", **changes}


@pytest.mark.asyncio
async def test_a_stopped_generation_is_rebuilt_by_an_explicit_request_only(monkeypatch: pytest.MonkeyPatch) -> None:
    generation = _generation()
    admitted: list[dict[str, Any]] = []

    async def get_generation(pool: Any, revision_id: str, fingerprint: str) -> dict[str, Any]:
        return generation

    async def retry_generation(pool: Any, index_id: str) -> dict[str, Any]:
        return {**generation, "state": "queued", "attempt": 2}

    async def get_by_id(pool: Any, index_id: str) -> dict[str, Any]:
        return {**generation, "state": "queued", "attempt": 2}

    async def set_job(*args: Any) -> None:
        return None

    async def admit(**kwargs: Any) -> Any:
        admitted.append(kwargs)
        return SimpleNamespace(job_id="job-2", reused=False, state="queued")

    for name, function in (("get_generation", get_generation), ("retry_generation", retry_generation),
                           ("get_generation_by_id", get_by_id), ("set_generation_job", set_job)):
        monkeypatch.setattr(indexer.search_store, name, function)
    build = IndexBuildSettings.model_validate({"embeddingParallelCalls": 8})

    quiet = await indexer._request(object(), admit, "r", IndexSettings(), "fp", "vec", build, explicit=False)
    assert admitted == [] and quiet["generation"]["state"] == "failed"

    explicit = await indexer._request(object(), admit, "r", IndexSettings(), "fp", "vec", build, explicit=True)
    assert explicit["jobId"] == "job-2"
    assert admitted[0]["command"].payload[INDEX_BUILD_PAYLOAD_KEY] == {"embeddingParallelCalls": 8}
    assert admitted[0]["idempotency_key"] == "gsi:ix:2"


def _row(**changes: Any) -> dict[str, Any]:
    return {"embedding_fingerprint": "f", "expected_count": 1, "indexed_count": 0, "exact_only_count": 0,
            "failed_count": 0, "reused_count": 0, "embedding_calls": 0, "last_error_code": None,
            "completed_at": None, **changes}


def _stop_request(job_service: Any) -> Any:
    state = SimpleNamespace(population_pool=object(), job_service=job_service)
    return SimpleNamespace(app=SimpleNamespace(state=state))


def _stub_stop_route(monkeypatch: pytest.MonkeyPatch, generation: dict[str, Any] | None,
                     failed: list[tuple[str, str]]) -> None:
    async def pin(pool: Any, model_id: str, environment: str, expected: Any) -> dict[str, Any]:
        return {"data_revision_id": "dr-1"}

    async def latest(pool: Any, revision_id: str, fingerprint: str) -> dict[str, Any] | None:
        return generation

    async def fail(pool: Any, index_id: str, code: str, owner: Any = None) -> None:
        failed.append((index_id, code))

    async def by_id(pool: Any, index_id: str) -> dict[str, Any]:
        return {**(generation or {}), "state": "failed", "last_error_code": "cancelled"}

    monkeypatch.setenv("SEMANTIC_MODEL_RUNTIME_WRITES_ENABLED", "true")
    monkeypatch.setenv("SEMANTIC_EMBEDDING_BASE_URL", "http://x")
    monkeypatch.setenv("SEMANTIC_EMBEDDING_MODEL", "m")
    monkeypatch.setattr(routes, "_pin", pin)
    monkeypatch.setattr(routes.search_store, "latest_generation", latest)
    monkeypatch.setattr(routes.search_store, "fail_generation", fail)
    monkeypatch.setattr(routes.search_store, "get_generation_by_id", by_id)


class _Jobs:
    def __init__(self, state: str | None) -> None:
        self.state = state
        self.cancelled: list[tuple[str, str]] = []
        self.repository = self

    async def request_cancel(self, job_id: str, actor: str) -> dict[str, Any] | None:
        self.cancelled.append((job_id, actor))
        return None if self.state is None else {"jobId": job_id, "state": self.state}


@pytest.mark.asyncio
async def test_stopping_a_running_build_asks_its_job_and_leaves_the_generation_to_the_worker(monkeypatch: pytest.MonkeyPatch) -> None:
    failed: list[tuple[str, str]] = []
    generation = _row(index_id="ix", state="indexing", job_id="job-1")
    _stub_stop_route(monkeypatch, generation, failed)
    jobs = _Jobs("cancel_requested")
    result = await routes.stop_search_index(
        routes.IndexStop.model_validate({"actorUserId": "u", "modelId": "m", "environment": "draft"}), _stop_request(jobs))
    assert result["stopped"] is True and jobs.cancelled == [("job-1", indexer.SYSTEM_ACTOR)]
    assert failed == []


@pytest.mark.asyncio
async def test_stopping_a_queued_build_ends_the_generation_at_once(monkeypatch: pytest.MonkeyPatch) -> None:
    failed: list[tuple[str, str]] = []
    generation = _row(index_id="ix", state="queued", job_id="job-1")
    _stub_stop_route(monkeypatch, generation, failed)
    result = await routes.stop_search_index(
        routes.IndexStop.model_validate({"actorUserId": "u", "modelId": "m"}), _stop_request(_Jobs("cancelled")))
    assert result["stopped"] is True and failed == [("ix", "cancelled")]
    assert result["index"]["lastErrorCode"] == "cancelled"


@pytest.mark.asyncio
async def test_stopping_with_nothing_building_changes_nothing(monkeypatch: pytest.MonkeyPatch) -> None:
    failed: list[tuple[str, str]] = []
    _stub_stop_route(monkeypatch, _row(index_id="ix", state="ready", job_id=None), failed)
    jobs = _Jobs("cancelled")
    result = await routes.stop_search_index(
        routes.IndexStop.model_validate({"actorUserId": "u", "modelId": "m"}), _stop_request(jobs))
    assert result["stopped"] is False and jobs.cancelled == [] and failed == []


@pytest.mark.asyncio
async def test_stopping_needs_runtime_writes(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SEMANTIC_MODEL_RUNTIME_WRITES_ENABLED", raising=False)
    with pytest.raises(HTTPException) as raised:
        await routes.stop_search_index(
            routes.IndexStop.model_validate({"actorUserId": "u", "modelId": "m"}), _stop_request(_Jobs(None)))
    assert raised.value.detail == "runtime_writes_disabled"
    assert os.environ.get("SEMANTIC_MODEL_RUNTIME_WRITES_ENABLED") is None


def test_a_search_workers_lease_owner_names_its_role_instance_and_run() -> None:
    from app.workers import graph_search_tasks as tasks

    owner = tasks.IDENTITY.lease_owner()
    # Unique per process and per run: another instance on the same host can never
    # collide with it, and no boot-time cleanup may match a prefix of it.

