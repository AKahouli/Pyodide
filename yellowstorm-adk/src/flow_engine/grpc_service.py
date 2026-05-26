"""PlaybookFlowRuntime gRPC servicer implementation.

Implements the runtime RPCs from playbook-flow.proto:
  - Run (server-streaming) — accepts a RunRequest, emits RunEvents
  - Cancel (unary)
  - ResumeApproval (unary)
  - ResumeFromStep (unary)
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any, AsyncGenerator, Optional

import grpc
from langgraph.types import Command
from structlog import get_logger

from src.flow_engine.builder import compose
from src.flow_engine.grpc_contract import (
    should_emit_fallback_completion,
    snapshot_to_dict,
    struct_to_dict,
)
from src.flow_engine.runtime.checkpointer import ensure_checkpointer, get_checkpointer
from src.flow_engine.runtime.events import (
    EVENT_APPROVAL_REQUESTED,
    EVENT_APPROVAL_RESOLVED,
    EVENT_EXECUTION_COMPLETED,
    EVENT_EXECUTION_FAILED,
    EVENT_NODE_SUSPENDED,
    _build_event,
    emit_events,
)
from src.flow_engine.runtime.invoker import stream_graph
from src.flow_engine.state import ExecutionState

logger = get_logger(__name__)


def _seed_task_outputs(request: Any) -> tuple[dict[tuple[str, int], Any], dict[str, int]]:
    task_outputs: dict[tuple[str, int], Any] = {}
    iterations: dict[str, int] = {}

    for item in getattr(request, "seeded_task_outputs", []) or []:
        node_id = str(getattr(item, "node_id", "") or "").strip()
        if not node_id:
            continue
        try:
            iteration = max(0, int(getattr(item, "iteration", 0) or 0))
        except (TypeError, ValueError):
            iteration = 0
        payload = struct_to_dict(getattr(item, "payload", None))
        task_outputs[(node_id, iteration)] = payload
        iterations[node_id] = max(iterations.get(node_id, 0), iteration + 1)

    return task_outputs, iterations

try:
    from src.grpc_generated import playbook_flow_pb2 as pb
    from src.grpc_generated import playbook_flow_pb2_grpc as pb_grpc
except ImportError:
    pb = None
    pb_grpc = None


class PlaybookFlowRuntimeServicer:
    if pb_grpc is not None:
        __super_class__ = pb_grpc.PlaybookFlowRuntimeServicer

    def __init__(self) -> None:
        self._active_executions: dict[str, _ActiveExecution] = {}

    async def Run(self, request: Any, context: grpc.aio.ServicerContext) -> AsyncGenerator[Any, None]:
        execution_id = request.execution_id
        flow_id = request.flow_id

        logger.info("[grpc] Run request received", execution_id=execution_id, flow_id=flow_id)

        snapshot = snapshot_to_dict(request.snapshot)
        input_context = struct_to_dict(request.input_context)

        graph = None
        active = None

        try:
            checkpointer = get_checkpointer()
            if checkpointer is None:
                checkpointer = await ensure_checkpointer()
            graph = compose(snapshot, checkpointer)

            recursion_limit = _pick_positive_setting(
                getattr(request.settings, "recursion_limit", 0),
                snapshot.get("settings", {}).get("recursion_limit", 0),
                25,
            )
            max_parallelism = _pick_positive_setting(
                getattr(request.settings, "max_parallelism", 0),
                snapshot.get("settings", {}).get("max_parallelism", 0),
                5,
            )
            seeded_task_outputs, seeded_iterations = _seed_task_outputs(request)

            initial_state: ExecutionState = {
                "execution_id": execution_id,
                "flow_id": flow_id,
                "inputs": input_context,
                "task_outputs": seeded_task_outputs,
                "iterations": seeded_iterations,
                "router_decisions": {},
                "errors": [],
                "pending_approval": None,
                "cancelled": False,
            }

            config = {"configurable": {"thread_id": execution_id}}
            active = _ActiveExecution(graph=graph, config=config)
            self._active_executions[execution_id] = active

            graph_input: Any = initial_state
            saw_terminal_event = False

            while True:
                active.current_task = asyncio.current_task()

                try:
                    event_stream = stream_graph(
                        graph,
                        graph_input,
                        recursion_limit=recursion_limit,
                        max_parallelism=max_parallelism,
                        config=config,
                    )
                    async for event in emit_events(execution_id, event_stream):
                        if event.event_type in (EVENT_EXECUTION_COMPLETED, EVENT_EXECUTION_FAILED):
                            saw_terminal_event = True
                        if event.event_type == EVENT_APPROVAL_REQUESTED:
                            active.waiting_for_approval = True
                            active.pending_interrupt = None
                        elif event.event_type == EVENT_NODE_SUSPENDED:
                            active.waiting_for_step_resume = True
                            active.pending_interrupt = {
                                "node_id": event.node_id,
                                "iteration": event.iteration,
                                "interrupt_id": struct_to_dict(event.payload).get("interrupt_id", ""),
                            }
                        elif event.event_type == EVENT_APPROVAL_RESOLVED:
                            active.waiting_for_approval = False
                        elif active.should_clear_step_resume(event.node_id, event.iteration):
                            active.waiting_for_step_resume = False
                            active.pending_interrupt = None
                        yield event
                except asyncio.CancelledError:
                    logger.info("[grpc] Run cancelled", execution_id=execution_id)
                    return
                finally:
                    active.current_task = None

                if active.cancelled:
                    return

                if active.waiting_for_approval or active.waiting_for_step_resume or active.pending_resume_input is not None:
                    graph_input = await active.next_resume_input()
                    continue

                active.terminal = True
                if should_emit_fallback_completion(saw_terminal_event):
                    yield _build_event(EVENT_EXECUTION_COMPLETED, execution_id, "", {}, 0)
                return
        except asyncio.CancelledError:
            logger.info("[grpc] Run cancelled while awaiting control input", execution_id=execution_id)
            return
        except Exception as exc:
            logger.exception("[grpc] Run failed", execution_id=execution_id)
            if active is not None:
                active.terminal = True
            yield _build_event(EVENT_EXECUTION_FAILED, execution_id, "", {"error": str(exc)}, 0)
        finally:
            self._active_executions.pop(execution_id, None)

    async def Cancel(self, request: Any, context: grpc.aio.ServicerContext) -> Any:
        execution_id = request.execution_id
        logger.info("[grpc] Cancel request received", execution_id=execution_id)
        active = self._active_executions.get(execution_id)
        cancelled = active.cancel() if active is not None else False
        return pb.CancelResponse(cancelled=cancelled)

    async def ResumeApproval(self, request: Any, context: grpc.aio.ServicerContext) -> Any:
        execution_id = request.execution_id
        decision = request.decision
        payload = struct_to_dict(request.payload)

        logger.info("[grpc] ResumeApproval request received", execution_id=execution_id, decision=decision)
        active = self._active_executions.get(execution_id)
        if active is None:
            if pb is None:
                return {"resumed": False}
            return pb.ResumeApprovalResponse(resumed=False)

        resumed = active.set_resume_input(Command(resume={"decision": decision, "payload": payload}))
        if pb is None:
            return {"resumed": resumed}
        return pb.ResumeApprovalResponse(resumed=resumed)

    async def ResumeFromStep(self, request: Any, context: grpc.aio.ServicerContext) -> Any:
        execution_id = request.execution_id
        node_id = request.node_id
        iteration = int(request.iteration or 0)
        interrupt_id = request.interrupt_id
        payload = struct_to_dict(request.payload)

        logger.info(
            "[grpc] ResumeFromStep request received",
            execution_id=execution_id,
            node_id=node_id,
            iteration=iteration,
            interrupt_id=interrupt_id,
        )
        active = self._active_executions.get(execution_id)
        if active is None:
            if pb is None:
                return {"resumed": False}
            return pb.ResumeFromStepResponse(resumed=False)

        resume_payload = dict(payload)
        action = str(getattr(request, "action", "") or "").strip()
        if action and "action" not in resume_payload:
            resume_payload["action"] = action

        resumed = active.set_step_resume_input(
            Command(resume=resume_payload),
            node_id=node_id,
            iteration=iteration,
            interrupt_id=interrupt_id,
        )
        if pb is None:
            return {"resumed": resumed}
        return pb.ResumeFromStepResponse(resumed=resumed)


def _pick_positive_setting(primary: Any, secondary: Any, default: int) -> int:
    for value in (primary, secondary):
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            continue
        if parsed > 0:
            return parsed
    return default


@dataclass
class _ActiveExecution:
    graph: Any
    config: dict[str, Any]
    waiting_for_approval: bool = False
    waiting_for_step_resume: bool = False
    cancelled: bool = False
    terminal: bool = False
    current_task: Optional[asyncio.Task[Any]] = None
    resume_future: Optional[asyncio.Future[Any]] = None
    pending_resume_input: Any = None
    pending_interrupt: Optional[dict[str, Any]] = None

    def should_clear_step_resume(self, node_id: str, iteration: int) -> bool:
        if not self.waiting_for_step_resume or not isinstance(self.pending_interrupt, dict):
            return False

        expected_node_id = str(self.pending_interrupt.get("node_id") or "")
        expected_iteration = int(self.pending_interrupt.get("iteration") or 0)
        return expected_node_id == node_id and expected_iteration == iteration

    def cancel(self) -> bool:
        if self.cancelled or self.terminal:
            return False

        self.cancelled = True
        if self.current_task is not None and not self.current_task.done():
            self.current_task.cancel()
        if self.resume_future is not None and not self.resume_future.done():
            self.resume_future.cancel()
        return True

    def set_resume_input(self, graph_input: Any) -> bool:
        if not self.waiting_for_approval or self.cancelled:
            return False
        if self.pending_resume_input is not None:
            return False

        if self.resume_future is not None and not self.resume_future.done():
            self.resume_future.set_result(graph_input)
        else:
            self.pending_resume_input = graph_input
        self.waiting_for_approval = False
        return True

    def set_step_resume_input(
        self,
        graph_input: Any,
        *,
        node_id: str,
        iteration: int,
        interrupt_id: str,
    ) -> bool:
        if not self.waiting_for_step_resume or self.cancelled:
            return False
        if self.pending_resume_input is not None:
            return False
        if not isinstance(self.pending_interrupt, dict):
            return False

        expected_node_id = str(self.pending_interrupt.get("node_id") or "")
        expected_iteration = int(self.pending_interrupt.get("iteration") or 0)
        expected_interrupt_id = str(self.pending_interrupt.get("interrupt_id") or "")

        if expected_node_id != node_id or expected_iteration != iteration:
            return False
        if interrupt_id and expected_interrupt_id and expected_interrupt_id != interrupt_id:
            return False

        if self.resume_future is not None and not self.resume_future.done():
            self.resume_future.set_result(graph_input)
        else:
            self.pending_resume_input = graph_input
        self.waiting_for_step_resume = False
        self.pending_interrupt = None
        return True

    async def next_resume_input(self) -> Any:
        if self.pending_resume_input is not None:
            graph_input = self.pending_resume_input
            self.pending_resume_input = None
            return graph_input

        loop = asyncio.get_running_loop()
        future: asyncio.Future[Any] = loop.create_future()
        self.resume_future = future
        try:
            return await future
        finally:
            if self.resume_future is future:
                self.resume_future = None
