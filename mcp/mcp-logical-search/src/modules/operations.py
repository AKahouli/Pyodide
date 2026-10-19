"""Track admitted work so shutdown never closes resources beneath workers."""

import asyncio

_accepting = True
_tasks = set()


class CapacityExceededError(RuntimeError):
    """Capacity and its bounded waiting queue are occupied; callers may retry."""


async def acquire_capacity(semaphore, *, queue_limit, timeout=None):
    waiting = getattr(semaphore, "_admission_waiters", 0)
    if semaphore.locked() and waiting >= queue_limit:
        raise CapacityExceededError("Service capacity is busy; retry with backoff.")
    semaphore._admission_waiters = waiting + 1
    try:
        if timeout is None:
            await semaphore.acquire()
        else:
            await asyncio.wait_for(semaphore.acquire(), timeout=timeout)
    finally:
        semaphore._admission_waiters -= 1


def start_admission():
    global _accepting
    if any(not task.done() for task in _tasks):
        raise RuntimeError("Previous service operations are still draining")
    _accepting = True


def stop_admission():
    global _accepting
    _accepting = False


def accepting_requests():
    return _accepting


def require_admission():
    if not _accepting:
        raise RuntimeError("Service is shutting down")


def track(task):
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    return task


async def drain(timeout=None):
    tasks = [task for task in _tasks if not task.done()]
    if not tasks:
        return True
    _, pending = await asyncio.wait(tasks, timeout=timeout)
    return not pending
