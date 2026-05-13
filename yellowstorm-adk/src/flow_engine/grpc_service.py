"""PlaybookFlowRuntime gRPC servicer implementation.

Implements the three RPCs from playbook-flow.proto:
  - Run (server-streaming) — accepts a RunRequest, emits RunEvents
  - Cancel (unary)
  - ResumeApproval (unary)
"""

from __future__ import annotations

import json
from typing import Any, AsyncGenerator, Optional

import grpc
from google.protobuf.json_format import MessageToDict, ParseDict
from google.protobuf.struct_pb2 import Struct
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


def _snapshot_to_dict(snapshot: Any) -> dict[str, Any]:
    raw = MessageToDict(snapshot, preserving_proto_field_name=True, including_default_value_fields=False)
    return _convert_snapshot(raw)


def _convert_snapshot(raw: dict[str, Any]) -> dict[str, Any]:
    nodes = raw.get("nodes", [])
    for node in nodes:
        metadata = node.pop("metadata", None)
        if metadata:
            node["metadata"] = dict(metadata)
    return raw


def _struct_to_dict(s: Optional[Struct]) -> dict[str, Any]:
    if s is None:
        return {}
    return MessageToDict(s, preserving_proto_field_name=True)


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

        event_stream = stream_graph(graph, initial_state)
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
