"""WP03: execution-scope / execution-trace proto round-trip on ADK 2.11 stubs.

Covers plan §9.2 seam: the backend may attach a trusted ExecutionScope to
RunSingleAgent/RunAgentTeam requests and ExecutionTrace to StreamChunks; unset
fields keep exact legacy semantics (no scope, no trace).
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from src.grpc_generated import chatbot_pb2 as pb  # noqa: E402


def test_execution_scope_round_trip():
    req = pb.RunSingleAgentRequest(
        execution_scope=pb.ExecutionScope(
            execution_role=pb.EXECUTION_ROLE_ROOT,
            execution_id="exec_abc",
            conversation_epoch=3,
            depth=0,
            resume_intent="start",
            immutable_snapshot_ref="sha256:deadbeef",
        )
    )
    back = pb.RunSingleAgentRequest.FromString(req.SerializeToString())
    assert back.execution_scope.execution_role == pb.EXECUTION_ROLE_ROOT
    assert back.execution_scope.execution_id == "exec_abc"
    assert back.execution_scope.conversation_epoch == 3
    assert back.execution_scope.resume_intent == "start"
    assert back.execution_scope.immutable_snapshot_ref == "sha256:deadbeef"


def test_execution_scope_defaults_legacy():
    legacy = pb.RunSingleAgentRequest()
    assert not legacy.HasField("execution_scope")
    assert legacy.execution_scope.execution_role == pb.EXECUTION_ROLE_UNSPECIFIED
    team = pb.RunAgentTeamRequest()
    assert not team.HasField("execution_scope")


def test_worker_roles_exist_and_differ_from_root():
    assert pb.EXECUTION_ROLE_LIBRARY_WORKER != pb.EXECUTION_ROLE_ROOT
    assert pb.EXECUTION_ROLE_TEMPORARY_WORKER != pb.EXECUTION_ROLE_ROOT
    assert pb.EXECUTION_ROLE_FANOUT_DRIVER != pb.EXECUTION_ROLE_ROOT
    assert pb.EXECUTION_ROLE_FOLLOWUP != pb.EXECUTION_ROLE_ROOT


def test_execution_trace_round_trip_on_stream_chunk():
    chunk = pb.StreamChunk(
        action="add",
        execution_trace=pb.ExecutionTrace(
            work_group_id="wg_1",
            execution_id="exec_child",
            parent_execution_id="exec_root",
            native_invocation_id="inv_9",
            source_event_id="evt_3",
            producer_agent_id="agent_77",
            producer_role=pb.EXECUTION_ROLE_LIBRARY_WORKER,
            lifecycle=pb.INVOCATION_LIFECYCLE_STATE_COMPLETED,
        ),
    )
    back = pb.StreamChunk.FromString(chunk.SerializeToString())
    trace = back.execution_trace
    assert trace.work_group_id == "wg_1"
    assert trace.parent_execution_id == "exec_root"
    assert trace.producer_role == pb.EXECUTION_ROLE_LIBRARY_WORKER
    assert trace.lifecycle == pb.INVOCATION_LIFECYCLE_STATE_COMPLETED


def test_lifecycle_states_are_distinct():
    states = {
        pb.INVOCATION_LIFECYCLE_STATE_UNSPECIFIED,
        pb.INVOCATION_LIFECYCLE_STATE_STARTED,
        pb.INVOCATION_LIFECYCLE_STATE_WAITING,
        pb.INVOCATION_LIFECYCLE_STATE_COMPLETED,
        pb.INVOCATION_LIFECYCLE_STATE_CANCELLED,
        pb.INVOCATION_LIFECYCLE_STATE_RETRYABLE_INTERRUPTION,
        pb.INVOCATION_LIFECYCLE_STATE_FAILED,
    }
    assert len(states) == 7
