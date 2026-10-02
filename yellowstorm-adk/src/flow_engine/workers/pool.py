"""Concurrency limiter for flow engine execution."""

from __future__ import annotations

import asyncio


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
