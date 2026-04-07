"""Workflow service for playbook execution and resume via LangGraph."""

import asyncio
import contextlib
import json
import uuid
from typing import Dict, Any, List, Optional, Tuple

from structlog import get_logger

from src.langgraph_engine.state import (
    ExecutionState,
    StepUpdate,
    StepCallback,
    TaskConfig,
    AgentConfig,
    EdgeConfig,
)
from src.langgraph_engine.checkpointer import get_checkpointer
from src.langgraph_engine.graph_cache import (
    get_or_create_graph,
    store_thread_graph,
    get_thread_graph,
    cleanup_thread_graph,
    cleanup_stale_graphs,
)
from src.langgraph_engine.playbook_queue import register_queue, get_queue, remove_queue
from src.langgraph_engine.port_resolution import validate_port_routing

logger = get_logger(__name__)


def _extract_interrupt_from_snapshot(state_snapshot, thread_id: str) -> Optional[Dict[str, Any]]:
    for pregel_task in state_snapshot.tasks:
        if hasattr(pregel_task, "interrupts") and pregel_task.interrupts:
            iv = pregel_task.interrupts[0].value
            if isinstance(iv, dict):
                return {
                    "type": iv.get("type", ""),
                    "task_id": iv.get("task_id", ""),
                    "task_title": iv.get("task_title", ""),
                    "message": iv.get("message", ""),
                    "thread_id": thread_id,
                    "task_description": iv.get("task_description", ""),
                    "result": iv.get("result", ""),
                    "interrupt_id": iv.get("interrupt_id", ""),
                    "round": iv.get("round", 0),
                    "conversation_json": iv.get("conversation_json", ""),
                    "resumable_actions": iv.get("resumable_actions", []),
                }
    return None


def _normalize_interrupt_value(interrupt_value: Any, thread_id: str) -> Optional[Dict[str, Any]]:
    if not isinstance(interrupt_value, dict):
        return None

    return {
        "type": interrupt_value.get("type", ""),
        "task_id": interrupt_value.get("task_id", ""),
        "task_title": interrupt_value.get("task_title", ""),
        "message": interrupt_value.get("message", ""),
        "thread_id": thread_id,
        "task_description": interrupt_value.get("task_description", ""),
        "result": interrupt_value.get("result", ""),
        "interrupt_id": interrupt_value.get("interrupt_id", ""),
        "round": interrupt_value.get("round", 0),
        "conversation_json": interrupt_value.get("conversation_json", ""),
        "resumable_actions": interrupt_value.get("resumable_actions", []),
    }


def _extract_interrupt_from_stream_chunk(chunk: Any, thread_id: str) -> Optional[Dict[str, Any]]:
    if not isinstance(chunk, dict):
        return None

    chunk_type = chunk.get("type")
    if chunk_type != "updates":
        return None

    data = chunk.get("data") or {}
    interrupt_candidates = data.get("__interrupt__")

    if not interrupt_candidates and chunk.get("interrupts"):
        interrupt_candidates = chunk.get("interrupts")

    if not interrupt_candidates:
        return None

    first_interrupt = interrupt_candidates[0]
    interrupt_value = getattr(first_interrupt, "value", first_interrupt)
    return _normalize_interrupt_value(interrupt_value, thread_id)


def _build_resume_state_update(interrupt_data: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not interrupt_data or interrupt_data.get("type") != "clarification":
        return None

    task_id = str(interrupt_data.get("task_id") or "").strip()
    if not task_id:
        return None

    conversation_json = interrupt_data.get("conversation_json") or "[]"
    try:
        transcript = json.loads(conversation_json)
    except (TypeError, ValueError):
        transcript = []

    if not isinstance(transcript, list):
        transcript = []

    task_description = str(interrupt_data.get("task_description") or "").strip()

    update: Dict[str, Any] = {
        "clarification_transcripts_by_task": {task_id: transcript},
    }
    if task_description:
        update["task_description_overrides_by_task"] = {task_id: task_description}
    return update


async def _consume_graph_stream(
    graph,
    graph_input: Any,
    config: Dict[str, Any],
    thread_id: str,
) -> Tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
    """Run the graph via LangGraph streaming and surface live interrupts."""
    stream = graph.astream(
        graph_input,
        config=config,
        stream_mode=["messages", "updates"],
        subgraphs=True,
        version="v2",
    )

    interrupt_data: Optional[Dict[str, Any]] = None

    try:
        async for chunk in stream:
            streamed_interrupt = _extract_interrupt_from_stream_chunk(chunk, thread_id)
            if streamed_interrupt:
                interrupt_data = streamed_interrupt
                logger.info(
                    "[workflow_stream] Interrupt surfaced from stream",
                    thread_id=thread_id,
                    interrupt_type=interrupt_data.get("type"),
                    task_id=interrupt_data.get("task_id"),
                    round=interrupt_data.get("round"),
                )
                break
    finally:
        aclose = getattr(stream, "aclose", None)
        if aclose is not None:
            with contextlib.suppress(Exception):
                await aclose()

    state_snapshot = await graph.aget_state(config)
    final_state = state_snapshot.values if hasattr(state_snapshot, "values") else None

    if interrupt_data is None and state_snapshot.next:
        interrupt_data = _extract_interrupt_from_snapshot(state_snapshot, thread_id)

    return interrupt_data, final_state if isinstance(final_state, dict) else None


def _make_step_callback_for_thread(thread_id: str) -> StepCallback:
    """Resolve the active stream queue lazily for the given thread."""
    async def _callback(update: StepUpdate):
        queue = get_queue(thread_id)
        if queue is not None:
            await queue.put({"step_update": update})

    return _callback


async def _send_sentinel(queue: Optional[asyncio.Queue]) -> None:
    """Put the stream-end sentinel on *queue* if it is not None."""
    if queue is not None:
        await queue.put(None)


async def run_playbook(
    playbook_id: str,
    tasks: List[TaskConfig],
    agents: Dict[str, AgentConfig],
    edges: List[EdgeConfig],
    query: str = "",
    workspace_context: Optional[list] = None,
    queue: Optional[asyncio.Queue] = None,
    thread_id: Optional[str] = None,
    execution_mode: str = "live",
    validated_replays_by_task: Optional[Dict[str, Any]] = None,
    evaluation_user_id: str = "unknown",
    step_execution_modes: Optional[Dict[str, str]] = None,
    prompt_overrides: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    """Execute a playbook workflow with dynamic graph."""
    cleanup_stale_graphs()

    validate_port_routing(tasks, edges)

    if thread_id is None:
        thread_id = f"{playbook_id}_{uuid.uuid4().hex[:8]}"

    checkpointer = await get_checkpointer()
    on_step_update = _make_step_callback_for_thread(thread_id)

    graph_info = get_or_create_graph(
        playbook_id=playbook_id,
        tasks=tasks,
        edges=edges,
        checkpointer=checkpointer,
        on_step_update=on_step_update,
        force_rebuild=True,
    )

    compiled = graph_info["compiled"]

    initial_state: ExecutionState = {
        "playbook_id": playbook_id,
        "thread_id": thread_id,
        "tasks": tasks,
        "edges": edges,
        "agents": agents,
        "current_task_ids": [],
        "completed_task_ids": [],
        "results": {},
        "status": "in_progress",
        "error": None,
        "interrupt_payload": None,
        "node_timings": {},
        "query": query,
        "workspace_context": workspace_context,
        "evaluation_user_id": evaluation_user_id,
        "execution_mode": execution_mode,
        "validated_replays_by_task": validated_replays_by_task or {},
        "step_execution_modes": step_execution_modes or {},
        "task_outputs": {},
        "artifacts_by_port": {},
        "prompt_overrides": prompt_overrides or {},
        "clarification_transcripts_by_task": {},
        "task_description_overrides_by_task": {},
    }

    config = {"configurable": {"thread_id": thread_id}}

    store_thread_graph(thread_id, compiled)
    if queue is not None:
        register_queue(thread_id, queue)

    logger.info(
        "[run_playbook] Starting execution",
        playbook_id=playbook_id,
        thread_id=thread_id,
        execution_mode=execution_mode,
        replay_task_ids=sorted((validated_replays_by_task or {}).keys()),
        replay_count=len(validated_replays_by_task or {}),
    )

    try:
        interrupt_data, result = await _consume_graph_stream(
            graph=compiled,
            graph_input=initial_state,
            config=config,
            thread_id=thread_id,
        )

        if interrupt_data:
            logger.info("[run_playbook] Graph suspended (HITL)", thread_id=thread_id)

            response = {
                "status": "suspended",
                "task_results": [],
                "interrupt": interrupt_data,
                "thread_id": thread_id,
                "error": None,
            }

            await _send_sentinel(queue)
            return response

        result = result or {}
        final_status = result.get("status", "completed")
        logger.info("[run_playbook] Execution completed", status=final_status, thread_id=thread_id)

        task_results = _build_task_results(result, tasks)

        if final_status in ("completed", "failed"):
            cleanup_thread_graph(thread_id)

        response = {
            "status": final_status,
            "task_results": task_results,
            "interrupt": None,
            "thread_id": thread_id,
            "error": result.get("error"),
        }

        await _send_sentinel(queue)
        return response
    except Exception as e:
        error_str = str(e)
        logger.error("[run_playbook] Exception during execution", error=error_str, exc_type=type(e).__name__)

        cleanup_thread_graph(thread_id)

        response = {
            "status": "failed",
            "task_results": [],
            "interrupt": None,
            "thread_id": thread_id,
            "error": error_str,
        }

        await _send_sentinel(queue)
        return response
    finally:
        remove_queue(thread_id)


async def resume_playbook(
    playbook_id: str,
    thread_id: str,
    human_response: dict,
    task_id: str = "",
    queue: Optional[asyncio.Queue] = None,
) -> Dict[str, Any]:
    """Resume an interrupted playbook with the human response."""
    from langgraph.types import Command

    graph = get_thread_graph(thread_id)
    if graph is None:
        logger.warning("[resume_playbook] Graph not found for thread, attempting recovery", thread_id=thread_id)
        response = {
            "status": "failed",
            "task_results": [],
            "interrupt": None,
            "thread_id": thread_id,
            "error": f"No active graph found for thread {thread_id}. The execution may have expired.",
        }
        await _send_sentinel(queue)
        return response

    config = {"configurable": {"thread_id": thread_id}}
    if queue is not None:
        register_queue(thread_id, queue)

    logger.info("[resume_playbook] Resuming", thread_id=thread_id, playbook_id=playbook_id)

    try:
        state_snapshot = await graph.aget_state(config)
        resume_interrupt_data = _extract_interrupt_from_snapshot(state_snapshot, thread_id)
        resume_state_update = _build_resume_state_update(resume_interrupt_data)
        interrupt_data, result = await _consume_graph_stream(
            graph=graph,
            graph_input=Command(update=resume_state_update, resume=human_response),
            config=config,
            thread_id=thread_id,
        )

        if interrupt_data:
            logger.info("[resume_playbook] Graph suspended again (HITL)", thread_id=thread_id)

            response = {
                "status": "suspended",
                "task_results": [],
                "interrupt": interrupt_data,
                "thread_id": thread_id,
                "error": None,
            }

            await _send_sentinel(queue)
            return response

        result = result or {}
        final_status = result.get("status", "completed")
        logger.info("[resume_playbook] Resumed execution completed", status=final_status)

        tasks = result.get("tasks", [])
        task_results = _build_task_results(result, tasks)

        if final_status in ("completed", "failed"):
            cleanup_thread_graph(thread_id)

        response = {
            "status": final_status,
            "task_results": task_results,
            "interrupt": None,
            "thread_id": thread_id,
            "error": result.get("error"),
        }

        await _send_sentinel(queue)
        return response
    except Exception as e:
        error_str = str(e)
        logger.error("[resume_playbook] Exception during resume", error=error_str)

        cleanup_thread_graph(thread_id)

        response = {
            "status": "failed",
            "task_results": [],
            "interrupt": None,
            "thread_id": thread_id,
            "error": error_str,
        }

        await _send_sentinel(queue)
        return response
    finally:
        remove_queue(thread_id)


async def run_single_step_graph(
    task: Dict[str, Any],
    agent: Dict[str, Any],
    context_from_dependencies: str = "",
    workspace_context: Optional[list] = None,
    edges: Optional[List[Dict[str, Any]]] = None,
    upstream_results: Optional[List[Dict[str, Any]]] = None,
    execution_mode: str = "live",
    validated_replay: Optional[Dict[str, Any]] = None,
    evaluation_user_id: str = "unknown",
    on_progress=None,
    prompt_overrides: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    """Execute a single task via a dedicated LangGraph for HITL support.

    Reuses ``DynamicGraphBuilder.build_single_step_graph`` so that
    interrupt/resume logic is identical to the full-workflow path.
    """
    from src.langgraph_engine.graph_builder import DynamicGraphBuilder
    from src.langgraph_engine.graph_cache import store_thread_graph, cleanup_thread_graph
    from src.langgraph_engine.step_executor import _extract_interrupt_from_snapshot as extract_step_interrupt_from_snapshot

    def _normalize_port_id(value: Any) -> str:
        raw = str(value or "default").strip() or "default"
        if raw.startswith(("in-", "out-")):
            return raw.split("-", 1)[1] or "default"
        return raw

    checkpointer = await get_checkpointer()
    builder = DynamicGraphBuilder(checkpointer=checkpointer)

    task_id = task.get("id", "single_step")
    thread_id = f"step_{task_id}_{uuid.uuid4().hex[:8]}"

    upstream_results_map = {
        str(item.get("task_id") or "").strip(): item
        for item in (upstream_results or [])
        if isinstance(item, dict) and str(item.get("task_id") or "").strip()
    }
    artifacts_by_port: Dict[str, List[Dict[str, Any]]] = {}
    for upstream_task_id, upstream_result in upstream_results_map.items():
        for artifact in upstream_result.get("artifacts") or []:
            if not isinstance(artifact, dict):
                continue
            port_id = _normalize_port_id(artifact.get("port_id") or artifact.get("portId") or "default")
            artifacts_by_port.setdefault(f"{upstream_task_id}:{port_id}", []).append(artifact)

    initial_state: ExecutionState = {
        "playbook_id": task_id,
        "thread_id": thread_id,
        "tasks": [task],
        "edges": edges or [],
        "agents": {agent.get("id", "agent_single"): agent},
        "current_task_ids": [],
        "completed_task_ids": [],
        "results": upstream_results_map,
        "status": "in_progress",
        "error": None,
        "interrupt_payload": None,
        "node_timings": {},
        "query": "",
        "workspace_context": workspace_context,
        "evaluation_user_id": evaluation_user_id,
        "execution_mode": execution_mode,
        "validated_replays_by_task": {task_id: validated_replay} if validated_replay else {},
        "step_execution_modes": {},
        "task_outputs": {},
        "artifacts_by_port": artifacts_by_port,
        "prompt_overrides": prompt_overrides or {},
        "clarification_transcripts_by_task": {},
        "task_description_overrides_by_task": {},
    }

    if context_from_dependencies:
        initial_state["query"] = context_from_dependencies

    graph_info = builder.build_single_step_graph(task, agent)
    compiled = graph_info["compiled"]

    store_thread_graph(thread_id, compiled)

    config = {"configurable": {"thread_id": thread_id}}

    try:
        final_state = await compiled.ainvoke(initial_state, config)

        state_snapshot = await compiled.aget_state(config)
        if state_snapshot.next:
            interrupt_data = extract_step_interrupt_from_snapshot(state_snapshot, task_id, thread_id)
            logger.info(f"[{task_id}] Graph suspended (HITL)", interrupt_type=interrupt_data.get("type") if interrupt_data else None)
            return {
                "status": "suspended",
                "result": {
                    "task_id": task_id,
                    "status": "suspended",
                    "output": "",
                    "error": "",
                    "duration_ms": 0,
                },
                "interrupt": interrupt_data,
                "thread_id": thread_id,
            }

        final_status = final_state.get("status", "completed")
        results = final_state.get("results", {})
        task_result = results.get(task_id, {})

        if final_status in ("completed", "failed", "skipped"):
            cleanup_thread_graph(thread_id)

        return {
            "status": final_status,
            "result": {
                "task_id": task_id,
                "status": final_status,
                "output": task_result.get("output", ""),
                "error": task_result.get("error", final_state.get("error", "")),
                "duration_ms": 0,
                "components": task_result.get("components", []),
                "usage": task_result.get("usage", {}),
                "tool_trace": task_result.get("tool_trace", []),
                "llm_prompt_trace": task_result.get("llm_prompt_trace", []),
                "semantic_match": task_result.get("semantic_match"),
            },
            "interrupt": None,
            "thread_id": thread_id,
        }

    except Exception as e:
        error_str = str(e)
        logger.error(f"[{task_id}] Single step execution failed", error=error_str)
        cleanup_thread_graph(thread_id)
        return {
            "status": "failed",
            "result": {
                "task_id": task_id,
                "status": "failed",
                "output": "",
                "error": error_str,
                "duration_ms": 0,
            },
            "interrupt": None,
            "thread_id": thread_id,
        }


async def resume_single_step(
    thread_id: str,
    human_response: dict,
    task_id: str = "",
) -> Dict[str, Any]:
    """Resume an interrupted single-step execution."""
    from langgraph.types import Command
    from src.langgraph_engine.graph_cache import get_thread_graph, cleanup_thread_graph
    from src.langgraph_engine.step_executor import _extract_interrupt_from_snapshot as extract_step_interrupt_from_snapshot

    graph = get_thread_graph(thread_id)
    if graph is None:
        logger.warning("[resume_single_step] Graph not found for thread", thread_id=thread_id)
        return {
            "status": "failed",
            "result": {
                "task_id": task_id,
                "status": "failed",
                "output": "",
                "error": f"No active graph found for thread {thread_id}. The execution may have expired.",
                "duration_ms": 0,
            },
            "interrupt": None,
            "thread_id": thread_id,
        }

    config = {"configurable": {"thread_id": thread_id}}

    logger.info("[resume_single_step] Resuming", thread_id=thread_id, task_id=task_id)

    try:
        state_snapshot = await graph.aget_state(config)
        resume_interrupt_data = extract_step_interrupt_from_snapshot(state_snapshot, task_id, thread_id)
        resume_state_update = _build_resume_state_update(resume_interrupt_data)
        final_state = await graph.ainvoke(Command(update=resume_state_update, resume=human_response), config)

        state_snapshot = await graph.aget_state(config)
        if state_snapshot.next:
            interrupt_data = extract_step_interrupt_from_snapshot(state_snapshot, task_id, thread_id)
            logger.info("[resume_single_step] Graph suspended again (HITL)", interrupt_type=interrupt_data.get("type") if interrupt_data else None)
            return {
                "status": "suspended",
                "result": {
                    "task_id": task_id,
                    "status": "suspended",
                    "output": "",
                    "error": "",
                    "duration_ms": 0,
                },
                "interrupt": interrupt_data,
                "thread_id": thread_id,
            }

        final_status = final_state.get("status", "completed")
        logger.info("[resume_single_step] Resumed execution completed", status=final_status)

        if final_status in ("completed", "failed", "skipped"):
            cleanup_thread_graph(thread_id)

        results = final_state.get("results", {})
        task_result = results.get(task_id, {})

        return {
            "status": final_status,
            "result": {
                "task_id": task_id,
                "status": final_status,
                "output": final_state.get("output", task_result.get("output", "")),
                "error": final_state.get("error", task_result.get("error", "")),
                "duration_ms": 0,
                "components": final_state.get("components", task_result.get("components", [])),
                "usage": final_state.get("usage", task_result.get("usage", {})),
                "tool_trace": final_state.get("tool_trace", task_result.get("tool_trace", [])),
                "semantic_match": final_state.get("semantic_match", task_result.get("semantic_match")),
            },
            "interrupt": None,
            "thread_id": thread_id,
        }

    except Exception as e:
        error_str = str(e)
        logger.error("[resume_single_step] Failed", error=error_str)
        cleanup_thread_graph(thread_id)
        return {
            "status": "failed",
            "result": {
                "task_id": task_id,
                "status": "failed",
                "output": "",
                "error": error_str,
                "duration_ms": 0,
            },
            "interrupt": None,
            "thread_id": thread_id,
        }


def _build_task_results(state: Dict[str, Any], tasks: List[TaskConfig]) -> List[Dict[str, Any]]:
    results = state.get("results", {})
    timings = state.get("node_timings", {})
    task_results = []

    for task in tasks:
        tid = task.get("id")
        if not tid:
            continue

        if tid in results:
            r = results[tid]
            if isinstance(r, dict) and r.get("status") == "skipped":
                task_results.append({
                    "task_id": tid,
                    "status": "skipped",
                    "output": "",
                    "error": "",
                    "duration_ms": timings.get(tid, {}).get("duration_ms", 0),
                    "components": r.get("components", []),
                    "usage": r.get("usage", {}),
                    "tool_trace": r.get("tool_trace", []),
                    "llm_prompt_trace": r.get("llm_prompt_trace", []),
                    "semantic_match": r.get("semantic_match"),
                })
            elif isinstance(r, dict) and "error" in r and r.get("error"):
                task_results.append({
                    "task_id": tid,
                    "status": "failed",
                    "output": "",
                    "error": r["error"],
                    "duration_ms": timings.get(tid, {}).get("duration_ms", 0),
                    "tool_trace": r.get("tool_trace", []) if isinstance(r, dict) else [],
                    "llm_prompt_trace": r.get("llm_prompt_trace", []) if isinstance(r, dict) else [],
                    "semantic_match": r.get("semantic_match") if isinstance(r, dict) else None,
                })
            else:
                output = r.get("output", str(r)) if isinstance(r, dict) else str(r)
                components = r.get("components", []) if isinstance(r, dict) else []
                usage = r.get("usage", {}) if isinstance(r, dict) else {}
                task_results.append({
                    "task_id": tid,
                    "status": "completed",
                    "output": output,
                    "error": "",
                    "duration_ms": timings.get(tid, {}).get("duration_ms", 0),
                    "components": components,
                    "usage": usage,
                    "tool_trace": r.get("tool_trace", []) if isinstance(r, dict) else [],
                    "llm_prompt_trace": r.get("llm_prompt_trace", []) if isinstance(r, dict) else [],
                    "semantic_match": r.get("semantic_match") if isinstance(r, dict) else None,
                })

    return task_results
