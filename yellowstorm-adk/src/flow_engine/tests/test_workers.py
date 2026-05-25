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

    def test_worker_pool_cancel_unknown(self):
        async def _run():
            pool = WorkerPool()
            result = await pool.cancel("nonexistent")
            assert result is False

    def test_dispatcher_init(self):
        pool = WorkerPool()
        dispatcher = Dispatcher(pool)
        assert dispatcher.active_count == 0

    def test_dispatcher_dispatch(self):
        pool = WorkerPool()
        dispatcher = Dispatcher(pool)
        done_event = None

        async def _fake_exec():
            nonlocal done_event
            done_event = True
            yield {"_mode": "custom", "_data": {"type": "NodeStarted", "node_id": "n1"}}
            yield {"_mode": "custom", "_data": {"type": "NodeCompleted", "node_id": "n1"}}

        async def _run():
            await dispatcher.dispatch("e1", {}, {}, _fake_exec)
            await asyncio.sleep(0.1)

        import asyncio
        asyncio.run(_run())
        assert done_event is True
