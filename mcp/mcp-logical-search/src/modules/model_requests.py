"""Admission control for model requests, separate from database capacity."""

import asyncio
import time
from typing import Awaitable, Callable, TypeVar
from weakref import WeakKeyDictionary

from src.config.settings import get_settings
from src.modules import operations


T = TypeVar("T")
_semaphores = WeakKeyDictionary()
_sync_tasks = set()


def _remaining(deadline: float | None, timeout: float) -> float:
    if deadline is None:
        return timeout
    return min(timeout, max(0.0, deadline - time.monotonic()))


def _semaphore() -> asyncio.Semaphore:
    loop = asyncio.get_running_loop()
    semaphore = _semaphores.get(loop)
    if semaphore is None:
        semaphore = asyncio.Semaphore(get_settings().MODEL_REQUEST_LIMIT)
        _semaphores[loop] = semaphore
    return semaphore


async def run_async_model_request(
    operation: Callable[[], Awaitable[T]],
    *,
    timeout: float,
    deadline: float | None = None,
) -> T:
    """Run one async model request within admission and wall-clock budgets."""
    operations.require_admission()
    budget = _remaining(deadline, timeout)
    if budget <= 0:
        raise asyncio.TimeoutError
    semaphore = _semaphore()
    started = time.monotonic()
    await operations.acquire_capacity(semaphore, queue_limit=get_settings().MODEL_QUEUE_LIMIT, timeout=budget)
    try:
        operations.require_admission()
        budget = _remaining(deadline, timeout - (time.monotonic() - started))
        if budget <= 0:
            raise asyncio.TimeoutError
        task = operations.track(asyncio.ensure_future(operation()))
        return await asyncio.wait_for(task, timeout=budget)
    finally:
        semaphore.release()


async def run_sync_model_request(
    operation: Callable[[], T],
    *,
    timeout: float,
    deadline: float | None = None,
) -> T:
    """Run a blocking model request without releasing capacity on cancellation."""
    operations.require_admission()
    budget = _remaining(deadline, timeout)
    if budget <= 0:
        raise asyncio.TimeoutError
    semaphore = _semaphore()
    started = time.monotonic()
    await operations.acquire_capacity(semaphore, queue_limit=get_settings().MODEL_QUEUE_LIMIT, timeout=budget)

    try:
        operations.require_admission()
        if _remaining(deadline, timeout - (time.monotonic() - started)) <= 0:
            raise asyncio.TimeoutError
    except BaseException:
        semaphore.release()
        raise
    task = operations.track(asyncio.create_task(asyncio.to_thread(operation)))
    _sync_tasks.add(task)

    def release_permit(completed_task: asyncio.Task) -> None:
        _sync_tasks.discard(completed_task)
        semaphore.release()
        if not completed_task.cancelled():
            completed_task.exception()

    task.add_done_callback(release_permit)
    budget = _remaining(deadline, timeout - (time.monotonic() - started))
    if budget <= 0:
        raise asyncio.TimeoutError
    return await asyncio.wait_for(asyncio.shield(task), timeout=budget)
