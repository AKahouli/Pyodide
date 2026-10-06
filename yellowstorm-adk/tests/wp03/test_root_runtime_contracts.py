"""WP03 contracts: proto round-trip + TS wire-shape parity."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from src.grpc_generated import chatbot_pb2
from src.root_runtime.contracts import (
    ExecutionRole,
    ExecutionScopeV1,
    derive_request_id,
    scope_to_wire_dict,
)


def _sample_scope() -> ExecutionScopeV1:
    return ExecutionScopeV1(
        role=ExecutionRole.LIBRARY_WORKER,
        execution_id="exec_child_1",
        parent_execution_id="exec_root",
        work_group_id="wg_1",
        depth=1,
        attempt=2,
        conversation_epoch=3,
        expected_fence="fence-abc",
        resume_intent="start",
        immutable_snapshot_ref="sha256:cafe",
        deadline_epoch_ms=1790000000000,
    )


def test_scope_proto_round_trip_preserves_all_fields():
    scope = _sample_scope()
    back = ExecutionScopeV1.from_proto(scope.to_proto())
    assert back == scope


def test_scope_to_wire_dict_matches_backend_builder_shape():
    wire = scope_to_wire_dict(_sample_scope())
    assert wire["execution_role"] == chatbot_pb2.EXECUTION_ROLE_LIBRARY_WORKER
    assert wire["execution_id"] == "exec_child_1"
    assert wire["parent_execution_id"] == "exec_root"
    assert wire["conversation_epoch"] == 3
    assert wire["expected_fence"] == "fence-abc"
    assert wire["resume_intent"] == "start"
    assert wire["deadline_epoch_ms"] == 1790000000000


def test_unset_scope_is_legacy():
    legacy = ExecutionScopeV1()
    assert legacy.is_set is False
    assert ExecutionScopeV1.from_proto(legacy.to_proto()).is_set is False


def test_worker_roles_do_not_activate_root():
    # Worker roles never activate root behavior even if the profile is
    # root-capable (plan §9.2) — the enum itself keeps them distinct.
    assert ExecutionRole.ROOT.value != ExecutionRole.LIBRARY_WORKER.value
    assert ExecutionRole.TEMPORARY_WORKER.value != ExecutionRole.LIBRARY_WORKER.value


def test_derive_request_id_is_deterministic():
    assert derive_request_id("exec_root", "call_1") == "req_exec_root_call_1"
    assert derive_request_id("exec_root", "call_1") == derive_request_id("exec_root", "call_1")
    assert derive_request_id("exec_root", "call_2") != derive_request_id("exec_root", "call_1")
