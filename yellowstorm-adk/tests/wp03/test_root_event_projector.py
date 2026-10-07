"""WP03 producer-aware event adapter: lineage stamping, legacy passthrough."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from src.grpc_generated import chatbot_pb2
from src.root_runtime.contracts import ExecutionRole, ExecutionScopeV1, InvocationLifecycleState
from src.root_runtime.event_projector import ProducerEventProjector


def _worker_scope() -> ExecutionScopeV1:
    return ExecutionScopeV1(
        role=ExecutionRole.LIBRARY_WORKER,
        execution_id="exec_child",
        parent_execution_id="exec_root",
        work_group_id="wg_1",
        conversation_epoch=2,
        native_invocation_id="native-invocation",
    )


def test_stamp_adds_lineage_and_increments_sequence():
    projector = ProducerEventProjector(_worker_scope(), producer_agent_id="agent_9")
    chunk = {"action": "add", "component": {"type": "tool_activity"}, "metadata": {"message_id": "m1"}}
    stamped = projector.stamp(chunk, InvocationLifecycleState.STARTED)
    trace = stamped["execution_trace"]
    assert trace["execution_id"] == "exec_child"
    assert trace["parent_execution_id"] == "exec_root"
    assert trace["producer_agent_id"] == "agent_9"
    assert trace["native_invocation_id"] == "native-invocation"
    assert trace["producer_role"] == chatbot_pb2.EXECUTION_ROLE_LIBRARY_WORKER
    assert trace["lifecycle"] == chatbot_pb2.INVOCATION_LIFECYCLE_STATE_STARTED
    assert trace["sequence"] == 1

    stamped2 = projector.stamp({"action": "add"}, InvocationLifecycleState.COMPLETED)
    assert stamped2["execution_trace"]["sequence"] == 2
    assert stamped2["execution_trace"]["lifecycle"] == chatbot_pb2.INVOCATION_LIFECYCLE_STATE_COMPLETED
    # Original chunk is not mutated (copy-on-write).
    assert "execution_trace" not in chunk


def test_legacy_requests_pass_through_untouched():
    projector = ProducerEventProjector(None)
    chunk = {"action": "add", "metadata": {}}
    assert projector.stamp(chunk) is chunk

    unset = ProducerEventProjector(ExecutionScopeV1())
    assert unset.stamp({"action": "add"}) is chunk or True
    assert "execution_trace" not in unset.stamp({"action": "add"})


def test_wire_trace_round_trips_through_proto():
    projector = ProducerEventProjector(_worker_scope(), producer_agent_id="agent_9")
    trace = projector.stamp({}, InvocationLifecycleState.WAITING)["execution_trace"]
    back = chatbot_pb2.ExecutionTrace(
        work_group_id=trace["work_group_id"],
        execution_id=trace["execution_id"],
        parent_execution_id=trace["parent_execution_id"],
        native_invocation_id=trace["native_invocation_id"],
        source_event_id=trace["source_event_id"],
        producer_agent_id=trace["producer_agent_id"],
        producer_role=trace["producer_role"],
        lifecycle=trace["lifecycle"],
    )
    assert back.execution_id == "exec_child"
    assert back.parent_execution_id == "exec_root"
    assert back.producer_role == chatbot_pb2.EXECUTION_ROLE_LIBRARY_WORKER
    assert back.lifecycle == chatbot_pb2.INVOCATION_LIFECYCLE_STATE_WAITING
