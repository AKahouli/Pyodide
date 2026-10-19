"""A search index build resumes after a crashed attempt, and shows the cache reuse step."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from app.graph_search import indexer
from app.graph_search.embeddings import EmbeddingProfile
from app.persistence import graph_search_store as search_store

PROFILE = EmbeddingProfile(base_url="http://embed.test", api_key="k", model="m", dimension=4, batch_size=2)


@pytest.mark.asyncio
@pytest.mark.parametrize("configured", ["mismatched", "missing", "matching"])
@pytest.mark.parametrize("stored", [None, {"cardValueChars": 600}], ids=["default-settings", "stored-nondefault-settings"])
async def test_build_profile_fence_precedes_claim_records_and_provider(
    monkeypatch: pytest.MonkeyPatch, configured: str, stored: dict[str, Any] | None,
) -> None:
    from dataclasses import replace
    from unittest.mock import AsyncMock
    from app.graph_search.settings import IndexSettings, index_fingerprint

    settings = IndexSettings.model_validate(stored or {})
    fingerprint = index_fingerprint(PROFILE.fingerprint, settings)
    if stored:
        # A matching worker must include the saved card/passage settings, not
        # compare only its embedding profile (or substitute default settings).
        assert fingerprint != index_fingerprint(PROFILE.fingerprint, IndexSettings())
    generation = {"index_id": "ix-profile-fence", "state": "queued",
                  "embedding_fingerprint": fingerprint, "index_settings": stored}
    profile = None if configured == "missing" else replace(PROFILE, model="different-model") if configured == "mismatched" else PROFILE
    monkeypatch.setattr(indexer, "profile_from_env", lambda: profile)
    lookup = AsyncMock(return_value=generation)
    fail = AsyncMock()
    claim = AsyncMock(return_value=False)
    monkeypatch.setattr(indexer.search_store, "get_generation_by_id", lookup)
    monkeypatch.setattr(indexer.search_store, "fail_generation", fail)
    monkeypatch.setattr(indexer.search_store, "claim_generation", claim)
    # No usable database connection or provider is present. Unexpected work
    # fails immediately as well as being checked explicitly below.
    forbidden = []
    for target, name in [(indexer.population_store, "get_revision_specification"),
                         (indexer.population_store, "count_revision_rows"),
                         (indexer, "_write_cards"), (indexer, "embed")]:
        operation = AsyncMock(side_effect=AssertionError(f"profile fence reached {name}"))
        monkeypatch.setattr(target, name, operation)
        forbidden.append(operation)
    embedder = AsyncMock(side_effect=AssertionError("profile fence reached provider"))
    report = AsyncMock()
    pool = object()

    result = await indexer.build_index(pool, index_id="ix-profile-fence", owner="worker-profile-fence",
                                       report=report, embedder=embedder)

    if configured == "matching":
        assert result == {"state": "queued", "busy": True}
        fail.assert_not_awaited()
        claim.assert_awaited_once()
        assert claim.await_args.args[:3] == (pool, "ix-profile-fence", "worker-profile-fence")
        assert claim.await_args.args[3] > 0
        assert lookup.await_count == 2
    else:
        assert result == {"state": "failed", "errorCode": "embedding_profile_changed"}
        fail.assert_awaited_once_with(pool, "ix-profile-fence", "embedding_profile_changed")
        claim.assert_not_awaited()
        lookup.assert_awaited_once_with(pool, "ix-profile-fence")
    for operation in [*forbidden, embedder, report]:
        operation.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("generation", [None, {"index_id": "different-index"}])
async def test_retry_rejects_changed_profile_settings_or_identity_before_mutation(monkeypatch: pytest.MonkeyPatch, generation: Any) -> None:
    from unittest.mock import AsyncMock
    from app.graph_search.settings import IndexSettings, index_fingerprint

    monkeypatch.setattr(indexer, "profile_from_env", lambda: PROFILE)
    lookup = AsyncMock(return_value=generation)
    mutate = AsyncMock()
    monkeypatch.setattr(indexer.search_store, "get_generation", lookup)
    monkeypatch.setattr(indexer, "_request", mutate)
    settings = IndexSettings()
    with pytest.raises(indexer.IndexUnavailable, match="index_identity_changed"):
        await indexer.request_index(object(), AsyncMock(), revision_id="dr-1", settings=settings, expected_index_id="ix-1")
    assert lookup.await_args.args[1:] == ("dr-1", index_fingerprint(PROFILE.fingerprint, settings))
    mutate.assert_not_awaited()


@pytest.mark.asyncio
async def test_explicit_exhausted_retry_reuses_generation_and_durable_counts(monkeypatch: pytest.MonkeyPatch) -> None:
    from unittest.mock import AsyncMock
    from app.graph_search.settings import IndexSettings

    monkeypatch.setattr(indexer, "profile_from_env", lambda: PROFILE)
    failed = {"index_id": "ix-1", "model_id": "m", "state": "failed", "last_error_code": "attempts_exhausted",
              "attempt": 2, "job_id": "old-job", "indexed_count": 17, "errorDetails": {"message": "original failure"}}
    queued = {**failed, "state": "queued", "attempt": 3, "job_id": "new-job"}
    lookup = AsyncMock(return_value=failed)
    retry = AsyncMock(return_value=queued)
    create = AsyncMock()
    admit = AsyncMock(return_value=SimpleNamespace(reused=False, state="queued", job_id="new-job"))
    monkeypatch.setattr(indexer.search_store, "get_generation", lookup)
    monkeypatch.setattr(indexer.search_store, "retry_generation", retry)
    monkeypatch.setattr(indexer.search_store, "get_generation_by_id", AsyncMock(return_value=queued))
    monkeypatch.setattr(indexer.search_store, "set_generation_job", AsyncMock())
    monkeypatch.setattr(indexer.search_store, "create_generation", create)
    result = await indexer.request_index(object(), admit, revision_id="dr-1", settings=IndexSettings(), expected_index_id="ix-1")
    assert result["generation"]["index_id"] == "ix-1" and result["generation"]["indexed_count"] == 17
    assert result["jobId"] == "new-job"
    assert admit.await_args.kwargs["idempotency_key"] == "gsi:ix-1:3"
    retry.assert_awaited_once()
    create.assert_not_awaited()


class _Pool:
    """Answers the chunk statement of ``fill_from_cache`` from a list of record ids and cached ones."""

    def __init__(self, entities: list[str], cached: set[str]) -> None:
        self.entities = entities
        self.cached = cached
        self.chunks: list[tuple[str, int]] = []
        self.reused_counts: list[int] = []

    async def fetchrow(self, sql: str, index_id: str, after: str, size: int, *rest: Any) -> dict[str, Any]:
        chunk = [entity for entity in self.entities if entity > after][:size]
        self.chunks.append((after, size))
        hits = [entity for entity in chunk if entity in self.cached]
        self.cached -= set(hits)
        return {"reused": len(hits), "last_entity": chunk[-1] if chunk else None}

    async def execute(self, sql: str, index_id: str, reused: int) -> None:
        self.reused_counts.append(reused)


@pytest.mark.asyncio
async def test_the_cache_fill_walks_the_records_in_bounded_chunks() -> None:
    pool = _Pool([f"e{n}" for n in range(7)], {"e1", "e4", "e5"})
    totals: list[int] = []

    async def chunk_done(count: int) -> bool:
        totals.append(count)
        return True

    reused = await search_store.fill_from_cache(pool, "ix", "m", "fp", chunk_rows=3, on_chunk=chunk_done)

    assert reused == 3 and totals == [1, 3, 3]
    # Each chunk starts after the last record of the one before, whatever it reused; the last ends the loop.
    assert pool.chunks == [("", 3), ("e2", 3), ("e5", 3), ("e6", 3)]
    assert pool.reused_counts == [1, 2]


@pytest.mark.asyncio
async def test_the_cache_fill_stops_when_asked_and_keeps_what_it_reused() -> None:
    pool = _Pool([f"e{n}" for n in range(9)], {f"e{n}" for n in range(9)})

    async def stop(_count: int) -> bool:
        return False

    assert await search_store.fill_from_cache(pool, "ix", "m", ["fp"], chunk_rows=4, on_chunk=stop) == 4
    assert pool.chunks == [("", 4)]


class _Store:
    def __init__(self, lease_alive_chunks: int = 99) -> None:
        self.progress: list[dict[str, Any]] = []
        self.renewals = 0
        self.lease_alive_chunks = lease_alive_chunks

    async def fill_from_cache(self, pool: Any, index_id: str, model_id: str, fingerprints: Any, kind: str = "documents",
                              *, on_chunk: Any = None, **_kwargs: Any) -> int:
        total = 0
        for _ in range(3):
            total += 10
            if on_chunk is not None and not await on_chunk(total):
                break
        return total

    async def renew_generation(self, *args: Any) -> bool:
        self.renewals += 1
        return self.renewals <= self.lease_alive_chunks

    async def record_progress(self, pool: Any, index_id: str, owner: str, **fields: Any) -> None:
        self.progress.append(fields)


async def _reuse(monkeypatch: pytest.MonkeyPatch, store: _Store, should_stop: Any = None) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    for name in ("fill_from_cache", "renew_generation", "record_progress"):
        monkeypatch.setattr(indexer.search_store, name, getattr(store, name))
    reports: list[dict[str, Any]] = []

    async def report(progress: dict[str, Any]) -> None:
        reports.append(progress)

    done = await indexer._reuse_cached(object(), index_id="ix", owner="w", model_id="m", profile=PROFILE,
                                       lease_seconds=60, loaded=100, expected=100, passages=40,
                                       report=report, should_stop=should_stop)
    return done, reports


@pytest.mark.asyncio
async def test_reusing_vectors_is_shown_as_its_own_step_and_renews_the_lease(monkeypatch: pytest.MonkeyPatch) -> None:
    store = _Store()
    done, reports = await _reuse(monkeypatch, store)

    assert done == {"reused": 30, "passagesReused": 30, "halt": None}
    assert all(p["stage"] == "reusing" and p["loaded"] == p["expected"] == 100 for p in store.progress)
    # Shown before the first chunk (nothing reused yet), then after each of the six chunks.
    assert [p.get("indexed", 0) for p in store.progress] == [0, 10, 20, 30, 30, 30, 30]
    assert [p.get("passages_indexed", 0) for p in store.progress] == [0, 0, 0, 0, 10, 20, 30]
    assert store.renewals == 6 and reports[-1]["stage"] == "reusing" and reports[-1]["passagesReused"] == 30


@pytest.mark.asyncio
async def test_a_stop_during_the_reuse_ends_the_build_as_stopped(monkeypatch: pytest.MonkeyPatch) -> None:
    async def stop() -> bool:
        return True

    done, _ = await _reuse(monkeypatch, _Store(), should_stop=stop)
    assert done["halt"] == "cancelled" and done["reused"] == 10


@pytest.mark.asyncio
async def test_a_lease_lost_during_the_reuse_ends_the_build(monkeypatch: pytest.MonkeyPatch) -> None:
    done, _ = await _reuse(monkeypatch, _Store(lease_alive_chunks=1))
    assert done["halt"] == "lease_lost"


@pytest.mark.asyncio
async def test_a_retry_adopts_the_generation_its_crashed_attempt_held_before_building(monkeypatch: pytest.MonkeyPatch) -> None:
    import asyncpg

    from app.graph_search import indexer as indexer_module
    from app.persistence import postgres_jobs
    from app.workers import graph_search_tasks as tasks

    calls: list[str] = []
    lease = SimpleNamespace(job_id="job-1", payload={"payload": {"indexId": "ix-1"}}, lease_epoch=2, attempt_count=2)

    class _Pool:
        async def close(self) -> None:
            calls.append("close")

    class _Repository:
        def __init__(self, pool: Any) -> None:
            pass

        async def claim_task(self, **kwargs: Any) -> Any:
            calls.append("claim_task")
            return lease

        async def complete_task(self, **kwargs: Any) -> None:
            calls.append(f"complete:{kwargs['job_state']}")

    async def create_pool(*args: Any, **kwargs: Any) -> _Pool:
        return _Pool()

    async def adopt(pool: Any, index_id: str, job_id: str, owner: str) -> bool:
        calls.append(f"adopt:{index_id}:{job_id}")
        return True

    async def build(pool: Any, **kwargs: Any) -> dict[str, Any]:
        calls.append("build")
        return {"state": "ready"}

    monkeypatch.setenv("SEMANTIC_RUNTIME_DATABASE_URL", "postgresql://unused")
    from app.jobs import task_lease_guard

    class Guard:
        def __init__(self, ownership, **kwargs):
            assert ownership.lease_epoch == 2

        async def start(self):
            calls.append("guard:start")

        async def assert_owned(self):
            calls.append("guard:owned")

        def assert_healthy(self):
            pass

        def stop(self):
            calls.append("guard:stop")

    monkeypatch.setattr(task_lease_guard, "TaskLeaseGuard", Guard)
    monkeypatch.setattr(asyncpg, "create_pool", create_pool)
    monkeypatch.setattr(postgres_jobs, "PostgresJobRepository", _Repository)
    monkeypatch.setattr(search_store, "adopt_generation", adopt)
    monkeypatch.setattr(indexer_module, "build_index", build)

    result = await tasks._run_task(7, "search-worker:node:boot:run")

    assert result["ok"] is True
    # The generation is freed for this attempt before the build claims it, not reported "busy".
    assert calls == ["claim_task", "guard:start", "guard:owned", "adopt:ix-1:job-1", "build",
                     "complete:completed", "guard:stop", "close"]


# Reuse the guarded, primary-portable dedicated DB fixture without changing it.
from test_graph_search_fencing import f2_db, f2_attempt  # noqa: E402,F401


@pytest.mark.asyncio
@pytest.mark.parametrize("scenario", ["ready_crash", "ready_exhausted", "exhausted", "final_stall"])
async def test_worker_reconciles_terminal_or_abandoned_generation(f2_attempt, monkeypatch, scenario):
    import asyncpg
    from app.jobs import task_lease_guard
    from app.workers import graph_search_tasks as tasks
    from app.workers.celery_app import SEARCH_QUEUES

    pool, ix, task, job, model = f2_attempt
    monkeypatch.setenv("SEMANTIC_TASK_MAX_ATTEMPTS", "1")
    monkeypatch.setenv("SEMANTIC_RUNTIME_DATABASE_URL", "postgresql://unused")
    if scenario.startswith("ready"):
        # Generation committed, but old worker died before completing its task.
        assert await search_store.finish_generation(pool, ix, "old", 0) == "ready"
    else:
        await pool.execute("UPDATE semantic_graph_search.index_generations SET lease_until=clock_timestamp()-interval '1 second' WHERE index_id=$1::uuid", ix)
    before = await search_store.get_generation_by_id(pool, ix)
    await pool.execute(
        "UPDATE semantic_jobs.tasks SET state='queued', lease_owner=NULL,lease_expires_at=NULL,"
        "attempt_count=$2,queue_name=$3,payload=jsonb_build_object('payload',jsonb_build_object('indexId',$4::text)) WHERE id=$1",
        task, 1 if scenario in ("exhausted", "ready_exhausted") else 0, SEARCH_QUEUES[0], ix)

    class PoolProxy:
        def __getattr__(self, name):
            return getattr(pool, name)

        async def close(self):
            pass

    async def create_pool(*args, **kwargs):
        return PoolProxy()

    class Guard:
        def __init__(self, *args, **kwargs):
            pass

        async def start(self):
            pass

        async def assert_owned(self):
            pass

        def assert_healthy(self):
            pass

        def stop(self):
            pass

    monkeypatch.setattr(asyncpg, "create_pool", create_pool)
    monkeypatch.setattr(task_lease_guard, "TaskLeaseGuard", Guard)
    if scenario == "final_stall":
        async def stalled(pool, **kwargs):
            assert await search_store.claim_generation(pool, ix, "new", 60)
            await pool.execute("UPDATE semantic_graph_search.index_generations SET lease_until=clock_timestamp()-interval '1 second' WHERE index_id=$1::uuid", ix)
            raise tasks.BuildStalled("no progress")
        monkeypatch.setattr(indexer, "build_index", stalled)
    result = await tasks._run_task(task, "new")
    expected = "completed" if scenario.startswith("ready") else "failed"
    assert result["jobState"] == expected
    assert await pool.fetchval("SELECT state FROM semantic_jobs.jobs WHERE id=$1::uuid", job) == expected
    assert await pool.fetchval("SELECT state FROM semantic_jobs.tasks WHERE id=$1", task) == expected
    generation = await search_store.get_generation_by_id(pool, ix)
    if scenario.startswith("ready"):
        assert generation == before  # reconciliation never mutates an immutable generation
    else:
        assert generation["state"] == "failed"
        assert generation["last_error_code"] == ("attempts_exhausted" if scenario == "exhausted" else "index_interrupted")
    events = await pool.fetchval("SELECT count(*) FROM semantic_jobs.events WHERE job_id=$1::uuid", job)
    again = await tasks._run_task(task, "new")
    assert again["errorCode"] == "lease_unavailable"
    assert await pool.fetchval("SELECT count(*) FROM semantic_jobs.events WHERE job_id=$1::uuid", job) == events


@pytest.mark.asyncio
@pytest.mark.parametrize("loss", ["epoch", "expired", "wrong_job", "no_task"])
async def test_abandoned_cleanup_rejects_noncurrent_task(f2_attempt, loss):
    from app.jobs.models import StaleLease
    pool, ix, task, job, model = f2_attempt
    before = await search_store.get_generation_by_id(pool, ix)
    token = None
    if loss == "epoch":
        await pool.execute("UPDATE semantic_jobs.tasks SET lease_epoch=lease_epoch+1 WHERE id=$1", task)
    elif loss == "expired":
        await pool.execute("UPDATE semantic_jobs.tasks SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", task)
    elif loss == "wrong_job":
        await pool.execute("UPDATE semantic_graph_search.index_generations SET job_id=gen_random_uuid() WHERE index_id=$1::uuid", ix)
        before = await search_store.get_generation_by_id(pool, ix)
    else:
        token = search_store._task_ownership.set(None)
    try:
        with pytest.raises(StaleLease):
            await search_store._fail_abandoned_generation(pool, ix, "attempts_exhausted")
        assert await search_store.get_generation_by_id(pool, ix) == before
    finally:
        if token is not None:
            search_store._task_ownership.reset(token)


@pytest.mark.asyncio
@pytest.mark.parametrize("terminal", ["ready", "failed"])
async def test_terminal_adopt_claim_and_cleanup_are_taskfenced_noops(f2_attempt, terminal):
    from app.jobs.models import StaleLease
    pool, ix, task, job, model = f2_attempt
    if terminal == "ready":
        assert await search_store.finish_generation(pool, ix, "old", 0) == "ready"
    else:
        await search_store.fail_generation(pool, ix, "test", "old")
    before = await search_store.get_generation_by_id(pool, ix)
    assert await search_store.adopt_generation(pool, ix, job, "old") is False
    assert await search_store.claim_generation(pool, ix, "old", 60) is False
    assert await search_store._fail_abandoned_generation(pool, ix, "index_interrupted") == terminal
    assert await search_store.get_generation_by_id(pool, ix) == before
    await pool.execute("UPDATE semantic_jobs.tasks SET lease_epoch=lease_epoch+1 WHERE id=$1", task)
    for call in (lambda: search_store.adopt_generation(pool, ix, job, "old"),
                 lambda: search_store.claim_generation(pool, ix, "old", 60),
                 lambda: search_store._fail_abandoned_generation(pool, ix, "index_interrupted")):
        with pytest.raises(StaleLease):
            await call()
    assert await search_store.get_generation_by_id(pool, ix) == before
