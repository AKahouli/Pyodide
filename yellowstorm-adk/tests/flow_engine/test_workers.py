"""Tests for worker pool and dispatcher."""

import asyncio

import pytest

from src.flow_engine.workers.pool import ExecutionLimiter, WorkerPool
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

        asyncio.run(_run())
        assert done_event is True


@pytest.mark.asyncio
async def test_execution_limiter_grows_without_cancelling_active_runs():
    limiter = ExecutionLimiter(1)
    await limiter.acquire()
    waiting = asyncio.create_task(limiter.acquire())
    await asyncio.sleep(0)
    assert not waiting.done()

    await limiter.resize(2)
    await asyncio.wait_for(waiting, timeout=1)
    assert limiter.active_count == 2
    await limiter.release()
    await limiter.release()


@pytest.mark.asyncio
async def test_execution_limiter_shrink_waits_for_active_runs_to_finish():
    limiter = ExecutionLimiter(2)
    await limiter.acquire()
    await limiter.acquire()
    await limiter.resize(1)
    waiting = asyncio.create_task(limiter.acquire())

    await limiter.release()
    await asyncio.sleep(0)
    assert not waiting.done()
    await limiter.release()
    await asyncio.wait_for(waiting, timeout=1)
    await limiter.release()
