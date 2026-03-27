"""Queue and task registry for playbook step-status streaming.

Maps thread_id -> asyncio.Queue so that task nodes inside the LangGraph
execution graph can push real-time step updates (in_progress, suspended,
completed, failed) without the queue living in the serialisable
ExecutionState.

Also tracks active asyncio.Task instances per thread_id so that
running playbook workflows can be cancelled via StopPlaybookWorkflow.
"""

import asyncio
from typing import Dict, Optional

from structlog import get_logger

logger = get_logger(__name__)

_queues: Dict[str, asyncio.Queue] = {}
_active_tasks: Dict[str, asyncio.Task] = {}


def register_queue(thread_id: str, queue: asyncio.Queue) -> None:
    """Register a queue for the given thread."""
    _queues[thread_id] = queue


def get_queue(thread_id: str) -> Optional[asyncio.Queue]:
    """Return the queue for *thread_id*, or ``None`` if not registered."""
    return _queues.get(thread_id)


def remove_queue(thread_id: str) -> None:
    """Remove (and discard) the queue for *thread_id*."""
    _queues.pop(thread_id, None)


# ── Active task registry ──────────────────────────────────────


def register_task(thread_id: str, task: asyncio.Task) -> None:
    """Register an asyncio.Task for the given thread."""
    _active_tasks[thread_id] = task


def get_task(thread_id: str) -> Optional[asyncio.Task]:
    """Return the active task for *thread_id*, or ``None``."""
    return _active_tasks.get(thread_id)


def remove_task(thread_id: str) -> None:
    """Remove the task entry for *thread_id*."""
    _active_tasks.pop(thread_id, None)


async def cancel_task(thread_id: str) -> bool:
    """Cancel the active task for *thread_id* and clean up associated resources.

    Cancels the asyncio.Task, removes it from the registry, removes the
    queue, and cleans up the graph cache entry.

    Returns True if a task was found and cancelled, False otherwise.
    """
    from src.langgraph_engine.graph_cache import cleanup_thread_graph

    task = _active_tasks.pop(thread_id, None)
    if task is None:
        logger.warning("[PlaybookQueue] No active task for thread_id", thread_id=thread_id)
        return False

    if not task.done():
        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, Exception):
            pass

    logger.info("[PlaybookQueue] Task cancelled", thread_id=thread_id)

    # Clean up graph cache
    cleanup_thread_graph(thread_id)

    # Send sentinel + cancelled message to queue so the stream closes
    queue = _queues.get(thread_id)
    if queue is not None:
        await queue.put({
            "step_update": {
                "task_id": "",
                "task_title": "",
                "status": "cancelled",
            }
        })
        await queue.put(None)

    remove_queue(thread_id)
    return True
