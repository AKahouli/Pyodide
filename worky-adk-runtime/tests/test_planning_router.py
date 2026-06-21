"""Regression tests for the planning router (Part 4).

The planning router forwards plan-deltas to the backend with the
`basePlanVersion` taken from the context snapshot. We must not
hardcode 0 — the backend rejects any delta whose basePlanVersion
does not match the stream's currentPlanVersion (canonical §6).
"""
from __future__ import annotations

import sys
import types

sys.path.insert(0, ".")
from tests._adk_stub import install_adk_stubs  # noqa: E402

install_adk_stubs()

import asyncio  # noqa: E402
import json  # noqa: E402

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.clients.backend_client import BackendClient  # noqa: E402
from app.routers import planning as planning_router  # noqa: E402


class _RecordingBackend:
    """Captures every plan_delta call so the test can inspect the
    `basePlanVersion` that the router forwarded."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, dict]] = []
        self.replan_calls: list[tuple[str, dict]] = []

    async def plan_delta(self, stream_id: str, payload: dict) -> dict:
        self.calls.append((stream_id, payload))
        return {"applied": True, "replay": False, "receivedAt": "t"}

    async def replan(self, stream_id: str, payload: dict) -> dict:
        self.replan_calls.append((stream_id, payload))
        return {"applied": True, "replay": False, "receivedAt": "t"}

    async def request_interaction(self, stream_id: str, payload: dict) -> dict:
        return {"applied": True, "replay": False, "receivedAt": "t"}


def _make_app(backend: _RecordingBackend) -> FastAPI:
    app = FastAPI()
    app.include_router(planning_router.router)
    app.state.backend_client = backend
    # Synthesize a run_planning_turn that emits a single delta.pending
    # frame so we exercise the basePlanVersion-forwarding path. Also
    # records the (owner_message, context_snapshot, manager_model_id)
    # tuple so tests can assert the manager model id flows through.
    captured: list[tuple[str, dict | None, str | None]] = []

    async def run_turn(owner_message: str, context_snapshot, manager_model_id=None):
        captured.append((owner_message, context_snapshot, manager_model_id))
        yield types.SimpleNamespace(
            type="delta.pending",
            emitted_at=0.0,
            payload={"body": {"create_tasks": []}},
        )

    app.state.run_planning_turn = run_turn
    app.state.captured = captured
    return app


def test_planning_router_forwards_base_plan_version_from_context_snapshot() -> None:
    backend = _RecordingBackend()
    app = _make_app(backend)
    client = TestClient(app)
    with client.stream(
        "POST",
        "/runtime/streams/stream-1/planning-turn",
        json={
            "owner_message": "build it",
            "context_snapshot": {"planVersion": 7},
        },
    ) as resp:
        for _ in resp.iter_lines():
            pass
    assert len(backend.calls) == 1
    stream_id, payload = backend.calls[0]
    assert stream_id == "stream-1"
    assert payload["basePlanVersion"] == 7


def test_planning_router_uses_replan_for_execution_phase_delta() -> None:
    backend = _RecordingBackend()
    app = _make_app(backend)
    client = TestClient(app)
    with client.stream(
        "POST",
        "/runtime/streams/stream-1/planning-turn",
        json={
            "owner_message": "add another task",
            "context_snapshot": {"planVersion": 7, "status": "partially_blocked"},
        },
    ) as resp:
        for _ in resp.iter_lines():
            pass
    assert backend.calls == []
    assert len(backend.replan_calls) == 1
    stream_id, payload = backend.replan_calls[0]
    assert stream_id == "stream-1"
    assert payload["basePlanVersion"] == 7


def test_planning_router_defaults_base_plan_version_to_zero_when_missing() -> None:
    backend = _RecordingBackend()
    app = _make_app(backend)
    client = TestClient(app)
    with client.stream(
        "POST",
        "/runtime/streams/stream-2/planning-turn",
        json={"owner_message": "build it", "context_snapshot": None},
    ) as resp:
        for _ in resp.iter_lines():
            pass
    assert len(backend.calls) == 1
    _, payload = backend.calls[0]
    assert payload["basePlanVersion"] == 0


def test_planning_router_forwards_manager_model_id_to_runner() -> None:
    backend = _RecordingBackend()
    app = _make_app(backend)
    client = TestClient(app)
    with client.stream(
        "POST",
        "/runtime/streams/stream-3/planning-turn",
        json={
            "owner_message": "build it",
            "context_snapshot": None,
            "manager_model_id": "gpt-4o-mini",
            "worker_model_id": "claude-3-5-sonnet-20240620",
        },
    ) as resp:
        for _ in resp.iter_lines():
            pass
    captured = app.state.captured
    assert len(captured) == 1
    owner_message, context_snapshot, manager_model_id = captured[0]
    assert owner_message == "build it"
    assert context_snapshot is None
    assert manager_model_id == "gpt-4o-mini"


def test_planning_router_accepts_omitted_model_ids() -> None:
    backend = _RecordingBackend()
    app = _make_app(backend)
    client = TestClient(app)
    with client.stream(
        "POST",
        "/runtime/streams/stream-4/planning-turn",
        json={"owner_message": "build it"},
    ) as resp:
        for _ in resp.iter_lines():
            pass
    captured = app.state.captured
    assert len(captured) == 1
    _, _, manager_model_id = captured[0]
    assert manager_model_id is None
