"""Metadata projection and worker-boundary regressions; no live service calls."""
import json
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.jobs.error_details import capture_error, public_details
from app.persistence import graph_search_store as store


def generation():
    return dict(index_id="ix-1", job_id="job-1", model_id="m1", data_revision_id="dr1",
                state="failed", embedding_fingerprint="fp", expected_count=0, indexed_count=0,
                exact_only_count=0, failed_count=0, reused_count=0, embedding_calls=0,
                last_error_code="attempts_exhausted")


@pytest.mark.asyncio
async def test_status_hydrates_only_selected_model_revision_job_and_projects_metadata():
    details = {**capture_error(ValueError("SECRET"), code="invalid_source"), "prompt": "SECRET"}
    pool = SimpleNamespace(fetchrow=AsyncMock(return_value={"job_details": json.dumps(details),
                           "task_details": None, "task_id": "12", "preceding_code": "DataError",
                           "occurred_at": datetime.now(timezone.utc)}))
    hydrated = await store.hydrate_generation_error(pool, generation())
    public = store.public_generation(hydrated)
    assert public["errorDetails"] == public_details(details)
    assert "SECRET" not in json.dumps(public)
    sql, *args = pool.fetchrow.call_args.args
    assert args == ["ix-1", "job-1", "dr1", "m1"]
    assert "j.id = g.job_id AND j.model_id = g.model_id" in sql
    assert "g.data_revision_id = $3 AND g.model_id = $4" in sql


@pytest.mark.asyncio
async def test_legacy_fallback_uses_only_safe_stored_identifier_and_has_no_fake_trace():
    pool = SimpleNamespace(fetchrow=AsyncMock(return_value={"job_details": None, "task_details": None,
                           "task_id": "12", "preceding_code": "DataError",
                           "occurred_at": datetime(2026, 1, 1, tzinfo=timezone.utc)}))
    details = (await store.hydrate_generation_error(pool, generation()))["errorDetails"]
    assert details["legacy"] and details["code"] == details["errorType"] == "DataError"
    assert details["taskId"] == "12" and details["indexId"] == "ix-1"
    assert "frames" not in details and "causes" not in details
    pool.fetchrow.return_value["preceding_code"] = "secret document https://private.invalid"
    details = (await store.hydrate_generation_error(pool, generation()))["errorDetails"]
    assert details["code"] == "attempts_exhausted" and "secret" not in json.dumps(details)


@pytest.mark.asyncio
async def test_unmatched_generation_and_cancellation_never_expose_details():
    pool = SimpleNamespace(fetchrow=AsyncMock(return_value=None))
    assert "errorDetails" not in await store.hydrate_generation_error(pool, generation())
    pool.fetchrow.reset_mock()
    cancelled = {**generation(), "last_error_code": "cancelled"}
    assert "errorDetails" not in await store.hydrate_generation_error(pool, cancelled)
    pool.fetchrow.assert_not_awaited()


@pytest.mark.asyncio
async def test_public_status_uses_pinned_revision_and_does_not_read_after_pin_denial(monkeypatch):
    from fastapi import HTTPException
    from app.api import graph_search_routes as routes
    pool = object()
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(population_pool=pool)))
    details = capture_error(ValueError(), code="invalid_source")
    pin = AsyncMock(return_value={"data_revision_id": "dr1"})
    latest = AsyncMock(return_value={**generation(), "errorDetails": details})
    monkeypatch.setattr(routes, "_pin", pin)
    monkeypatch.setattr(routes, "profile_from_env", lambda: SimpleNamespace(fingerprint="fp"))
    monkeypatch.setattr(store, "latest_generation", latest)
    result = await routes.read_search_index("m1", request, "draft")
    assert result["index"]["errorDetails"] == details
    latest.assert_awaited_once_with(pool, "dr1", "fp")
    latest.reset_mock()
    pin.side_effect = HTTPException(404, "active_binding_not_found")
    with pytest.raises(HTTPException):
        await routes.read_search_index("other", request, "draft")
    latest.assert_not_awaited()


@pytest.mark.asyncio
async def test_datasource_expected_exception_is_captured_before_code_collapse():
    from app.datasource.asset_delivery import AssetFetchError
    from app.workers.datasource_tasks import run_discovery_for_task
    from test_population_task import SOURCE
    source = dict(SOURCE)
    async def fetch(*args, **kwargs):
        raise AssetFetchError("asset_forbidden")
    result = await run_discovery_for_task({"workspaceId": source["workspaceId"], "actorUserId": "u1",
                                           "payload": {"source": source}}, fetch=fetch)
    assert result["ok"] is False
    assert result["errorDetails"]["errorType"] == "AssetFetchError"
    assert result["errorDetails"]["frames"]


@pytest.mark.asyncio
async def test_population_expected_exception_is_captured_before_code_collapse():
    from app.datasource.asset_delivery import AssetFetchError
    from app.workers.population_tasks import run_population_for_task
    from test_population_task import command
    async def fetch(*args, **kwargs):
        raise AssetFetchError("asset_forbidden")
    result = await run_population_for_task(command(), fetch=fetch)
    assert result["errorDetails"]["errorType"] == "AssetFetchError"
    assert result["errorDetails"]["frames"]


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["embedding", "stall"])
async def test_search_terminal_exceptions_reach_fenced_completion(monkeypatch, kind):
    import asyncpg
    from app.jobs import task_lease_guard
    from app.graph_search import embeddings, indexer
    from app.persistence import postgres_jobs
    from app.workers import graph_search_tasks as tasks
    lease = SimpleNamespace(job_id="job1", payload={"payload": {"indexId": "ix1"}},
                            lease_epoch=1, attempt_count=1)
    repository = SimpleNamespace(claim_task=AsyncMock(return_value=lease), complete_task=AsyncMock())
    pool = SimpleNamespace(close=AsyncMock())
    class Guard:
        def __init__(self, *args, **kwargs): pass
        async def start(self): pass
        async def assert_owned(self): pass
        def assert_healthy(self): pass
        def stop(self): pass
    async def build(*args, **kwargs):
        if kind == "stall":
            raise tasks.BuildStalled("SECRET")
        raise embeddings.EmbeddingError("embedding_unavailable", retryable=False)
    monkeypatch.setenv("SEMANTIC_RUNTIME_DATABASE_URL", "unused")
    monkeypatch.setenv("SEMANTIC_TASK_MAX_ATTEMPTS", "1")
    monkeypatch.setattr(asyncpg, "create_pool", AsyncMock(return_value=pool))
    monkeypatch.setattr(postgres_jobs, "PostgresJobRepository", lambda _: repository)
    monkeypatch.setattr(task_lease_guard, "TaskLeaseGuard", Guard)
    monkeypatch.setattr(store, "adopt_generation", AsyncMock(return_value=True))
    monkeypatch.setattr(store, "fail_generation", AsyncMock())
    monkeypatch.setattr(store, "_fail_abandoned_generation", AsyncMock(return_value="failed"))
    monkeypatch.setattr(embeddings, "profile_from_env", lambda: None)
    monkeypatch.setattr(indexer, "build_index", build)
    result = await tasks._run_task(12, "worker")
    assert result["jobState"] == "failed"
    details = repository.complete_task.call_args.kwargs["error_details"]
    assert details["errorType"] == ("BuildStalled" if kind == "stall" else "EmbeddingError")
    assert details["jobId"] == "job1" and details["taskId"] == "12"
    assert "SECRET" not in json.dumps(details)
