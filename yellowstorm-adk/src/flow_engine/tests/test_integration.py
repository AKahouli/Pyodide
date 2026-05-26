"""Integration tests: PlaybookFlowRuntimeServicer with real compose/stream/emit.

These tests exercise the full pipeline (compose → stream_graph → emit_events)
through the gRPC servicer interface, only mocking the LLM call.  They verify
that the servicer correctly maps gRPC protobuf messages into graph execution
and that the event structure matches the proto contract.

Requires: conda env with `playbook_flow_pb2`, `google.protobuf`, `litellm`.
"""

from __future__ import annotations

import asyncio
from typing import Any
from unittest.mock import patch

import pytest
import pytest_asyncio
from google.protobuf.struct_pb2 import Struct
from google.protobuf.json_format import ParseDict

pytest.importorskip("src.grpc_generated.playbook_flow_pb2")
pytest.importorskip("google.protobuf.struct_pb2")

from src.grpc_generated import playbook_flow_pb2 as pb
from src.flow_engine.grpc_service import PlaybookFlowRuntimeServicer


class MockIteratorChunk:
    def __init__(self, text: str):
        self.choices = [_MockChoice(text)]


class _MockChoice:
    def __init__(self, text: str):
        self.delta = _MockDelta(text)


class _MockDelta:
    def __init__(self, text: str):
        self.content = text


class _MockAsyncStream:
    def __init__(self, texts: list[str]):
        self.texts = texts

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        for t in self.texts:
            yield MockIteratorChunk(t)


class _MockRouterResponse:
    """Non-streaming LLM response shape expected by router nodes."""
    def __init__(self, label: str):
        self.choices = [_MockRouterChoice(label)]


class _MockRouterChoice:
    def __init__(self, label: str):
        self.message = _MockRouterMessage(label)


class _MockRouterMessage:
    def __init__(self, label: str):
        self.content = label


def _make_struct(payload: dict[str, Any]) -> Struct:
    s = Struct()
    ParseDict(payload, s)
    return s


@pytest.fixture(scope="session")
def event_loop():
    """Reuse the same event loop for the session (required for checkpointer)."""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture(autouse=True)
async def _setup_checkpointer(tmp_path):
    """Initialize a real in-memory checkpointer for tests that need it."""
    from src.flow_engine.runtime.checkpointer import init_checkpointer

    db_path = str(tmp_path / "test_checkpoints.db")
    await init_checkpointer(db_path)
    yield
    from src.flow_engine.runtime.checkpointer import close_checkpointer
    await close_checkpointer()


@pytest.fixture
def servicer():
    return PlaybookFlowRuntimeServicer()


def _linear_snapshot() -> pb.FlowSnapshot:
    """Build a simple linear 3-step snapshot as a protobuf message."""
    return pb.FlowSnapshot(
        nodes=[
            pb.FlowNode(
                id="step-1", kind="step", label="Greet",
                input=pb.FlowNodeInput(raw="", ports=[]),
                output=pb.FlowNodeOutput(raw="", ports=[]),
            ),
            pb.FlowNode(
                id="step-2", kind="step", label="Process",
                input=pb.FlowNodeInput(raw="", ports=[]),
                output=pb.FlowNodeOutput(raw="", ports=[]),
            ),
            pb.FlowNode(
                id="step-3", kind="step", label="Output",
                input=pb.FlowNodeInput(raw="", ports=[]),
                output=pb.FlowNodeOutput(raw="", ports=[]),
            ),
        ],
        control_edges=[
            pb.ControlEdge(id="e1", kind="sequential", source="step-1", target="step-2"),
            pb.ControlEdge(id="e2", kind="sequential", source="step-2", target="step-3"),
        ],
        data_bindings=[],
        settings=pb.FlowSettings(recursion_limit=25, max_parallelism=5),
    )


@pytest.mark.asyncio
async def test_integration_run_linear_flow(servicer):
    """Real compose → stream → emit through servicer.Run()."""
    request = pb.RunRequest(
        execution_id="int-test-linear-1",
        flow_id="int-flow",
        owner_id="user-1",
        snapshot=_linear_snapshot(),
        input_context=_make_struct({"query": "hello"}),
        settings=pb.RunSettings(recursion_limit=25, max_parallelism=5),
    )

    with patch(
        "src.flow_engine.nodes.step.litellm.acompletion",
        return_value=_MockAsyncStream(["mock response"]),
    ):
        events = [event async for event in servicer.Run(request, None)]

    # Verify we got events through the full pipeline
    assert len(events) > 0, "Expected at least one event"

    event_types = [e.event_type for e in events]
    assert "NodeCompleted" in event_types, f"No NodeCompleted in events: {event_types}"
    assert "ExecutionCompleted" in event_types, f"No ExecutionCompleted in events: {event_types}"

    # Verify step-1 completed
    step1_completed = [e for e in events if e.node_id == "step-1" and e.event_type == "NodeCompleted"]
    assert len(step1_completed) == 1, f"Expected 1 step-1 completed, got {len(step1_completed)}"

    # Verify execution completed event
    exec_completed = [e for e in events if e.event_type == "ExecutionCompleted"]
    assert len(exec_completed) == 1


@pytest.mark.asyncio
async def test_integration_run_with_input_context(servicer):
    """Input context Struct is correctly propagated through the pipeline."""
    request = pb.RunRequest(
        execution_id="int-test-input-1",
        flow_id="int-flow",
        owner_id="user-1",
        snapshot=_linear_snapshot(),
        input_context=_make_struct({"user_name": "Alice", "items": ["a", "b"]}),
        settings=pb.RunSettings(recursion_limit=25, max_parallelism=5),
    )

    with patch(
        "src.flow_engine.nodes.step.litellm.acompletion",
        return_value=_MockAsyncStream(["mock response"]),
    ):
        events = [event async for event in servicer.Run(request, None)]

    event_types = [e.event_type for e in events]
    assert "NodeStarted" in event_types
    assert "ExecutionCompleted" in event_types


@pytest.mark.asyncio
async def test_integration_run_empty_snapshot_fails_gracefully(servicer):
    """Empty snapshot should fail with an error event, not crash.

    compose() raises ValueError for empty graphs (no entrypoint).
    The servicer catches this and emits ExecutionFailed.
    """
    request = pb.RunRequest(
        execution_id="int-test-empty-1",
        flow_id="int-flow",
        owner_id="user-1",
        snapshot=pb.FlowSnapshot(nodes=[], control_edges=[], data_bindings=[], settings=None),
        input_context=_make_struct({}),
        settings=pb.RunSettings(recursion_limit=25, max_parallelism=5),
    )

    events = [event async for event in servicer.Run(request, None)]

    assert len(events) > 0
    event_types = [e.event_type for e in events]
    assert "ExecutionFailed" in event_types, f"Expected ExecutionFailed, got: {event_types}"


def _human_approval_snapshot() -> pb.FlowSnapshot:
    """Build a snapshot with a human_approval node that pauses execution."""
    return pb.FlowSnapshot(
        nodes=[
            pb.FlowNode(
                id="step-1", kind="step", label="Greet",
                input=pb.FlowNodeInput(raw="", ports=[]),
                output=pb.FlowNodeOutput(raw="", ports=[]),
            ),
            pb.FlowNode(
                id="approval-1", kind="human_approval", label="Approve?",
                human_approval_config=pb.HumanApprovalConfig(
                    prompt_template="Proceed?",
                    timeout_seconds=0,
                ),
                input=pb.FlowNodeInput(raw="", ports=[]),
                output=pb.FlowNodeOutput(raw="", ports=[]),
            ),
            pb.FlowNode(
                id="step-2", kind="step", label="Finish",
                input=pb.FlowNodeInput(raw="", ports=[]),
                output=pb.FlowNodeOutput(raw="", ports=[]),
            ),
        ],
        control_edges=[
            pb.ControlEdge(id="e1", kind="sequential", source="step-1", target="approval-1"),
            pb.ControlEdge(id="e2", kind="sequential", source="approval-1", target="step-2"),
        ],
        data_bindings=[],
        settings=pb.FlowSettings(recursion_limit=25, max_parallelism=5),
    )


@pytest.mark.asyncio
async def test_integration_cancel_during_human_approval(servicer):
    """Cancel during human approval — verifies cancellation flows through gRPC."""
    request = pb.RunRequest(
        execution_id="int-test-cancel-1",
        flow_id="int-flow",
        owner_id="user-1",
        snapshot=_human_approval_snapshot(),
        input_context=_make_struct({"x": "y"}),
        settings=pb.RunSettings(recursion_limit=25, max_parallelism=5),
    )

    with patch(
        "src.flow_engine.nodes.step.litellm.acompletion",
        return_value=_MockAsyncStream(["mock"]),
    ):
        async def _collect():
            return [e async for e in servicer.Run(request, None)]

        run_task = asyncio.create_task(_collect())

        await asyncio.sleep(0.05)

        cancel_req = pb.CancelRequest(execution_id="int-test-cancel-1")
        cancel_resp = await servicer.Cancel(cancel_req, None)
        assert cancel_resp.cancelled

        events = await run_task
        assert len(events) > 0
        event_types = [e.event_type for e in events]
        assert "ApprovalRequested" in event_types

        cancel_resp2 = await servicer.Cancel(cancel_req, None)
        assert not cancel_resp2.cancelled


@pytest.mark.asyncio
async def test_integration_resume_approval_unknown(servicer):
    """ResumeApproval for non-existent execution returns resumed=False."""
    request = pb.ResumeApprovalRequest(
        execution_id="nonexistent",
        decision="approved",
        payload=_make_struct({"reason": "looks good"}),
    )
    response = await servicer.ResumeApproval(request, None)
    assert not response.resumed


def _iterator_snapshot() -> pb.FlowSnapshot:
    """Build a snapshot with a step node followed by an iterator over items."""
    return pb.FlowSnapshot(
        nodes=[
            pb.FlowNode(
                id="step-1", kind="step", label="Greet",
                input=pb.FlowNodeInput(raw="", ports=[]),
                output=pb.FlowNodeOutput(raw="", ports=[]),
            ),
            pb.FlowNode(
                id="iter-node", kind="iterator", label="Process Items",
                iterator_config=pb.IteratorConfig(
                    collection_path="inputs.items",
                    max_items=0,
                ),
                input=pb.FlowNodeInput(raw="", ports=[]),
                output=pb.FlowNodeOutput(raw="", ports=[]),
            ),
            pb.FlowNode(
                id="child-step", kind="step", label="Per Item",
                input=pb.FlowNodeInput(raw="", ports=[]),
                output=pb.FlowNodeOutput(raw="", ports=[]),
            ),
        ],
        control_edges=[
            pb.ControlEdge(id="e1", kind="sequential", source="step-1", target="iter-node"),
            pb.ControlEdge(id="e2", kind="sequential", source="iter-node", target="child-step"),
        ],
        data_bindings=[],
        settings=pb.FlowSettings(recursion_limit=25, max_parallelism=5),
    )


@pytest.mark.asyncio
async def test_integration_run_iterator_flow_through_servicer(servicer):
    """Iterator flow through servicer.Run — step + iterator with 2 items."""
    request = pb.RunRequest(
        execution_id="int-test-iter-1",
        flow_id="int-flow",
        owner_id="user-1",
        snapshot=_iterator_snapshot(),
        input_context=_make_struct({"items": ["a", "b"]}),
        settings=pb.RunSettings(recursion_limit=25, max_parallelism=5),
    )

    with patch(
        "src.flow_engine.nodes.step.litellm.acompletion",
        return_value=_MockAsyncStream(["mock response"]),
    ):
        events = [event async for event in servicer.Run(request, None)]

    assert len(events) > 0, "Expected at least one event"

    event_types = [e.event_type for e in events]
    assert "NodeCompleted" in event_types, f"No NodeCompleted in events: {event_types}"
    assert "ExecutionCompleted" in event_types, f"No ExecutionCompleted in events: {event_types}"

    iter_completed = [e for e in events if e.node_id == "iter-node" and e.event_type == "NodeCompleted"]
    assert len(iter_completed) == 1, f"Expected 1 iter-node completed, got {len(iter_completed)}"

    step1_completed = [e for e in events if e.node_id == "step-1" and e.event_type == "NodeCompleted"]
    assert len(step1_completed) == 1, f"Expected 1 step-1 completed, got {len(step1_completed)}"

    exec_completed = [e for e in events if e.event_type == "ExecutionCompleted"]
    assert len(exec_completed) == 1


def _looping_snapshot() -> pb.FlowSnapshot:
    """Build a snapshot with an infinite router loop (no max_iterations)."""
    raw = {
        "nodes": [
            {"id": "step-1", "kind": "step", "label": "Start"},
            {"id": "router-1", "kind": "router", "label": "Loop Router", "router_config": {"output_labels": ["retry", "done"]}},
            {"id": "step-final", "kind": "step", "label": "Finalize"},
        ],
        "control_edges": [
            {"id": "e1", "kind": "sequential", "source": "step-1", "target": "router-1"},
            {"id": "e2", "kind": "conditional", "source": "router-1", "target": "step-1", "router_label": "retry"},
            {"id": "e3", "kind": "conditional", "source": "router-1", "target": "step-final", "router_label": "done"},
        ],
        "data_bindings": [],
        "settings": {"recursion_limit": 25, "max_parallelism": 5},
    }
    s = pb.FlowSnapshot()
    ParseDict(raw, s)
    return s


@pytest.mark.asyncio
async def test_recursion_limit_enforced(servicer):
    """Low recursion_limit stops infinite loop and emits ExecutionFailed.

    The fixture has a router that loops back to step-1 with no max_iterations.
    With recursion_limit=3, LangGraph raises GraphRecursionError after 3
    super-steps, which emit_events converts to ExecutionFailed.
    """
    snapshot = _looping_snapshot()

    async def mock_acompletion(*args, **kwargs):
        if kwargs.get("stream", True):
            return _MockAsyncStream(["ok"])
        return _MockRouterResponse("retry")

    with patch("src.flow_engine.nodes.step.litellm.acompletion", side_effect=mock_acompletion), \
         patch("src.flow_engine.nodes.router.litellm.acompletion", side_effect=mock_acompletion):
        request = pb.RunRequest(
            execution_id="int-test-recursion-1",
            flow_id="int-flow",
            owner_id="user-1",
            snapshot=snapshot,
            input_context=_make_struct({}),
            settings=pb.RunSettings(recursion_limit=3, max_parallelism=5),
        )
        events = [event async for event in servicer.Run(request, None)]

    assert len(events) > 0
    event_types = [e.event_type for e in events]
    assert "ExecutionFailed" in event_types, f"Expected ExecutionFailed, got: {event_types}"
