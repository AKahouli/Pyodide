"""Trusted runtime contracts for root delegation (plan §9.1).

Validated typed objects carried on the request/stream seams — never
model-authored text. TS mirror: YellowStorm/back/src/modules/conversation/
root-work/root-work.types.ts. Proto encoding: chatbot.proto
(ExecutionScope / ExecutionTrace).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional

from src.grpc_generated import chatbot_pb2


class ExecutionRole(str, Enum):
    UNSPECIFIED = "unspecified"
    ROOT = "root"
    LIBRARY_WORKER = "library_worker"
    TEMPORARY_WORKER = "temporary_worker"
    FANOUT_DRIVER = "fanout_driver"
    FOLLOWUP = "followup"


class InvocationLifecycleState(str, Enum):
    UNSPECIFIED = "unspecified"
    STARTED = "started"
    WAITING = "waiting"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    RETRYABLE_INTERRUPTION = "retryable_interruption"
    FAILED = "failed"


# Proto enum ints — must match chatbot.proto exactly.
_ROLE_TO_PROTO = {
    ExecutionRole.UNSPECIFIED: chatbot_pb2.EXECUTION_ROLE_UNSPECIFIED,
    ExecutionRole.ROOT: chatbot_pb2.EXECUTION_ROLE_ROOT,
    ExecutionRole.LIBRARY_WORKER: chatbot_pb2.EXECUTION_ROLE_LIBRARY_WORKER,
    ExecutionRole.TEMPORARY_WORKER: chatbot_pb2.EXECUTION_ROLE_TEMPORARY_WORKER,
    ExecutionRole.FANOUT_DRIVER: chatbot_pb2.EXECUTION_ROLE_FANOUT_DRIVER,
    ExecutionRole.FOLLOWUP: chatbot_pb2.EXECUTION_ROLE_FOLLOWUP,
}
_ROLE_FROM_PROTO = {v: k for k, v in _ROLE_TO_PROTO.items()}

_LIFECYCLE_TO_PROTO = {
    InvocationLifecycleState.UNSPECIFIED: chatbot_pb2.INVOCATION_LIFECYCLE_STATE_UNSPECIFIED,
    InvocationLifecycleState.STARTED: chatbot_pb2.INVOCATION_LIFECYCLE_STATE_STARTED,
    InvocationLifecycleState.WAITING: chatbot_pb2.INVOCATION_LIFECYCLE_STATE_WAITING,
    InvocationLifecycleState.COMPLETED: chatbot_pb2.INVOCATION_LIFECYCLE_STATE_COMPLETED,
    InvocationLifecycleState.CANCELLED: chatbot_pb2.INVOCATION_LIFECYCLE_STATE_CANCELLED,
    InvocationLifecycleState.RETRYABLE_INTERRUPTION: chatbot_pb2.INVOCATION_LIFECYCLE_STATE_RETRYABLE_INTERRUPTION,
    InvocationLifecycleState.FAILED: chatbot_pb2.INVOCATION_LIFECYCLE_STATE_FAILED,
}
_LIFECYCLE_FROM_PROTO = {v: k for k, v in _LIFECYCLE_TO_PROTO.items()}


@dataclass(frozen=True)
class ExecutionScopeV1:
    """Request-path execution scope (proto ExecutionScope).

    Trusted backend code fills this after authorization; the fence/epoch must
    match the conversation control state or the request is rejected. Never
    model-authored.
    """

    role: ExecutionRole = ExecutionRole.UNSPECIFIED
    execution_id: str = ""
    parent_execution_id: Optional[str] = None
    work_group_id: Optional[str] = None
    depth: int = 0
    attempt: int = 1
    conversation_epoch: int = 0
    expected_fence: Optional[str] = None
    resume_intent: str = "start"  # "start" | "resume" | "attach"
    immutable_snapshot_ref: Optional[str] = None
    native_invocation_id: Optional[str] = None
    native_session_id: Optional[str] = None
    deadline_epoch_ms: Optional[int] = None

    @property
    def is_set(self) -> bool:
        return self.role is not ExecutionRole.UNSPECIFIED

    @classmethod
    def from_proto(cls, pb_scope) -> "ExecutionScopeV1":
        return cls(
            role=_ROLE_FROM_PROTO.get(int(pb_scope.execution_role), ExecutionRole.UNSPECIFIED),
            execution_id=str(pb_scope.execution_id or ""),
            parent_execution_id=str(pb_scope.parent_execution_id) or None,
            work_group_id=str(pb_scope.work_group_id) or None,
            depth=int(pb_scope.depth),
            attempt=int(pb_scope.attempt) or 1,
            conversation_epoch=int(pb_scope.conversation_epoch),
            expected_fence=str(pb_scope.expected_fence) or None,
            resume_intent=str(pb_scope.resume_intent or "start"),
            immutable_snapshot_ref=str(pb_scope.immutable_snapshot_ref) or None,
            native_invocation_id=str(pb_scope.native_invocation_id) or None,
            native_session_id=str(pb_scope.native_session_id) or None,
            deadline_epoch_ms=(
                int(pb_scope.deadline_epoch_ms) if pb_scope.deadline_epoch_ms else None
            ),
        )

    def to_proto(self) -> "chatbot_pb2.ExecutionScope":
        return chatbot_pb2.ExecutionScope(
            execution_role=_ROLE_TO_PROTO[self.role],
            execution_id=self.execution_id,
            parent_execution_id=self.parent_execution_id or "",
            work_group_id=self.work_group_id or "",
            depth=self.depth,
            attempt=self.attempt,
            conversation_epoch=self.conversation_epoch,
            expected_fence=self.expected_fence or "",
            resume_intent=self.resume_intent,
            immutable_snapshot_ref=self.immutable_snapshot_ref or "",
            native_invocation_id=self.native_invocation_id or "",
            native_session_id=self.native_session_id or "",
            deadline_epoch_ms=self.deadline_epoch_ms or 0,
        )


@dataclass(frozen=True)
class ContextPacketV1:
    """Bounded context packet handed to a child (plan §6.5)."""

    task: str
    expected_output: Optional[str] = None
    root_summary: Optional[str] = None
    context_refs: List[str] = field(default_factory=list)


@dataclass(frozen=True)
class DelegateResultV1:
    """Typed result registered before parent synthesis (plan §12.2).

    Built from captured tool/runtime events — never parsed from the child's
    prose claims. waiting/cancelled/outcome_unknown/failed stay distinct.
    """

    execution_id: str
    producer_role: ExecutionRole
    status: str  # running|waiting|completed|cancelled|failed|outcome_unknown
    text: Optional[str] = None
    citation_refs: List[str] = field(default_factory=list)
    artifact_refs: List[str] = field(default_factory=list)
    safe_error: Optional[str] = None
    producer_agent_id: Optional[str] = None


@dataclass(frozen=True)
class ExecutionEventV1:
    """Stream-side lineage stamped onto producer events (proto ExecutionTrace)."""

    execution_id: str
    producer_role: ExecutionRole
    lifecycle: InvocationLifecycleState = InvocationLifecycleState.UNSPECIFIED
    work_group_id: Optional[str] = None
    parent_execution_id: Optional[str] = None
    producer_agent_id: Optional[str] = None
    source_event_id: Optional[str] = None

    def to_proto(self) -> "chatbot_pb2.ExecutionTrace":
        return chatbot_pb2.ExecutionTrace(
            work_group_id=self.work_group_id or "",
            execution_id=self.execution_id,
            parent_execution_id=self.parent_execution_id or "",
            source_event_id=self.source_event_id or "",
            producer_agent_id=self.producer_agent_id or "",
            producer_role=_ROLE_TO_PROTO[self.producer_role],
            lifecycle=_LIFECYCLE_TO_PROTO[self.lifecycle],
        )

    def to_wire_dict(self) -> Dict[str, Any]:
        """Snake_case dict matching the backend wire shape (for queue chunks)."""
        return {
            "work_group_id": self.work_group_id or "",
            "execution_id": self.execution_id,
            "parent_execution_id": self.parent_execution_id or "",
            "native_invocation_id": "",
            "source_event_id": self.source_event_id or "",
            "producer_agent_id": self.producer_agent_id or "",
            "producer_role": _ROLE_TO_PROTO[self.producer_role],
            "lifecycle": _LIFECYCLE_TO_PROTO[self.lifecycle],
        }


def derive_request_id(parent_execution_id: str, native_call_id: str) -> str:
    """Child request id derived from the parent execution + native call identity."""
    return f"req_{parent_execution_id}_{native_call_id}"


def scope_to_wire_dict(scope: ExecutionScopeV1) -> Dict[str, Any]:
    """Scope as snake_case wire dict (the backend builder's execution_scope)."""
    return {
        "execution_role": _ROLE_TO_PROTO[scope.role],
        "execution_id": scope.execution_id,
        "parent_execution_id": scope.parent_execution_id or "",
        "work_group_id": scope.work_group_id or "",
        "depth": scope.depth,
        "attempt": scope.attempt,
        "conversation_epoch": scope.conversation_epoch,
        "expected_fence": scope.expected_fence or "",
        "resume_intent": scope.resume_intent,
        "immutable_snapshot_ref": scope.immutable_snapshot_ref or "",
        "native_invocation_id": scope.native_invocation_id or "",
        "native_session_id": scope.native_session_id or "",
        "deadline_epoch_ms": scope.deadline_epoch_ms,
    }
