"""Tests for the execution limiter."""

import asyncio

import pytest

from src.flow_engine.workers.pool import ExecutionLimiter


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
