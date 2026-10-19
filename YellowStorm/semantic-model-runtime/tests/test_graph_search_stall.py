"""A search index build whose worker is lost or stuck: how it is shown, cut loose, stopped and restarted."""

from __future__ import annotations

import asyncio
import time
from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Any

import httpx
import pytest

from app.api import graph_search_routes as routes
from app.graph_search import embeddings
from app.graph_search.embeddings import EmbeddingError, EmbeddingProfile
from app.persistence import graph_search_store as search_store
from app.workers.graph_search_tasks import BuildStalled, run_watched

PROFILE = EmbeddingProfile(base_url="http://embed.test", api_key="k", model="m", dimension=embeddings.STORAGE_DIMENSION,
                           timeout_seconds=0.05)


def _row(**changes: Any) -> dict[str, Any]:
    return {"index_id": "ix", "state": "indexing", "embedding_fingerprint": "f", "expected_count": 10,
            "indexed_count": 2, "exact_only_count": 0, "failed_count": 0, "reused_count": 0, "embedding_calls": 1,
            "last_error_code": None, "completed_at": None, "job_id": "job-1", "stalled": False,
            "last_progress_at": None, **changes}


def test_status_tells_a_stalled_build_and_when_it_last_progressed() -> None:
    at = datetime(2026, 10, 9, 6, 31, tzinfo=timezone.utc)
    public = search_store.public_generation(_row(stalled=True, last_progress_at=at))
    assert public["stalled"] is True and public["lastProgressAt"] == at.isoformat()


def test_status_of_a_build_that_is_progressing_is_not_stalled() -> None:
    public = search_store.public_generation(_row())
    assert public["stalled"] is False and public["lastProgressAt"] is None
    # A row read without the new columns (an older query) is never reported stalled.
    legacy = {key: value for key, value in _row().items() if key not in ("stalled", "last_progress_at")}
    assert search_store.public_generation(legacy)["stalled"] is False


@pytest.mark.asyncio
async def test_a_build_that_finishes_returns_its_outcome() -> None:
    async def build() -> dict[str, Any]:
        await asyncio.sleep(0.01)
        return {"state": "ready"}

    assert await run_watched(build(), {"at": time.monotonic()}, stall_seconds=5, check_seconds=0.01) == {"state": "ready"}


@pytest.mark.asyncio
async def test_a_build_stuck_in_one_step_is_cut_loose_so_its_worker_is_free_again() -> None:
    cancelled = asyncio.Event()

    async def build() -> None:
        try:
            await asyncio.sleep(3600)
        except asyncio.CancelledError:
            cancelled.set()
            raise

    started = time.monotonic()
    with pytest.raises(BuildStalled) as stalled:
        await run_watched(build(), {"at": time.monotonic()}, stall_seconds=0.05, check_seconds=0.01)
    assert stalled.value.code == "index_stalled" and cancelled.is_set()
    assert time.monotonic() - started < 5


@pytest.mark.asyncio
async def test_a_slow_build_that_keeps_progressing_is_left_alone() -> None:
    clock = {"at": time.monotonic()}

    async def build() -> str:
        for _ in range(6):
            await asyncio.sleep(0.03)
            clock["at"] = time.monotonic()
        return "done"

    # The whole build takes longer than the stall limit, but no step does.
    assert await run_watched(build(), clock, stall_seconds=0.1, check_seconds=0.01) == "done"


class _Hanging:
    async def post(self, *_args: Any, **_kwargs: Any) -> Any:
        await asyncio.sleep(3600)


@pytest.mark.asyncio
async def test_an_embedding_call_that_never_answers_ends_at_the_call_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(embeddings, "CALL_DEADLINE_MARGIN_SECONDS", 0.0)
    started = time.monotonic()
    with pytest.raises(EmbeddingError) as raised:
        await embeddings.embed(PROFILE, ["text"], client=_Hanging())  # type: ignore[arg-type]
    assert raised.value.code == "embedding_timeout" and raised.value.retryable
    assert time.monotonic() - started < 5


@pytest.mark.asyncio
async def test_a_slow_httpx_phase_still_reports_a_retryable_timeout() -> None:
    def slow(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow", request=request)

    async with httpx.AsyncClient(transport=httpx.MockTransport(slow)) as client:
        with pytest.raises(EmbeddingError) as raised:
            await embeddings.embed(PROFILE, ["text"], client=client)
    assert raised.value.code == "embedding_timeout" and raised.value.retryable


class _Jobs:
    def __init__(self, state: str | None) -> None:
        self.state = state
        self.cancelled: list[str] = []
        self.repository = self

    async def admit(self, **_kwargs: Any) -> Any:
        raise AssertionError("request_index is stubbed")

    async def request_cancel(self, job_id: str, _actor: str) -> dict[str, Any] | None:
        self.cancelled.append(job_id)
        return None if self.state is None else {"jobId": job_id, "state": self.state}


def _request(jobs: Any) -> Any:
    state = SimpleNamespace(population_pool=object(), job_service=jobs)
    return SimpleNamespace(app=SimpleNamespace(state=state))


def _stub_restart(monkeypatch: pytest.MonkeyPatch, generation: dict[str, Any], after_stop: dict[str, Any]) -> dict[str, Any]:
    calls: dict[str, Any] = {"failed": [], "requested": []}

    async def pin(*_args: Any) -> dict[str, Any]:
        return {"data_revision_id": "dr-1"}

    async def latest(*_args: Any) -> dict[str, Any]:
        return generation

    async def fail(_pool: Any, index_id: str, code: str, _owner: Any = None) -> None:
        calls["failed"].append((index_id, code))

    async def by_id(*_args: Any) -> dict[str, Any]:
        return after_stop

    async def request_index(_pool: Any, _admit: Any, **kwargs: Any) -> dict[str, Any]:
        calls["requested"].append(kwargs)
        return {"generation": _row(state="queued", job_id="job-2"), "jobId": "job-2"}

    monkeypatch.setenv("SEMANTIC_MODEL_RUNTIME_WRITES_ENABLED", "true")
    monkeypatch.setenv("SEMANTIC_EMBEDDING_BASE_URL", "http://x")
    monkeypatch.setenv("SEMANTIC_EMBEDDING_MODEL", "m")
    monkeypatch.setattr(routes, "_pin", pin)
    monkeypatch.setattr(routes, "request_index", request_index)
    monkeypatch.setattr(routes.search_store, "latest_generation", latest)
    monkeypatch.setattr(routes.search_store, "fail_generation", fail)
    monkeypatch.setattr(routes.search_store, "get_generation_by_id", by_id)
    return calls


COMMAND = {"actorUserId": "u", "modelId": "m", "environment": "draft"}


@pytest.mark.asyncio
async def test_retry_rejects_stale_revision_before_requesting_any_index(monkeypatch: pytest.MonkeyPatch) -> None:
    from unittest.mock import AsyncMock

    monkeypatch.setenv("SEMANTIC_MODEL_RUNTIME_WRITES_ENABLED", "true")
    monkeypatch.setattr(routes.store, "get_active_binding", AsyncMock(return_value={"data_revision_id": "dr-new"}))
    requested = AsyncMock()
    monkeypatch.setattr(routes, "request_index", requested)
    command = routes.IndexCommand.model_validate({**COMMAND, "expectedDataRevisionId": "dr-old", "expectedIndexId": "ix-old"})
    with pytest.raises(routes.HTTPException) as raised:
        await routes.request_search_index(command, _request(_Jobs(None)))
    assert raised.value.status_code == 409 and raised.value.detail == "active_binding_changed"
    requested.assert_not_awaited()


@pytest.mark.asyncio
async def test_retry_forwards_index_identity_and_returns_explicit_identity_conflict(monkeypatch: pytest.MonkeyPatch) -> None:
    from unittest.mock import AsyncMock
    from app.graph_search.indexer import IndexUnavailable

    monkeypatch.setenv("SEMANTIC_MODEL_RUNTIME_WRITES_ENABLED", "true")
    pin = AsyncMock(return_value={"data_revision_id": "dr-1"})
    requested = AsyncMock(side_effect=IndexUnavailable("index_identity_changed"))
    monkeypatch.setattr(routes, "_pin", pin)
    monkeypatch.setattr(routes, "request_index", requested)
    command = routes.IndexCommand.model_validate({**COMMAND, "expectedDataRevisionId": "dr-1", "expectedIndexId": "ix-1"})
    with pytest.raises(routes.HTTPException) as raised:
        await routes.request_search_index(command, _request(_Jobs(None)))
    assert raised.value.status_code == 409 and raised.value.detail == "index_identity_changed"
    assert pin.await_args.args[3] == "dr-1"
    assert requested.await_args.kwargs["expected_index_id"] == "ix-1"


@pytest.mark.asyncio
async def test_restarting_a_stalled_build_stops_it_at_once_and_builds_again(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _stub_restart(monkeypatch, _row(stalled=True), _row(state="failed", last_error_code="cancelled"))
    jobs = _Jobs("cancelled")

    result = await routes.restart_search_index(routes.IndexCommand.model_validate(COMMAND), _request(jobs))

    assert jobs.cancelled == ["job-1"] and result["restarted"] is True and result["jobId"] == "job-2"
    assert len(calls["requested"]) == 1 and calls["requested"][0]["revision_id"] == "dr-1"


@pytest.mark.asyncio
async def test_restarting_a_build_whose_worker_still_answers_only_asks_it_to_stop(monkeypatch: pytest.MonkeyPatch) -> None:
    live = _row()
    calls = _stub_restart(monkeypatch, live, live)

    result = await routes.restart_search_index(routes.IndexCommand.model_validate(COMMAND), _request(_Jobs("cancel_requested")))

    assert result["restarted"] is False and calls["requested"] == [] and calls["failed"] == []


@pytest.mark.asyncio
async def test_restarting_a_finished_or_missing_build_just_builds(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _stub_restart(monkeypatch, _row(state="failed", last_error_code="index_interrupted"), _row())
    jobs = _Jobs("cancelled")

    result = await routes.restart_search_index(routes.IndexCommand.model_validate(COMMAND), _request(jobs))

    assert jobs.cancelled == [] and result["restarted"] is True and len(calls["requested"]) == 1


@pytest.mark.asyncio
async def test_restarting_needs_runtime_writes(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SEMANTIC_MODEL_RUNTIME_WRITES_ENABLED", raising=False)
    with pytest.raises(routes.HTTPException) as raised:
        await routes.restart_search_index(routes.IndexCommand.model_validate(COMMAND), _request(_Jobs(None)))
    assert raised.value.detail == "runtime_writes_disabled"
