"""gRPC event emission — wraps state transitions into RunEvent messages."""

from __future__ import annotations

from typing import Any, AsyncGenerator, Optional

from google.protobuf import timestamp_pb2
from google.protobuf.struct_pb2 import Struct
from google.protobuf.json_format import ParseDict
from structlog import get_logger

from src.flow_engine.state import ExecutionState

logger = get_logger(__name__)

EVENT_NODE_STARTED = "NodeStarted"
EVENT_NODE_COMPLETED = "NodeCompleted"
EVENT_NODE_FAILED = "NodeFailed"
EVENT_ROUTER_DECISION = "RouterDecision"
EVENT_ITERATION_INCREMENTED = "IterationIncremented"
EVENT_APPROVAL_REQUESTED = "ApprovalRequested"
EVENT_APPROVAL_RESOLVED = "ApprovalResolved"
EVENT_EXECUTION_COMPLETED = "ExecutionCompleted"
EVENT_EXECUTION_FAILED = "ExecutionFailed"


def _make_struct(payload: dict[str, Any]) -> Struct:
    s = Struct()
    ParseDict(payload, s)
    return s


def _make_timestamp() -> timestamp_pb2.Timestamp:
    t = timestamp_pb2.Timestamp()
    t.GetCurrentTime()
    return t


async def emit_events(
    execution_id: str,
    event_stream: AsyncGenerator[dict[str, Any], None],
) -> AsyncGenerator[Any, None]:
    try:
        async for event in event_stream:
            for node_id, update in event.items():
                if isinstance(update, dict):
                    yield _build_event(EVENT_NODE_STARTED, execution_id, node_id, update)
        yield _build_event(EVENT_EXECUTION_COMPLETED, execution_id, "", {})
    except Exception as e:
        yield _build_event(EVENT_EXECUTION_FAILED, execution_id, "", {"error": str(e)})


def _build_event(
    event_type: str,
    execution_id: str,
    node_id: str,
    payload: dict[str, Any],
) -> Any:
    from src.grpc_generated.playbook_flow_pb2 import RunEvent

    event = RunEvent(
        event_type=event_type,
        execution_id=execution_id,
        node_id=node_id,
        payload=_make_struct(payload),
        timestamp=_make_timestamp(),
    )
    return event
