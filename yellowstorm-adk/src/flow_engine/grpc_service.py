"""PlaybookFlowRuntime gRPC servicer implementation.

Implements the runtime RPCs from playbook-flow.proto:
  - Run (server-streaming) — accepts a RunRequest, emits RunEvents
  - Cancel (unary)
  - ResumeApproval (unary)
  - ResumeFromStep (unary)
  - RunFromCheckpoint (server-streaming) — replays from a historical checkpoint
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from typing import Any, AsyncGenerator, Optional

import grpc
from langgraph.checkpoint.base import copy_checkpoint
from langgraph.types import Command
from structlog import get_logger

from src.flow_engine.builder import compose
from src.config.settings import get_settings
from src.flow_engine.grpc_contract import (
    should_emit_fallback_completion,
    snapshot_to_dict,
    struct_to_dict,
)
from src.flow_engine.runtime.graph_cache import CompiledGraphCache
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
app_settings = get_settings()
compiled_graph_cache = CompiledGraphCache(
    max_entries=app_settings.PLAYBOOK_GRAPH_CACHE_MAX_ENTRIES,
    ttl_seconds=app_settings.PLAYBOOK_GRAPH_CACHE_TTL_SECONDS,
)


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
            compile_started_at = time.perf_counter()
            cache_mode = "disabled"
            snapshot_key = "disabled"
            if app_settings.PLAYBOOK_GRAPH_CACHE_ENABLED:
                graph, snapshot_key, cache_hit = await compiled_graph_cache.get_or_compile(
                    snapshot,
                    lambda current_snapshot: compose(current_snapshot, checkpointer),
                    cache_scope=str(id(checkpointer)),
                )
                cache_mode = "hit" if cache_hit else "miss"
            else:
                graph = compose(snapshot, checkpointer)
            logger.info(
                "playbook_graph_compile_duration_ms",
                execution_id=execution_id,
                cache=cache_mode,
                snapshot_hash=snapshot_key,
                nodeCount=len(snapshot.get("nodes", [])),
                durationMs=round((time.perf_counter() - compile_started_at) * 1000),
            )
            logger.info("playbook_graph_cache_size", size=compiled_graph_cache.size)

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

    async def RunFromCheckpoint(
        self, request: Any, context: grpc.aio.ServicerContext,
    ) -> AsyncGenerator[Any, None]:
        execution_id = request.execution_id
        source_execution_id = request.source_execution_id
        target_node_id = request.target_node_id
        target_iteration = int(getattr(request, "target_iteration", 0) or 0)

        logger.info(
            "[grpc] RunFromCheckpoint request received",
            execution_id=execution_id,
            source_execution_id=source_execution_id,
            target_node_id=target_node_id,
            target_iteration=target_iteration,
        )

        snapshot = snapshot_to_dict(request.snapshot)
        input_context = struct_to_dict(request.input_context)

        active = None

        try:
            checkpointer = get_checkpointer()
            if checkpointer is None:
                checkpointer = await ensure_checkpointer()
            compile_started_at = time.perf_counter()
            cache_mode = "disabled"
            snapshot_key = "disabled"
            if app_settings.PLAYBOOK_GRAPH_CACHE_ENABLED:
                graph, snapshot_key, cache_hit = await compiled_graph_cache.get_or_compile(
                    snapshot,
                    lambda current_snapshot: compose(current_snapshot, checkpointer),
                    cache_scope=str(id(checkpointer)),
                )
                cache_mode = "hit" if cache_hit else "miss"
            else:
                graph = compose(snapshot, checkpointer)
            logger.info(
                "playbook_graph_compile_duration_ms",
                execution_id=execution_id,
                cache=cache_mode,
                snapshot_hash=snapshot_key,
                nodeCount=len(snapshot.get("nodes", [])),
                durationMs=round((time.perf_counter() - compile_started_at) * 1000),
            )
            logger.info("playbook_graph_cache_size", size=compiled_graph_cache.size)

            replay_config = await _seed_replay_state(
                graph, checkpointer, execution_id, source_execution_id,
                snapshot, input_context, target_node_id, target_iteration,
            )

            if replay_config is None:
                yield _build_event(
                    EVENT_EXECUTION_FAILED,
                    execution_id,
                    "",
                    {"error": f"Could not seed replay state for node {target_node_id}"},
                    0,
                )
                return

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

            active = _ActiveExecution(graph=graph, config=replay_config)
            self._active_executions[execution_id] = active

            graph_input: Any = None
            saw_terminal_event = False

            while True:
                active.current_task = asyncio.current_task()

                try:
                    event_stream = stream_graph(
                        graph,
                        graph_input,
                        recursion_limit=recursion_limit,
                        max_parallelism=max_parallelism,
                        config=replay_config,
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
                    logger.info("[grpc] RunFromCheckpoint cancelled", execution_id=execution_id)
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
            logger.info("[grpc] RunFromCheckpoint cancelled while awaiting control input", execution_id=execution_id)
            return
        except Exception as exc:
            logger.exception("[grpc] RunFromCheckpoint failed", execution_id=execution_id)
            if active is not None:
                active.terminal = True
            yield _build_event(EVENT_EXECUTION_FAILED, execution_id, "", {"error": str(exc)}, 0)
        finally:
            self._active_executions.pop(execution_id, None)


def _pick_positive_setting(primary: Any, secondary: Any, default: int) -> int:
    for value in (primary, secondary):
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            continue
        if parsed > 0:
            return parsed
    return default


async def _seed_replay_state(
    graph: Any,
    checkpointer: Any,
    execution_id: str,
    source_execution_id: str,
    snapshot: dict[str, Any],
    input_context: dict[str, Any],
    target_node_id: str,
    target_iteration: int,
) -> dict[str, Any] | None:
    source_config = {"configurable": {"thread_id": source_execution_id}}
    source_state = await graph.aget_state(source_config)
    if source_state is None or not source_state.values:
        logger.error("_seed_replay_state: no source state found", source_execution_id=source_execution_id)
        return None

    replay_checkpoint_state = await _find_replay_checkpoint_state(
        graph,
        source_state,
        target_node_id,
        target_iteration,
    )
    if replay_checkpoint_state is not None:
        forked_config = await _fork_replay_checkpoint(checkpointer, execution_id, replay_checkpoint_state)
        if forked_config is not None:
            return forked_config

    source_values = source_state.values
    source_task_outputs = source_values.get("task_outputs", {})
    source_iterations = source_values.get("iterations", {})
    source_router_decisions = source_values.get("router_decisions", {})

    raw_edges = snapshot.get("control_edges", [])
    raw_nodes = snapshot.get("nodes", [])
    node_ids = {n["id"] for n in raw_nodes}
    adjacency = _build_adjacency(raw_edges, node_ids)
    replay_nodes = {target_node_id, *_find_downstream_nodes(target_node_id, adjacency)}
    completed_nodes_to_keep = node_ids - replay_nodes

    target_outputs_to_keep = {}
    for key, value in source_task_outputs.items():
        if isinstance(key, tuple) and len(key) == 2:
            nid, itr = key
        elif isinstance(key, str):
            nid, itr = key, 0
        else:
            continue
        parsed_iteration = int(itr)
        if nid in completed_nodes_to_keep:
            target_outputs_to_keep[(nid, parsed_iteration)] = value
            continue
        if nid == target_node_id and parsed_iteration < target_iteration:
            target_outputs_to_keep[(nid, parsed_iteration)] = value

    target_iterations = {}
    for nid, itr in source_iterations.items():
        if nid in completed_nodes_to_keep:
            target_iterations[nid] = itr
            continue
        if nid == target_node_id:
            target_iterations[nid] = min(itr, target_iteration)

    seeded_router_decisions = {
        nid: decision
        for nid, decision in source_router_decisions.items()
        if nid in completed_nodes_to_keep
    }

    seeded_task_outputs = {}
    for nid, itr_val in target_iterations.items():
        for itr in range(int(itr_val)):
            out = source_task_outputs.get((nid, itr))
            if out is not None:
                seeded_task_outputs[(nid, itr)] = out

    replay_config = {"configurable": {"thread_id": execution_id}}
    state_update = {
        "execution_id": execution_id,
        "flow_id": source_values.get("flow_id", ""),
        "inputs": input_context or source_values.get("inputs", {}),
        "task_outputs": {**target_outputs_to_keep, **seeded_task_outputs},
        "iterations": target_iterations,
        "router_decisions": seeded_router_decisions,
        "errors": [],
    }

    fork_config = await graph.aupdate_state(replay_config, state_update, as_node="__input__")
    fork_state = await graph.aget_state(fork_config)
    current_next = list(fork_state.next or ())

    nodes_to_complete = [
        n for n in current_next
        if n != "__start__" and n in completed_nodes_to_keep
    ]
    while nodes_to_complete:
        frontier_superstep = [
            (_build_replay_node_update(nid, target_outputs_to_keep, target_iterations, seeded_router_decisions), nid)
            for nid in sorted(nodes_to_complete)
        ]
        fork_config = await graph.abulk_update_state(fork_config, [frontier_superstep])

        fork_state = await graph.aget_state(fork_config)
        current_next = list(fork_state.next or ())

        new_pending = [
            n for n in current_next
            if n != "__start__" and n in completed_nodes_to_keep
        ]
        if set(new_pending) == set(nodes_to_complete):
            break
        nodes_to_complete = new_pending

    fork_state = await graph.aget_state(fork_config)
    final_next = list(fork_state.next or ())

    if target_node_id not in final_next:
        logger.error(
            "_seed_replay_state: target %s not in final next=%s",
            target_node_id,
            final_next,
        )
        return None

    return fork_config


async def _find_replay_checkpoint_state(
    graph: Any,
    source_state: Any,
    target_node_id: str,
    target_iteration: int,
) -> Any | None:
    current_state = source_state
    while current_state is not None:
        current_next = set(getattr(current_state, "next", ()) or ())
        current_values = getattr(current_state, "values", {}) or {}
        current_iterations = current_values.get("iterations", {}) if isinstance(current_values, dict) else {}
        if target_node_id in current_next and int(current_iterations.get(target_node_id, 0) or 0) == target_iteration:
            return current_state

        parent_config = getattr(current_state, "parent_config", None)
        if not parent_config:
            return None
        current_state = await graph.aget_state(parent_config)
    return None


async def _fork_replay_checkpoint(
    checkpointer: Any,
    execution_id: str,
    replay_checkpoint_state: Any,
) -> dict[str, Any] | None:
    checkpoint_config = getattr(replay_checkpoint_state, "config", None)
    if not checkpoint_config:
        return None

    checkpoint_tuple = await checkpointer.aget_tuple(checkpoint_config)
    if checkpoint_tuple is None:
        return None

    source_configurable = checkpoint_tuple.config.get("configurable", {})
    fork_config = {
        "configurable": {
            "thread_id": execution_id,
            "checkpoint_ns": source_configurable.get("checkpoint_ns", ""),
        },
    }

    next_config = await checkpointer.aput(
        fork_config,
        copy_checkpoint(checkpoint_tuple.checkpoint),
        {
            "source": "fork",
            "step": checkpoint_tuple.metadata.get("step", -1),
            "parents": {},
        },
        {},
    )

    pending_writes = checkpoint_tuple.pending_writes or []
    writes_by_task_id: dict[str, list[tuple[str, Any]]] = {}
    for task_id, channel, value in pending_writes:
        writes_by_task_id.setdefault(task_id, []).append((channel, value))
    for task_id, writes in writes_by_task_id.items():
        await checkpointer.aput_writes(next_config, writes, task_id)

    return next_config


def _build_replay_node_update(
    node_id: str,
    task_outputs: dict[tuple[str, int], Any],
    iterations: dict[str, int],
    router_decisions: dict[str, str],
) -> dict[str, Any]:
    node_outputs = {
        (nid, itr): output
        for (nid, itr), output in task_outputs.items()
        if nid == node_id
    }
    update: dict[str, Any] = {}
    if node_outputs:
        update["task_outputs"] = node_outputs
    if node_id in iterations:
        update["iterations"] = {node_id: iterations[node_id]}
    if node_id in router_decisions:
        update["router_decisions"] = {node_id: router_decisions[node_id]}
    return update


def _build_adjacency(
    raw_edges: list[dict[str, Any]],
    node_ids: set[str],
) -> dict[str, list[str]]:
    adj: dict[str, list[str]] = {}
    for edge in raw_edges:
        source = edge.get("source", "")
        target = edge.get("target", "")
        if source in node_ids and target in node_ids:
            adj.setdefault(source, []).append(target)
    return adj


def _find_downstream_nodes(
    target_node_id: str,
    adjacency: dict[str, list[str]],
) -> set[str]:
    visited: set[str] = set()
    stack = list(adjacency.get(target_node_id, []))
    while stack:
        node = stack.pop()
        if node in visited:
            continue
        visited.add(node)
        stack.extend(adjacency.get(node, []))
    return visited


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
