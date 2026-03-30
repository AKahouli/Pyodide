"""Active task registry for playbook workflow cancellation.

Tracks active ``asyncio.Task`` instances per thread_id so that
running playbook workflows can be cancelled via StopPlaybookWorkflow.

The step-update streaming queue was removed — step updates are now
emitted via a callback on the ``ExecutionState`` graph nodes.
"""

import asyncio
from typing import Dict, Optional

from structlog import get_logger

logger = get_logger(__name__)

_active_tasks: Dict[str, asyncio.Task] = {}
_step_update_queues: Dict[str, asyncio.Queue] = {}


def register_task(thread_id: str, task: asyncio.Task) -> None:
    _active_tasks[thread_id] = task


def get_task(thread_id: str) -> Optional[asyncio.Task]:
    return _active_tasks.get(thread_id)


def remove_task(thread_id: str) -> None:
    _active_tasks.pop(thread_id, None)


def register_queue(thread_id: str, queue: asyncio.Queue) -> None:
    _step_update_queues[thread_id] = queue


def get_queue(thread_id: str) -> Optional[asyncio.Queue]:
    return _step_update_queues.get(thread_id)


def remove_queue(thread_id: str) -> None:
    _step_update_queues.pop(thread_id, None)


async def cancel_task(thread_id: str) -> bool:
    """Cancel the active task for *thread_id* and clean up associated resources.

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

    remove_queue(thread_id)
    cleanup_thread_graph(thread_id)
    return True
