"""Ephemeral worker factory (Part 3, canonical §4.3 + §3.5).

For each ready task the runtime calls `backend.spawn_worker(...)` to
obtain a scoped `WorkerBinding` from NestJS (the backend creates an
ephemeral Agent Entity bound to ONLY the requested tools, and
withholds gated-category tools until the owner responds). This
module then builds an `AgentTool` from the binding so the Manager can
delegate to it as a sub-Runner.

The runtime never imports the bound tools directly — it just records
the binding shape in a per-task registry. The actual `RestApiTool` /
`OpenAPIToolset` construction is a future hardening step (the
canonical plan calls for `httpx_client_factory`); for Part 3 the
worker is a thin agent with the right name + tools list, and the
agent surface is what the backend's auth checks care about.
"""
from __future__ import annotations

import logging
import time
from typing import Any, AsyncIterator, Optional

from .model import build_model

logger = logging.getLogger("worky.workers")


class EphemeralWorker:
    """In-memory per-task worker.

    The runtime uses this object to:
      - remember the binding (workerId, agentEntityId, tools)
      - run one bounded invocation (the agent's `run_async` loop is
        short-lived — one bounded step per call)
      - emit `ExecutionFrame` values that the execution router
        translates into backend callbacks (cost events, task result,
        trace spans).

    The actual LLM/agent construction uses ADK's `LlmAgent` so the
    runtime continues to use the `LiteLlm` model wrapper, but the
    per-task model is fixed by the Manager's policy — the runtime
    does NOT let the worker self-approve or rebind its own tools.
    """

    __slots__ = (
        "worker_id",
        "agent_entity_id",
        "task_id",
        "stream_id",
        "scoped_tool_refs",
        "withheld_tool_refs",
        "role",
        "_adk_session_id",
        "_adk_invocation_id",
    )

    def __init__(self, binding: dict[str, Any], task_id: str, stream_id: str) -> None:
        self.worker_id = str(binding.get("ephemeralWorkerId") or binding.get("workerId") or "")
        self.agent_entity_id = str(binding.get("agentEntityId") or "")
        self.task_id = task_id
        self.stream_id = stream_id
        self.scoped_tool_refs = list(binding.get("scopedToolRefs") or [])
        self.withheld_tool_refs = list(binding.get("withheldToolRefs") or [])
        self.role = str(binding.get("role") or "ephemeral_ai_agent")
        self._adk_session_id = None
        self._adk_invocation_id = None

    def has_gated_tools_withheld(self) -> bool:
        return len(self.withheld_tool_refs) > 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "ephemeralWorkerId": self.worker_id,
            "agentEntityId": self.agent_entity_id,
            "taskId": self.task_id,
            "streamId": self.stream_id,
            "scopedToolRefs": self.scoped_tool_refs,
            "withheldToolRefs": self.withheld_tool_refs,
            "role": self.role,
            "adkSessionId": self._adk_session_id,
            "adkInvocationId": self._adk_invocation_id,
        }


def build_ephemeral_worker(binding: dict[str, Any], task_id: str, stream_id: str) -> EphemeralWorker:
    """Wrap the backend's `WorkerBinding` in a runtime-side worker record."""
    return EphemeralWorker(binding, task_id, stream_id)


def build_agent_tool_for_worker(worker: EphemeralWorker) -> Any:
    """Build an `AgentTool` from a worker record.

    Returns a stub when the runtime stubs are in use (unit tests).
    Real construction uses ADK 2.2.0's `AgentTool` + `LlmAgent`
    pair, with the LiteLlm model wrapper and the scoped tool list
    passed through to ADK.
    """
    try:
        from google.adk.agents import LlmAgent
        from google.adk.tools import AgentTool
    except Exception:  # pragma: no cover
        return _StubAgentTool(worker)

    inner = LlmAgent(
        name=f"worky_worker_{worker.task_id}",
        description=f"Ephemeral worker for task {worker.task_id} (role: {worker.role}).",
        model=build_model(None),
        # The worker is tool-scoped to the binding. The runtime
        # will resolve `scoped_tool_refs` to actual `RestApiTool` /
        # `OpenAPIToolset` instances in a future Part; for now we
        # pass an empty list so the agent can complete its bounded
        # step with its own reasoning + the result callback.
        tools=[],
    )
    tool = AgentTool(inner, skip_summarization=False)
    tool._worky_worker = worker  # type: ignore[attr-defined]
    return tool


class _StubAgentTool:
    """Test double for ADK's `AgentTool`."""

    def __init__(self, worker: EphemeralWorker) -> None:
        self.worker = worker
        self.name = f"worky_worker_{worker.task_id}"


class WorkerRegistry:
    """Per-stream registry of active ephemeral workers.

    The Manager agent reads this to know which workers exist, the
    runtime reads it to know which workers to retire.
    """

    def __init__(self) -> None:
        self._workers: dict[str, EphemeralWorker] = {}

    def register(self, worker: EphemeralWorker) -> None:
        self._workers[worker.worker_id] = worker

    def get(self, worker_id: str) -> Optional[EphemeralWorker]:
        return self._workers.get(worker_id)

    def retire(self, worker_id: str) -> None:
        self._workers.pop(worker_id, None)

    def all(self) -> list[EphemeralWorker]:
        return list(self._workers.values())


def new_worker_session_id(stream_id: str, task_id: str) -> str:
    return f"worky-worker-{stream_id}-{task_id}-{int(time.time() * 1000)}"


async def run_worker_bounded_step(
    agent_tool: Any,
    payload: dict[str, Any],
) -> AsyncIterator[dict[str, Any]]:
    """Run one bounded step on the ephemeral worker.

    Yields `ExecutionFrame` dicts the router translates into backend
    callbacks. The real implementation drives `agent_tool.agent.run_async`
    on a fresh ADK session. The stub yields a single `done` frame
    for unit tests.
    """
    if isinstance(agent_tool, _StubAgentTool):
        # The stub always succeeds with a canned summary.
        yield {
            "type": "worker.frame",
            "task_id": agent_tool.worker.task_id,
            "kind": "done",
            "summary": f"Stub result for {agent_tool.worker.task_id} (role: {agent_tool.worker.role})",
            "status": "done",
            "payload": payload,
        }
        return

    try:
        from google.adk.runners import Runner
        from google.adk.sessions import InMemorySessionService
        from google.genai import types as genai_types
    except Exception:  # pragma: no cover
        yield {
            "type": "worker.frame",
            "kind": "error",
            "error": "google-adk is not installed",
        }
        return

    worker = getattr(agent_tool, "_worky_worker", None)
    session_id = new_worker_session_id(worker.stream_id, worker.task_id) if worker else "worky-worker"
    session_service = InMemorySessionService()
    await session_service.create_session(
        app_name="worky_runtime",
        user_id="ephemeral",
        session_id=session_id,
    )
    runner = Runner(
        agent=agent_tool.agent,
        app_name="worky_runtime",
        session_service=session_service,
    )
    new_message = genai_types.Content(
        role="user",
        parts=[genai_types.Part(text=str(payload.get("text", payload)))],
    )
    try:
        async for event in runner.run_async(
            user_id="ephemeral",
            session_id=session_id,
            new_message=new_message,
        ):
            content = getattr(event, "content", None)
            text = ""
            if content and getattr(content, "parts", None):
                text = "".join(
                    (p.text or "") for p in content.parts if getattr(p, "text", None)
                )
            yield {
                "type": "worker.frame",
                "task_id": worker.task_id if worker else None,
                "kind": "text" if text else "step",
                "text": text,
            }
    except Exception as exc:  # noqa: BLE001
        logger.exception("Ephemeral worker step failed")
        yield {
            "type": "worker.frame",
            "task_id": worker.task_id if worker else None,
            "kind": "error",
            "status": "failed",
            "error": str(exc),
        }
        return
    yield {
        "type": "worker.frame",
        "task_id": worker.task_id if worker else None,
        "kind": "done",
        "status": "done",
    }
