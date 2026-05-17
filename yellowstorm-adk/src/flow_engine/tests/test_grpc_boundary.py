"""Cross-boundary gRPC wire-format test.

Starts a real gRPC server in-process and connects via a gRPC channel,
exercising actual protobuf serialization/deserialization across the
process boundary (same process, real gRPC wire format).

This validates that:
- RunRequest proto messages round-trip correctly
- RunEvent stream works over real gRPC streaming
- Cancel and ResumeApproval work via real gRPC
"""

from __future__ import annotations

import asyncio
from concurrent import futures
from unittest.mock import patch

import grpc
import pytest
import pytest_asyncio
from google.protobuf.struct_pb2 import Struct
from google.protobuf.json_format import ParseDict

pytest.importorskip("src.grpc_generated.playbook_flow_pb2")
pytest.importorskip("src.grpc_generated.playbook_flow_pb2_grpc")

from src.grpc_generated import playbook_flow_pb2 as pb
from src.grpc_generated import playbook_flow_pb2_grpc as pb_grpc
from src.flow_engine.grpc_service import PlaybookFlowRuntimeServicer


class _MockChunk:
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
            yield _MockChunk(t)


def _make_struct(payload: dict) -> Struct:
    s = Struct()
    ParseDict(payload, s)
    return s


def _linear_snapshot() -> pb.FlowSnapshot:
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
        ],
        control_edges=[
            pb.ControlEdge(id="e1", kind="sequential", source="step-1", target="step-2"),
        ],
        data_bindings=[],
        settings=pb.FlowSettings(recursion_limit=25, max_parallelism=5),
    )


@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture
async def grpc_server_and_port():
    server = grpc.aio.server(futures.ThreadPoolExecutor(max_workers=1))
    servicer = PlaybookFlowRuntimeServicer()
    pb_grpc.add_PlaybookFlowRuntimeServicer_to_server(servicer, server)
    port = server.add_insecure_port("localhost:0")
    await server.start()
    try:
        yield port
    finally:
        await server.stop(grace=1)


@pytest_asyncio.fixture
async def stub(grpc_server_and_port):
    port = grpc_server_and_port
    channel = grpc.aio.insecure_channel(f"localhost:{port}")
    stub = pb_grpc.PlaybookFlowRuntimeStub(channel)
    try:
        yield stub
    finally:
        await channel.close()


@pytest.mark.asyncio
async def test_grpc_boundary_run_linear_flow(stub):
    """Run a linear 2-step flow over real gRPC and verify events."""
    request = pb.RunRequest(
        execution_id="gb-linear-1",
        flow_id="gb-flow",
        owner_id="user-1",
        snapshot=_linear_snapshot(),
        input_context=_make_struct({"query": "hello"}),
        settings=pb.RunSettings(recursion_limit=25, max_parallelism=5),
    )

    with patch(
        "src.flow_engine.nodes.step.litellm.acompletion",
        return_value=_MockAsyncStream(["mock response"]),
    ):
        events = [e async for e in stub.Run(request)]

    assert len(events) > 0, "Expected at least one event"
    event_types = [e.event_type for e in events]
    assert "NodeCompleted" in event_types
    assert "ExecutionCompleted" in event_types

    step1_completed = [e for e in events if e.node_id == "step-1" and e.event_type == "NodeCompleted"]
    assert len(step1_completed) == 1

    exec_completed = [e for e in events if e.event_type == "ExecutionCompleted"]
    assert len(exec_completed) == 1


@pytest.mark.asyncio
async def test_grpc_boundary_cancel_during_human_approval(stub):
    """Cancel over real gRPC stops an execution paused at human_approval."""
    snapshot = pb.FlowSnapshot(
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
        ],
        control_edges=[
            pb.ControlEdge(id="e1", kind="sequential", source="step-1", target="approval-1"),
        ],
        data_bindings=[],
        settings=pb.FlowSettings(recursion_limit=25, max_parallelism=5),
    )

    run_request = pb.RunRequest(
        execution_id="gb-cancel-1",
        flow_id="gb-flow",
        owner_id="user-1",
        snapshot=snapshot,
        input_context=_make_struct({"x": "y"}),
        settings=pb.RunSettings(recursion_limit=25, max_parallelism=5),
    )

    with patch(
        "src.flow_engine.nodes.step.litellm.acompletion",
        return_value=_MockAsyncStream(["mock"]),
    ):
        async def _collect():
            return [e async for e in stub.Run(run_request)]

        run_task = asyncio.create_task(_collect())
        await asyncio.sleep(0.05)

        cancel_req = pb.CancelRequest(execution_id="gb-cancel-1")
        cancel_resp = await stub.Cancel(cancel_req)
        assert cancel_resp.cancelled

        events = await run_task
        assert len(events) > 0
        event_types = [e.event_type for e in events]
        assert "ApprovalRequested" in event_types

        cancel_resp2 = await stub.Cancel(cancel_req)
        assert not cancel_resp2.cancelled


@pytest.mark.asyncio
async def test_grpc_boundary_resume_approval_unknown(stub):
    """ResumeApproval for non-existent execution returns resumed=False over real gRPC."""
    request = pb.ResumeApprovalRequest(
        execution_id="gb-nonexistent",
        decision="approved",
        payload=_make_struct({"reason": "looks good"}),
    )
    response = await stub.ResumeApproval(request)
    assert not response.resumed
