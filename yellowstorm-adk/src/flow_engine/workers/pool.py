"""Asyncio worker pool for flow engine execution.

Each worker handles up to max_inflight concurrent executions.
The pool size is configurable via env.
"""

from __future__ import annotations

import asyncio
from typing import Any, Callable, Awaitable

from structlog import get_logger

logger = get_logger(__name__)


class ExecutionLimiter:
    def __init__(self, capacity: int) -> None:
        self._capacity = max(1, capacity)
        self._active = 0
        self._condition = asyncio.Condition()

    async def resize(self, capacity: int) -> None:
        async with self._condition:
            self._capacity = max(1, capacity)
            self._condition.notify_all()

    async def acquire(self) -> None:
        async with self._condition:
            await self._condition.wait_for(lambda: self._active < self._capacity)
            self._active += 1

    async def release(self) -> None:
        async with self._condition:
            self._active = max(0, self._active - 1)
            self._condition.notify_all()

    @property
    def active_count(self) -> int:
        return self._active


class WorkerPool:
    def __init__(self, pool_size: int = 8, max_inflight: int = 4) -> None:
        self.pool_size = pool_size
        self.max_inflight = max_inflight
        self._semaphore = asyncio.Semaphore(pool_size * max_inflight)
        self._tasks: dict[str, asyncio.Task[Any]] = {}
        logger.info("[pool] Initialized worker pool", size=pool_size, max_inflight=max_inflight)

    async def submit(
        self,
        execution_id: str,
        coro_factory: Callable[[], Awaitable[Any]],
    ) -> None:
        async with self._semaphore:
            task = asyncio.create_task(coro_factory())
            self._tasks[execution_id] = task
            try:
                await task
            finally:
                self._tasks.pop(execution_id, None)

    async def cancel(self, execution_id: str) -> bool:
        task = self._tasks.get(execution_id)
        if task is None:
            return False
        task.cancel()
        return True

    @property
    def active_count(self) -> int:
        return len(self._tasks)
