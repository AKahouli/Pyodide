"""Tests for worker pool and dispatcher."""

import pytest

from src.flow_engine.workers.pool import WorkerPool
from src.flow_engine.workers.dispatcher import Dispatcher


class TestWorkerPool:
    def test_worker_pool_initialization(self):
        pool = WorkerPool(pool_size=4, max_inflight=2)
        assert pool.pool_size == 4
        assert pool.max_inflight == 2
        assert pool.active_count == 0

    @pytest.mark.asyncio
    async def test_worker_pool_cancel_unknown(self):
        pool = WorkerPool()
        result = await pool.cancel("nonexistent")
        assert result is False

    def test_dispatcher_init(self):
        pool = WorkerPool()
        dispatcher = Dispatcher(pool)
        assert dispatcher.active_count == 0

    @pytest.mark.asyncio
    async def test_dispatcher_dispatch(self):
        pool = WorkerPool()
        dispatcher = Dispatcher(pool)
        result = await dispatcher.dispatch("e1", {}, {})
        assert result == "e1"
