"""Workflow service for playbook execution and resume via LangGraph."""

import asyncio
import uuid
from typing import Dict, Any, List, Optional

from structlog import get_logger

from src.langgraph_engine.state import (
    ExecutionState,
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
from src.langgraph_engine.playbook_queue import register_queue, remove_queue

logger = get_logger(__name__)


def _extract_interrupt_from_snapshot(state_snapshot, thread_id: str) -> Optional[Dict[str, Any]]:
    """Extract interrupt payload from a LangGraph state snapshot.

    After ainvoke returns, if state_snapshot.next is non-empty the graph
    is suspended. The interrupt values are stored in state_snapshot.tasks.
    """
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
                }
    return None


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
) -> Dict[str, Any]:
    """Execute a playbook workflow with dynamic graph.

    Args:
        playbook_id: Unique playbook identifier
        tasks: List of task configurations
        agents: Dict of agent_id -> AgentConfig
        edges: Dependency edges
        query: User query
        workspace_context: Optional workspace context
        queue: Optional asyncio.Queue for streaming step updates
        thread_id: Optional pre-generated thread ID (generated if not provided)

    Returns:
        Dict with: status, task_results, interrupt, thread_id, error
    """
    cleanup_stale_graphs()

    checkpointer = await get_checkpointer()
    graph = get_or_create_graph(
        playbook_id=playbook_id,
        tasks=tasks,
        edges=edges,
        checkpointer=checkpointer,
    )

    if thread_id is None:
        thread_id = f"{playbook_id}_{uuid.uuid4().hex[:8]}"

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
    }

    config = {"configurable": {"thread_id": thread_id}}

    store_thread_graph(thread_id, graph)

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
        result = await graph.ainvoke(initial_state, config)

        # Check if the graph is suspended (HITL interrupt)
        state_snapshot = await graph.aget_state(config)
        if state_snapshot.next:
            interrupt_data = _extract_interrupt_from_snapshot(state_snapshot, thread_id)
            logger.info("[run_playbook] Graph suspended (HITL)", thread_id=thread_id)

            response = {
                "status": "suspended",
                "task_results": [],
                "interrupt": interrupt_data,
                "thread_id": thread_id,
                "error": None,
            }

            if queue is not None:
                await queue.put(None)

            return response

        final_status = result.get("status", "completed")
        logger.info("[run_playbook] Execution completed", status=final_status, thread_id=thread_id)

        # Build task results
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

        if queue is not None:
            await queue.put(None)

        return response

    except Exception as e:
        error_str = str(e)
        logger.error("[run_playbook] Exception during execution", error=error_str, exc_type=type(e).__name__)

        # Real failure
        cleanup_thread_graph(thread_id)

        response = {
            "status": "failed",
            "task_results": [],
            "interrupt": None,
            "thread_id": thread_id,
            "error": error_str,
        }

        if queue is not None:
            await queue.put(None)

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
    """Resume an interrupted playbook with the human response.

    Args:
        playbook_id: Playbook identifier
        thread_id: Thread ID from the interrupted execution
        human_response: Dict with approved, reason, feedback
        task_id: Optional task ID being resumed
        queue: Optional asyncio.Queue for streaming step updates

    Returns:
        Dict with: status, task_results, interrupt, thread_id, error
    """
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
        if queue is not None:
            await queue.put(None)
        return response

    config = {"configurable": {"thread_id": thread_id}}

    response_data = human_response

    if queue is not None:
        register_queue(thread_id, queue)

    logger.info("[resume_playbook] Resuming", thread_id=thread_id, playbook_id=playbook_id)

    try:
        result = await graph.ainvoke(Command(resume=response_data), config)

        # Check if the graph is suspended again (HITL)
        state_snapshot = await graph.aget_state(config)
        if state_snapshot.next:
            interrupt_data = _extract_interrupt_from_snapshot(state_snapshot, thread_id)
            logger.info("[resume_playbook] Graph suspended again (HITL)", thread_id=thread_id)

            response = {
                "status": "suspended",
                "task_results": [],
                "interrupt": interrupt_data,
                "thread_id": thread_id,
                "error": None,
            }

            if queue is not None:
                await queue.put(None)

            return response

        final_status = result.get("status", "completed")
        logger.info("[resume_playbook] Resumed execution completed", status=final_status)

        # Get tasks from state for building results
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

        if queue is not None:
            await queue.put(None)

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

        if queue is not None:
            await queue.put(None)

        return response

    finally:
        remove_queue(thread_id)


def _build_task_results(state: Dict[str, Any], tasks: List[TaskConfig]) -> List[Dict[str, Any]]:
    """Build task result list from execution state."""
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
