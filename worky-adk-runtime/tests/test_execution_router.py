"""Tests for the execution router (Part 3).

The execution router drives the Manager to spawn ephemeral workers
and submit results via the backend callbacks. The tests use the
in-process `BackendClient` stub from `tests/_adk_stub.py` to
verify the call sequence and the SSE frame order without touching
the network.
"""
from __future__ import annotations

import asyncio
import json
import sys
import types

sys.path.insert(0, ".")
from tests._adk_stub import install_adk_stubs  # noqa: E402

install_adk_stubs()

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.clients.backend_client import BackendClient  # noqa: E402
from app.config import Settings  # noqa: E402
from app.routers.execution import WORKER_REGISTRY, router  # noqa: E402
from app.telemetry import TracingPlugin  # noqa: E402


class StubBackendClient:
    """In-process BackendClient replacement for tests.

    Records every method call and returns canned responses. The
    `spawn_worker` factory returns a binding shape the runtime
    understands; `submit_task_result` always succeeds.
    """

    def __init__(self) -> None:
        self.calls: list[tuple[str, str, dict]] = []
        self.worker_counter = 0

    async def spawn_worker(self, stream_id: str, body: dict, event_id: str | None = None) -> dict:
        self.worker_counter += 1
        task_id = body.get("taskId", f"t-{self.worker_counter}")
        self.calls.append(("spawn_worker", stream_id, body))
        return {
            "applied": True,
            "replay": False,
            "eventId": event_id or f"spawn-{self.worker_counter}",
            "receivedAt": "2026-06-18T00:00:00Z",
            "binding": {
                "ephemeralWorkerId": f"worker-{task_id}",
                "agentEntityId": f"agent-{task_id}",
                "scopedToolRefs": ["skill:pdf-read"],
                "withheldToolRefs": ["connector:send_email"],
                "role": body.get("role", "ephemeral_ai_agent"),
            },
        }

    async def submit_task_result(self, task_id: str, body: dict, event_id: str | None = None) -> dict:
        self.calls.append(("submit_task_result", task_id, body))
        return {
            "applied": True,
            "replay": False,
            "eventId": event_id or f"result-{task_id}",
            "receivedAt": "2026-06-18T00:00:00Z",
        }

    # The other methods are no-ops for these tests.
    async def record_cost(self, *args, **kwargs):  # noqa: D401
        return {"applied": True, "replay": False, "eventId": "", "receivedAt": ""}

    async def emit_audit(self, *args, **kwargs):  # noqa: D401
        return {"applied": True, "replay": False, "eventId": "", "receivedAt": ""}


def _build_app(backend: StubBackendClient) -> FastAPI:
    app = FastAPI()
    app.include_router(router)
    app.state.backend_client = backend
    # Reset the worker registry between tests.
    for w in list(WORKER_REGISTRY.all()):
        WORKER_REGISTRY.retire(w.worker_id)
    return app


def test_start_stream_spawns_a_worker_per_ready_task_and_submits_results():
    backend = StubBackendClient()
    app = _build_app(backend)
    client = TestClient(app)

    response = client.post(
        "/runtime/streams/stream-1/start",
        json={"ready_task_ids": ["t1", "t2"], "context_snapshot": {}},
    )
    assert response.status_code == 200

    frames = _parse_sse(response.text)
    # Each task should produce: execution.bootstrap, worker.spawned,
    # task.completed, then a single execution.telemetry and
    # execution.done at the end.
    types = [f["type"] for f in frames]
    assert types[0] == "execution.bootstrap"
    assert types.count("worker.spawned") == 2
    assert types.count("task.completed") == 2
    assert types[-1] == "execution.done"

    # Backend callbacks were called in the right order.
    callback_names = [name for name, _, _ in backend.calls]
    assert callback_names == [
        "spawn_worker",
        "submit_task_result",
        "spawn_worker",
        "submit_task_result",
    ]


def test_start_stream_with_empty_ready_list_emits_only_bootstrap_and_done():
    backend = StubBackendClient()
    app = _build_app(backend)
    client = TestClient(app)

    response = client.post(
        "/runtime/streams/stream-2/start",
        json={"ready_task_ids": [], "context_snapshot": {}},
    )
    assert response.status_code == 200
    frames = _parse_sse(response.text)
    types = [f["type"] for f in frames]
    assert types[0] == "execution.bootstrap"
    assert types.count("worker.spawned") == 0
    assert types[-1] == "execution.done"


def test_stop_stream_retires_all_workers():
    backend = StubBackendClient()
    app = _build_app(backend)
    client = TestClient(app)
    # First spawn a worker so the registry is non-empty.
    client.post(
        "/runtime/streams/stream-3/start",
        json={"ready_task_ids": ["t1"], "context_snapshot": {}},
    )
    assert len(WORKER_REGISTRY.all()) == 0  # Stub worker retires after done

    response = client.post("/runtime/streams/stream-3/stop")
    assert response.status_code == 200
    frames = _parse_sse(response.text)
    assert frames[0]["type"] == "execution.stopped"


def test_cancel_task_emits_task_canceled_frame():
    backend = StubBackendClient()
    app = _build_app(backend)
    client = TestClient(app)
    response = client.post("/runtime/streams/tasks/t-cancel/cancel")
    assert response.status_code == 200
    frames = _parse_sse(response.text)
    assert frames[0]["type"] == "task.canceled"
    assert frames[0]["payload"]["task_id"] == "t-cancel"


def test_resume_stream_emits_resumed_and_done():
    backend = StubBackendClient()
    app = _build_app(backend)
    client = TestClient(app)
    response = client.post(
        "/runtime/streams/stream-4/resume",
        json={"trigger": "owner_resume"},
    )
    assert response.status_code == 200
    frames = _parse_sse(response.text)
    types = [f["type"] for f in frames]
    assert types[0] == "execution.resumed"
    assert types[-1] == "execution.done"


def test_replan_stream_emits_replan_requested():
    backend = StubBackendClient()
    app = _build_app(backend)
    client = TestClient(app)
    response = client.post(
        "/runtime/streams/stream-5/replan",
        json={"trigger_event": {"type": "interaction.rejected"}},
    )
    assert response.status_code == 200
    frames = _parse_sse(response.text)
    types = [f["type"] for f in frames]
    assert types[0] == "replan.requested"
    assert types[-1] == "execution.done"


def test_tracing_plugin_buffers_model_and_tool_spans():
    plugin = TracingPlugin(backend_client=None)
    plugin.on_model_span({"model": "gpt-4", "input_tokens": 10, "output_tokens": 20, "task_id": "t1"})
    plugin.on_tool_span({"name": "send_email", "duration_ms": 12, "task_id": "t1"})
    assert len(plugin.cost_events) == 1
    assert plugin.cost_events[0]["model"] == "gpt-4"
    assert plugin.cost_events[0]["inputTokens"] == 10
    assert len(plugin.audit_events) == 1
    assert plugin.audit_events[0]["details"]["tool"] == "send_email"


def _parse_sse(text: str) -> list[dict]:
    """Parse SSE frames from the test client output."""
    out: list[dict] = []
    for raw_block in text.strip().split("\n\n"):
        if not raw_block.strip():
            continue
        event_type: str | None = None
        data_lines: list[str] = []
        for line in raw_block.splitlines():
            if line.startswith("event:"):
                event_type = line.split(":", 1)[1].strip()
            elif line.startswith("data:"):
                data_lines.append(line.split(":", 1)[1].strip())
        if event_type and data_lines:
            out.append({"type": event_type, "payload": json.loads("".join(data_lines))["payload"]})
    return out
