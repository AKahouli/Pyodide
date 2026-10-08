"""A search index build resumes after a crashed attempt, and shows the cache reuse step."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from app.graph_search import indexer
from app.graph_search.embeddings import EmbeddingProfile
from app.persistence import graph_search_store as search_store

PROFILE = EmbeddingProfile(base_url="http://embed.test", api_key="k", model="m", dimension=4, batch_size=2)


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
    monkeypatch.setattr(asyncpg, "create_pool", create_pool)
    monkeypatch.setattr(postgres_jobs, "PostgresJobRepository", _Repository)
    monkeypatch.setattr(search_store, "adopt_generation", adopt)
    monkeypatch.setattr(indexer_module, "build_index", build)

    result = await tasks._run_task(7, "search-worker:node:boot:run")

    assert result["ok"] is True
    # The generation is freed for this attempt before the build claims it, not reported "busy".
    assert calls == ["claim_task", "adopt:ix-1:job-1", "build", "complete:completed", "close"]
