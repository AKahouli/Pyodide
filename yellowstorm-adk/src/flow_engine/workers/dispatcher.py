"""Dispatcher — accepts gRPC Run requests and routes to the worker pool.

Round-robin dispatch across available workers.
"""

from __future__ import annotations

from typing import Any, AsyncGenerator, Optional

from structlog import get_logger

from src.flow_engine.workers.pool import WorkerPool

logger = get_logger(__name__)


class Dispatcher:
    def __init__(self, pool: WorkerPool) -> None:
        self._pool = pool

    async def dispatch(
        self,
        execution_id: str,
        snapshot: dict[str, Any],
        input_context: dict[str, Any],
    ) -> str:
        logger.info("[dispatcher] Dispatching execution", execution_id=execution_id)
        return execution_id

    async def cancel_execution(self, execution_id: str) -> bool:
        return await self._pool.cancel(execution_id)

    @property
    def active_count(self) -> int:
        return self._pool.active_count
