"""PlaybookFlowRuntime gRPC servicer implementation.

Implements the three RPCs from playbook-flow.proto:
  - Run (server-streaming) — accepts a RunRequest, emits RunEvents
  - Cancel (unary)
  - ResumeApproval (unary)
"""

from __future__ import annotations

from typing import Any, AsyncGenerator, Optional

import grpc
from google.protobuf.json_format import MessageToDict
from google.protobuf.struct_pb2 import Struct, Value
from structlog import get_logger

from src.flow_engine.builder import compose
from src.flow_engine.runtime.checkpointer import get_checkpointer
from src.flow_engine.runtime.events import emit_events
from src.flow_engine.runtime.invoker import stream_graph
from src.flow_engine.state import ExecutionState

logger = get_logger(__name__)

try:
    from src.grpc_generated import playbook_flow_pb2 as pb
    from src.grpc_generated import playbook_flow_pb2_grpc as pb_grpc
except ImportError:
    pb = None
    pb_grpc = None


def _value_to_python(v: Value) -> Any:
    kind = v.WhichOneof("kind")
    if kind == "null_value":
        return None
    if kind == "number_value":
        return v.number_value
    if kind == "string_value":
        return v.string_value
    if kind == "bool_value":
        return v.bool_value
    if kind == "struct_value":
        return _struct_to_dict(v.struct_value)
    if kind == "list_value":
        return [_value_to_python(item) for item in v.list_value.values]
    return None


def _struct_to_dict(s: Optional[Struct]) -> dict[str, Any]:
    if s is None:
        return {}
    result: dict[str, Any] = {}
    for key, value in s.fields.items():
        result[key] = _value_to_python(value)
    return result


def _snapshot_to_dict(snapshot: Any) -> dict[str, Any]:
    try:
        raw = MessageToDict(snapshot, preserving_proto_field_name=True, including_default_value_fields=False)
    except TypeError:
        raw = MessageToDict(snapshot, preserving_proto_field_name=True)
    return _convert_snapshot(raw)


def _convert_snapshot(raw: dict[str, Any]) -> dict[str, Any]:
    nodes = raw.get("nodes", [])
    for node in nodes:
        metadata = node.pop("metadata", None)
        if metadata:
            raw_metadata = dict(metadata)
            logger.info(
                "[adk] snapshot raw metadata shape",
                node_id=node.get("id"),
                raw_keys=list(raw_metadata.keys()),
                raw_has_fields="fields" in raw_metadata,
            )
            node["metadata"] = _unwrap_metadata_fields(raw_metadata)
            logger.info(
                "[adk] snapshot unwrapped metadata",
                node_id=node.get("id"),
                unwrapped_keys=list(node["metadata"].keys()),
                has_agent="agent" in node["metadata"],
                agent_type=type(node["metadata"].get("agent")).__name__ if "agent" in node["metadata"] else "N/A",
                agent_keys=list(node["metadata"]["agent"].keys()) if isinstance(node["metadata"].get("agent"), dict) else "N/A",
            )
    return raw


def _unwrap_metadata_fields(d: Any) -> Any:
    """Recursively strip 'fields' wrappers that MessageToDict adds for Struct values.

    Metadata is backend-controlled (never direct user input), so every dict whose
    sole key is ``"fields"`` is guaranteed to be a Struct wrapper artifact, never
    legitimate user data. This distinguishes metadata from ``input_context`` and
    ``ResumeApproval.payload`` which are handled via the direct protobuf API and
    must preserve user ``"fields"`` keys intact.
    """
    if isinstance(d, dict):
        if "fields" in d and len(d) == 1:
            return _unwrap_metadata_fields(d["fields"])
        return {k: _unwrap_metadata_fields(v) for k, v in d.items()}
    if isinstance(d, list):
        return [_unwrap_metadata_fields(v) for v in d]
    return d


class PlaybookFlowRuntimeServicer:
    if pb_grpc is not None:
        __super_class__ = pb_grpc.PlaybookFlowRuntimeServicer

    async def Run(self, request: Any, context: grpc.aio.ServicerContext) -> AsyncGenerator[Any, None]:
        execution_id = request.execution_id
        flow_id = request.flow_id

        logger.info("[grpc] Run request received", execution_id=execution_id, flow_id=flow_id)

        snapshot = _snapshot_to_dict(request.snapshot)
        input_context = _struct_to_dict(request.input_context)

        checkpointer = get_checkpointer()
        graph = compose(snapshot, checkpointer)

        initial_state: ExecutionState = {
            "execution_id": execution_id,
            "flow_id": flow_id,
            "inputs": input_context,
            "task_outputs": {},
            "iterations": {},
            "router_decisions": {},
            "errors": [],
            "pending_approval": None,
            "cancelled": False,
        }

        config = {"configurable": {"thread_id": execution_id}}
        event_stream = stream_graph(graph, initial_state, config=config)
        async for event in emit_events(execution_id, event_stream):
            yield event

    async def Cancel(self, request: Any, context: grpc.aio.ServicerContext) -> Any:
        execution_id = request.execution_id
        logger.info("[grpc] Cancel request received", execution_id=execution_id)
        return pb.CancelResponse(cancelled=True)

    async def ResumeApproval(self, request: Any, context: grpc.aio.ServicerContext) -> Any:
        execution_id = request.execution_id
        decision = request.decision
        payload = _struct_to_dict(request.payload)

        logger.info("[grpc] ResumeApproval request received", execution_id=execution_id, decision=decision)
        return pb.ResumeApprovalResponse(resumed=True)
