"""Dispatcher — accepts gRPC Run requests and routes to the worker pool.

Round-robin dispatch across available workers.  Each execution is
submitted as a coroutine to the pool which handles concurrency limits.
"""

from __future__ import annotations

import asyncio
from typing import Any, AsyncGenerator, Callable, Awaitable, Optional

from structlog import get_logger

from src.flow_engine.workers.pool import WorkerPool

logger = get_logger(__name__)


class Dispatcher:
    def __init__(self, pool: WorkerPool) -> None:
        self._pool = pool
        self._executions: dict[str, asyncio.Event] = {}
        self._submit_tasks: set[asyncio.Task] = set()

    async def dispatch(
        self,
        execution_id: str,
        snapshot: dict[str, Any],
        input_context: dict[str, Any],
        execute_fn: Callable[[], Awaitable[AsyncGenerator[Any, None]]],
    ) -> None:
        logger.info("[dispatcher] Dispatching execution", execution_id=execution_id)

        self._executions[execution_id] = asyncio.Event()

        async def _runner() -> None:
            try:
                async for event in execute_fn():
                    pass
            except asyncio.CancelledError:
                logger.info("[dispatcher] Execution cancelled", execution_id=execution_id)
                current = asyncio.current_task()
                if current is not None and current.cancelling() > 0:
                    raise
            except Exception as exc:
                logger.error("[dispatcher] Execution failed", execution_id=execution_id, error=str(exc))
            finally:
                self._executions.pop(execution_id, None)

        submit_task = asyncio.create_task(self._pool.submit(execution_id, _runner))
        self._submit_tasks.add(submit_task)
        submit_task.add_done_callback(self._submit_tasks.discard)

    async def cancel_execution(self, execution_id: str) -> bool:
        cancelled = await self._pool.cancel(execution_id)
        if cancelled:
            logger.info("[dispatcher] Cancelled execution", execution_id=execution_id)
        return cancelled

    @property
    def active_count(self) -> int:
        return self._pool.active_count
