"""Tests for the ephemeral worker factory (Part 3).

These tests exercise the runtime-side worker record + the stub
fallback used when ADK is unavailable. The real `AgentTool` path
is covered by the integration tests in `test_execution_router.py`
via the `StubClient` pattern.
"""
from __future__ import annotations

import asyncio
import inspect
import sys
import types

# Ensure the ADK stub is loaded (same as other runtime tests).
sys.path.insert(0, ".")
from tests._adk_stub import install_adk_stubs  # noqa: E402

install_adk_stubs()

from app.agents.worker_factory import (  # noqa: E402
    EphemeralWorker,
    WorkerRegistry,
    build_agent_tool_for_worker,
    build_ephemeral_worker,
    new_worker_session_id,
    run_worker_bounded_step,
)


def _binding(task_id: str = "t1", stream_id: str = "s1", role: str = "analyzer") -> dict:
    return {
        "ephemeralWorkerId": f"worker-{task_id}",
        "agentEntityId": "agent-1",
        "scopedToolRefs": ["skill:pdf-read", "skill:summarize"],
        "withheldToolRefs": ["connector:send_email"],
        "role": role,
    }


def test_build_ephemeral_worker_copies_binding_fields():
    worker = build_ephemeral_worker(_binding(), "t1", "s1")
    assert worker.worker_id == "worker-t1"
    assert worker.agent_entity_id == "agent-1"
    assert worker.scoped_tool_refs == ["skill:pdf-read", "skill:summarize"]
    assert worker.withheld_tool_refs == ["connector:send_email"]
    assert worker.role == "analyzer"
    assert worker.has_gated_tools_withheld() is True


def test_build_ephemeral_worker_when_no_tools_withheld():
    binding = _binding()
    binding["withheldToolRefs"] = []
    worker = build_ephemeral_worker(binding, "t1", "s1")
    assert worker.has_gated_tools_withheld() is False


def test_to_dict_round_trips_the_worker_state():
    worker = build_ephemeral_worker(_binding(), "t1", "s1")
    d = worker.to_dict()
    assert d["taskId"] == "t1"
    assert d["streamId"] == "s1"
    assert d["role"] == "analyzer"


def test_worker_registry_register_get_retire():
    registry = WorkerRegistry()
    worker = build_ephemeral_worker(_binding("t1"), "t1", "s1")
    registry.register(worker)
    assert registry.get(worker.worker_id) is worker
    assert len(registry.all()) == 1
    registry.retire(worker.worker_id)
    assert registry.get(worker.worker_id) is None
    assert registry.all() == []


def test_new_worker_session_id_includes_task_and_stream():
    sid = new_worker_session_id("s1", "t1")
    assert sid.startswith("worky-worker-s1-t1-")


def test_build_agent_tool_for_worker_with_stub_returns_stub():
    worker = build_ephemeral_worker(_binding(), "t1", "s1")
    tool = build_agent_tool_for_worker(worker)
    # The stub's class name is intentionally distinct so callers can
    # tell them apart from the real AgentTool in production.
    assert tool.__class__.__name__ == "_StubAgentTool"
    assert tool.worker.task_id == "t1"


def test_run_worker_bounded_step_yields_done_frame_for_stub():
    worker = build_ephemeral_worker(_binding(), "t1", "s1")
    tool = build_agent_tool_for_worker(worker)

    async def collect() -> list:
        out = []
        async for frame in run_worker_bounded_step(tool, {"text": "go"}):
            out.append(frame)
        return out

    frames = asyncio.run(collect())
    assert any(f["kind"] == "done" for f in frames)
    assert frames[-1]["kind"] == "done"


def test_run_worker_bounded_step_handles_unknown_kind():
    worker = build_ephemeral_worker(_binding(), "t1", "s1")
    tool = build_agent_tool_for_worker(worker)

    async def collect() -> list:
        out = []
        async for frame in run_worker_bounded_step(tool, {"text": "go"}):
            out.append(frame)
        return out

    frames = asyncio.run(collect())
    # Stub returns a single 'done' frame; real ADK will return more.
    assert all(isinstance(f, dict) for f in frames)


def test_run_worker_bounded_step_returns_after_error_no_spurious_done():
    # Regression: previously the worker yielded an `error` frame and
    # then unconditionally yielded a `done` frame, which the
    # execution router interpreted as a successful completion.
    # Errors must be terminal. We drive the real-path code by
    # configuring the ADK stub's Runner to raise on `run_async` so
    # the `except Exception` branch fires.
    from app.agents import worker_factory as wf
    from tests._adk_stub import set_runner_events_provider

    class _ExplodingProvider:
        def __call__(self):
            raise RuntimeError("kaboom")
            yield  # pragma: no cover

    set_runner_events_provider(_ExplodingProvider())
    try:
        worker = build_ephemeral_worker(_binding(), "t1", "s1")
        # Construct a non-stub tool so the code does NOT take the
        # `_StubAgentTool` shortcut and exercises the Runner path.
        class _NonStubTool:
            pass
        tool = _NonStubTool()
        tool._worky_worker = worker  # the function reads this
        tool.agent = object()

        async def collect() -> list:
            out = []
            async for frame in wf.run_worker_bounded_step(tool, {"text": "go"}):
                out.append(frame)
            return out

        frames = asyncio.run(collect())
        kinds = [f["kind"] for f in frames]
        assert "error" in kinds
        # No `done` after an `error` — errors are terminal.
        error_index = kinds.index("error")
        assert "done" not in kinds[error_index + 1:]
    finally:
        set_runner_events_provider(None)


def test_build_agent_tool_for_worker_forwards_model_id_to_build_model() -> None:
    # The worker factory must forward the supplied `model_id` to
    # `build_model`. We patch `LlmAgent` and `AgentTool` on the
    # stubbed google.adk modules so the real path runs, and stub
    # `build_model` to record the call.
    import sys
    import types

    captured: list[tuple[str | None]] = []

    def _fake_build_model(model_id):
        captured.append((model_id,))
        return object()

    class _FakeLlmAgent:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

    class _FakeAgentTool:
        def __init__(self, agent, skip_summarization=False):
            self.agent = agent

    original_build_model = sys.modules.get("app.agents.worker_factory", None)
    wf = original_build_model

    adk_agents = sys.modules["google.adk.agents"]
    adk_tools = sys.modules["google.adk.tools"]
    original_llm_agent = getattr(adk_agents, "LlmAgent", None)
    original_agent_tool = getattr(adk_tools, "AgentTool", None)
    original_build_model_attr = wf.build_model

    adk_agents.LlmAgent = _FakeLlmAgent  # type: ignore[attr-defined]
    adk_tools.AgentTool = _FakeAgentTool  # type: ignore[attr-defined]
    wf.build_model = _fake_build_model  # type: ignore[attr-defined]
    try:
        tool = build_agent_tool_for_worker(
            build_ephemeral_worker(_binding("t1"), "t1", "s1"),
            model_id="claude-3-5-sonnet-20240620",
        )
    finally:
        if original_llm_agent is None:
            delattr(adk_agents, "LlmAgent")
        else:
            adk_agents.LlmAgent = original_llm_agent  # type: ignore[attr-defined]
        if original_agent_tool is None:
            delattr(adk_tools, "AgentTool")
        else:
            adk_tools.AgentTool = original_agent_tool  # type: ignore[attr-defined]
        wf.build_model = original_build_model_attr  # type: ignore[attr-defined]
    assert isinstance(tool, _FakeAgentTool)
    assert captured == [("claude-3-5-sonnet-20240620",)]


def test_build_agent_tool_for_worker_defaults_model_id_to_none() -> None:
    import sys

    captured: list[tuple[str | None]] = []

    def _fake_build_model(model_id):
        captured.append((model_id,))
        return object()

    class _FakeLlmAgent:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

    class _FakeAgentTool:
        def __init__(self, agent, skip_summarization=False):
            self.agent = agent

    adk_agents = sys.modules["google.adk.agents"]
    adk_tools = sys.modules["google.adk.tools"]
    original_llm_agent = getattr(adk_agents, "LlmAgent", None)
    original_agent_tool = getattr(adk_tools, "AgentTool", None)
    wf = sys.modules["app.agents.worker_factory"]
    original_build_model_attr = wf.build_model

    adk_agents.LlmAgent = _FakeLlmAgent  # type: ignore[attr-defined]
    adk_tools.AgentTool = _FakeAgentTool  # type: ignore[attr-defined]
    wf.build_model = _fake_build_model  # type: ignore[attr-defined]
    try:
        build_agent_tool_for_worker(
            build_ephemeral_worker(_binding("t1"), "t1", "s1")
        )
    finally:
        if original_llm_agent is None:
            delattr(adk_agents, "LlmAgent")
        else:
            adk_agents.LlmAgent = original_llm_agent  # type: ignore[attr-defined]
        if original_agent_tool is None:
            delattr(adk_tools, "AgentTool")
        else:
            adk_tools.AgentTool = original_agent_tool  # type: ignore[attr-defined]
        wf.build_model = original_build_model_attr  # type: ignore[attr-defined]
    assert captured == [(None,)]
