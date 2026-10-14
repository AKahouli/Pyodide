"""Ownership, explicit model scoping and queue-claim race coverage."""
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.persistence.postgres_jobs import PostgresJobRepository


@pytest.mark.asyncio
async def test_cross_model_list_is_actor_scoped_paginated_and_empty_scope_is_not_all():
    pool = AsyncMock()
    pool.fetchrow.return_value = {"active": 51, "history": 9, "queued": 50}
    pool.fetch.return_value = [{"id": "j1"}]
    repository = PostgresJobRepository(pool)
    repository.get_job = AsyncMock(return_value={"jobId": "j1", "modelId": "m1"})
    page = await repository.list_my_jobs(actor_user_id="u1", model_ids=["m1", "m2"],
                                         view="active", page=2, limit=20)
    assert page["pagination"] == {"page": 2, "limit": 20, "total": 51, "totalPages": 3}
    assert page["activeCount"] == 51 and page["queuedCount"] == 50
    args = pool.fetch.call_args.args
    assert "actor_user_id = $1" in args[0] and "model_id = ANY($2::text[])" in args[0]
    assert args[1:3] == ("u1", ["m1", "m2"]) and args[4:] == (True, 20, 20)
    repository.get_job.assert_awaited_once_with("j1", "u1")
    await repository.list_my_jobs(actor_user_id="u1", model_ids=[], view="history", page=1, limit=20)
    assert pool.fetch.call_args.args[2] == [] and pool.fetch.call_args.args[4] is False


class LockedConnection:
    """Answers by statement shape, so the call order inside request_cancel can
    change without retuning every test."""

    def __init__(self, state):
        self.state = state
        self.job_type = "population.run"
        self.fetchrow = AsyncMock(return_value={"id": "j1", "state": state,
                                               "job_type": "population.run", "progress": {}})
        self.fetch = AsyncMock(return_value=[{"id": 1}])
        self.execute = AsyncMock()
        self.counts: dict[str, int] = {}

        async def fetchval(sql, *args):  # type: ignore[no-untyped-def]
            text = " ".join(sql.split())
            if "job_type" in text and "FROM semantic_jobs.jobs" in text:
                return self.job_type
            if "count(*)" in text and "JOIN semantic_jobs.jobs" in text:
                return 1  # the only_queued task count
            if "count(*)" in text and "state = 'running'" in text:
                return self.counts.get("live", 0)
            return 0

        self.fetchval = AsyncMock(side_effect=fetchval)

    @asynccontextmanager
    async def transaction(self):
        yield self


class LockPool:
    def __init__(self, state):
        self.connection = LockedConnection(state)

    @asynccontextmanager
    async def acquire(self):
        yield self.connection


@pytest.mark.asyncio
async def test_remove_from_queue_does_not_stop_a_job_claimed_before_its_lock():
    pool = LockPool("running")
    repository = PostgresJobRepository(pool)
    repository.get_job = AsyncMock(return_value={"state": "running"})
    assert await repository.request_cancel("j1", "u1", only_queued=True) == {"state": "running"}
    assert "FOR UPDATE" in pool.connection.fetchrow.call_args.args[0]
    assert "actor_user_id = $2" in pool.connection.fetchrow.call_args.args[0]



@pytest.mark.asyncio
async def test_queue_only_removal_does_not_expire_a_running_search_jobs_lease():
    pool = LockPool("running")
    pool.connection.job_type = "graph_search.full"
    pool.connection.fetchrow.return_value["job_type"] = "graph_search.full"
    repository = PostgresJobRepository(pool)
    repository._expire_stalled_search_leases = AsyncMock()
    repository.get_job = AsyncMock(return_value={"state": "running"})
    await repository.request_cancel("j1", "u1", only_queued=True)
    repository._expire_stalled_search_leases.assert_not_awaited()
    pool.connection.execute.assert_not_awaited()


@pytest.mark.asyncio
async def test_queue_only_removal_skips_a_task_locked_by_a_concurrent_claim():
    pool = LockPool("queued")
    pool.connection.fetch.return_value = []
    repository = PostgresJobRepository(pool)
    repository.get_job = AsyncMock(return_value={"state": "queued"})
    repository._finish_cancelled = AsyncMock()
    await repository.request_cancel("j1", "u1", only_queued=True)
    assert "FOR UPDATE OF t SKIP LOCKED" in pool.connection.fetch.call_args.args[0]
    pool.connection.execute.assert_not_awaited()
    repository._finish_cancelled.assert_not_awaited()


@pytest.mark.asyncio
async def test_queued_removal_finishes_immediately_and_preserves_cancel_history():
    pool = LockPool("queued")
    repository = PostgresJobRepository(pool)
    repository._finish_cancelled = AsyncMock()
    repository.get_job = AsyncMock(return_value={"state": "cancelled"})



@pytest.mark.asyncio
async def test_bulk_removal_scopes_snapshot_and_skips_a_newly_running_job():
    pool = AsyncMock()
    pool.fetch.return_value = [{"id": "queued"}, {"id": "claimed"}]
    repository = PostgresJobRepository(pool)
    repository.request_cancel = AsyncMock(side_effect=[{"state": "cancelled"}, {"state": "running"}])
    assert await repository.cancel_queued_jobs(actor_user_id="u1", model_ids=["m1"]) == {"cancelled": 1, "skipped": 1}
    assert pool.fetch.call_args.args[1:] == ("u1", ["m1"])
    assert "state IN ('queued','waiting_dependencies')" in pool.fetch.call_args.args[0]
    repository.request_cancel.assert_any_await("queued", "u1", only_queued=True)
    repository.request_cancel.assert_any_await("claimed", "u1", only_queued=True)


def test_read_and_remove_contract_uses_trusted_actor_header_and_requires_scope(monkeypatch):
    monkeypatch.setenv("SEMANTIC_RUNTIME_SERVICE_KEY", "test-key")
    monkeypatch.setenv("SEMANTIC_MODEL_RUNTIME_WRITES_ENABLED", "true")
    repository = AsyncMock()
    repository.list_my_jobs.return_value = {"items": [], "pagination": {"total": 0}}
    repository.cancel_queued_jobs.return_value = {"cancelled": 0, "skipped": 0}
    headers = {"X-Semantic-Service-Key": "test-key", "X-Actor-User-Id": "u1"}
    with TestClient(create_app(repository)) as client:
        assert client.post("/v1/semantic-model-jobs/read", headers=headers, json={}).status_code == 422
        assert client.post("/v1/semantic-model-jobs/read", headers=headers,
                           json={"modelIds": ["m1"], "view": "active", "page": 2, "limit": 20}).status_code == 200
        repository.list_my_jobs.assert_awaited_once_with(actor_user_id="u1", model_ids=["m1"],
                                                       view="active", page=2, limit=20)
        assert client.post("/v1/semantic-model-jobs/cancel-queued", headers=headers,
                           json={"modelIds": []}).status_code == 200
        repository.cancel_queued_jobs.assert_awaited_once_with(actor_user_id="u1", model_ids=[])
