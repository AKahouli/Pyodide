"""Asyncio worker pool for flow engine execution.

Each worker handles up to max_inflight concurrent executions.
The pool size is configurable via env.
"""

from __future__ import annotations

import asyncio
from typing import Any, Callable, Awaitable, Optional

from structlog import get_logger

logger = get_logger(__name__)


class WorkerPool:
    def __init__(self, pool_size: int = 8, max_inflight: int = 4) -> None:
        self.pool_size = pool_size
        self.max_inflight = max_inflight
        self._semaphore = asyncio.Semaphore(max_inflight)
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
