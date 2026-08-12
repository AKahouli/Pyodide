"""gRPC event emission — wraps state transitions into RunEvent messages.

Supports two stream modes from the invoker:

- ``_mode: "custom"`` → node-emitted events via ``get_stream_writer()``.
  ``{"type": "NodeStarted|NodeCompleted|NodeFailed|token", ...}``.
- ``_mode: "updates"`` → LangGraph state diffs (backward-compatible fallback
  for RouterDecision, ApprovalRequested, NodeFailed from error guards).

Custom events take priority for NodeStarted / NodeCompleted / NodeFailed.
State updates still detect router decisions, approvals, and errors.
"""

from __future__ import annotations

import asyncio
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
EVENT_NODE_SUSPENDED = "NodeSuspended"
EVENT_NODE_TOKEN = "NodeToken"
EVENT_NODE_TRACE_UPDATE = "NodeTraceUpdate"
EVENT_ROUTER_DECISION = "RouterDecision"
EVENT_ITERATION_INCREMENTED = "IterationIncremented"
EVENT_APPROVAL_REQUESTED = "ApprovalRequested"
EVENT_APPROVAL_RESOLVED = "ApprovalResolved"
EVENT_EXECUTION_COMPLETED = "ExecutionCompleted"
EVENT_EXECUTION_FAILED = "ExecutionFailed"

DYNAMIC_REASONING_EVENTS = {
    "DynamicPlanningStarted",
    "DynamicReasoningDecided",
    "DynamicPlanProposed",
    "DynamicPlanValidationFailed",
    "DynamicPlanRepairStarted",
    "DynamicPlanRepaired",
    "RuntimeSubgraphCreated",
    "RuntimeSubgraphCompleted",
    "RuntimeSubgraphFailed",
    "DynamicDirectFallback",
    "DynamicPlanningFailed",
}


def _make_struct(payload: dict[str, Any]) -> Struct:
    s = Struct()
    ParseDict(payload, s)
    return s


def _make_timestamp() -> timestamp_pb2.Timestamp:
    t = timestamp_pb2.Timestamp()
    t.GetCurrentTime()
    return t


def _build_event(
    event_type: str,
    execution_id: str,
    node_id: str,
    payload: dict[str, Any],
    iteration: int = 0,
) -> Any:
    from src.grpc_generated.playbook_flow_pb2 import RunEvent

    return RunEvent(
        event_type=event_type,
        execution_id=execution_id,
        node_id=node_id,
        iteration=iteration,
        payload=_make_struct(payload),
        timestamp=_make_timestamp(),
    )


async def emit_events(
    execution_id: str,
    event_stream: AsyncGenerator[dict[str, Any], None],
) -> AsyncGenerator[Any, None]:
    completed_nodes: set[tuple[str, int]] = set()

    try:
        async for chunk in event_stream:
            mode = chunk.get("_mode")
            data = chunk.get("_data", {})

            if mode == "custom" and isinstance(data, dict):
                event_type = data.get("type")
                if event_type in (EVENT_NODE_STARTED, EVENT_NODE_COMPLETED, EVENT_NODE_FAILED):
                    yield _build_event(
                        event_type,
                        execution_id,
                        str(data.get("node_id", "")),
                        data.get("payload", {}),
                        int(data.get("iteration", 0)),
                    )
                    if event_type == EVENT_NODE_COMPLETED:
                        completed_nodes.add((str(data.get("node_id", "")), int(data.get("iteration", 0))))
                elif event_type == EVENT_NODE_TOKEN:
                    yield _build_event(
                        EVENT_NODE_TOKEN,
                        execution_id,
                        str(data.get("node_id", "")),
                        {"token": str(data.get("token", "")), "node_id": str(data.get("node_id", ""))},
                        int(data.get("iteration", 0)),
                    )
                elif event_type == EVENT_NODE_TRACE_UPDATE:
                    yield _build_event(
                        EVENT_NODE_TRACE_UPDATE,
                        execution_id,
                        str(data.get("node_id", "")),
                        data.get("payload", {}),
                        int(data.get("iteration", 0)),
                    )
                elif event_type == EVENT_NODE_SUSPENDED:
                    yield _build_event(
                        EVENT_NODE_SUSPENDED,
                        execution_id,
                        str(data.get("node_id", "")),
                        data.get("payload", {}),
                        int(data.get("iteration", 0)),
                    )
                elif event_type in DYNAMIC_REASONING_EVENTS:
                    yield _build_event(
                        str(event_type),
                        execution_id,
                        str(data.get("node_id", "")),
                        data.get("payload", {}),
                        int(data.get("iteration", 0)),
                    )
                else:
                    yield _build_event(
                        str(event_type),
                        execution_id,
                        str(data.get("node_id", "")),
                        {k: v for k, v in data.items() if k not in ("type",)},
                        int(data.get("iteration", 0)),
                    )

            elif mode == "updates" or mode is None:
                for node_id, update in data.items() if isinstance(data, dict) else []:
                    if not isinstance(update, dict):
                        continue

                    task_output = _extract_task_output(node_id, update)
                    if task_output is not None:
                        iteration, payload = task_output
                        key = (node_id, iteration)
                        if key not in completed_nodes:
                            yield _build_event(EVENT_NODE_COMPLETED, execution_id, node_id, payload, iteration)
                            completed_nodes.add(key)
                        continue

                    router_decisions = update.get("router_decisions", {})
                    if isinstance(router_decisions, dict) and node_id in router_decisions:
                        yield _build_event(
                            EVENT_ROUTER_DECISION,
                            execution_id,
                            node_id,
                            {"label": router_decisions[node_id]},
                            _extract_iteration(node_id, update),
                        )
                        continue

                    pending = update.get("pending_approval")
                    if isinstance(pending, dict) and pending.get("node_id") == node_id:
                        yield _build_event(
                            EVENT_APPROVAL_REQUESTED,
                            execution_id,
                            node_id,
                            pending,
                            int(pending.get("iteration", 0)),
                        )
                        continue

                    errors = update.get("errors", [])
                    if isinstance(errors, list) and errors:
                        error = errors[-1]
                        if isinstance(error, dict) and error.get("node_id") == node_id:
                            yield _build_event(
                                EVENT_NODE_FAILED,
                                execution_id,
                                node_id,
                                {"error": error.get("message", "Node execution failed")},
                                int(error.get("iteration", 0)),
                            )
                            continue

                    yield _build_event(EVENT_NODE_STARTED, execution_id, node_id, update, _extract_iteration(node_id, update))

    except asyncio.CancelledError:
        raise


def _extract_task_output(node_id: str, update: dict[str, Any]) -> Optional[tuple[int, dict[str, Any]]]:
    task_outputs = update.get("task_outputs", {})
    if not isinstance(task_outputs, dict):
        return None

    for key, payload in task_outputs.items():
        if isinstance(key, tuple) and len(key) == 2 and key[0] == node_id and isinstance(payload, dict):
            return int(key[1]), payload
        if isinstance(payload, dict) and payload.get("node_id") == node_id:
            return int(payload.get("iteration", 0)), payload

    return None


def _extract_iteration(node_id: str, update: dict[str, Any]) -> int:
    iterations = update.get("iterations", {})
    if isinstance(iterations, dict) and node_id in iterations:
        try:
            return max(0, int(iterations[node_id]) - 1)
        except (TypeError, ValueError):
            return 0
    return 0
