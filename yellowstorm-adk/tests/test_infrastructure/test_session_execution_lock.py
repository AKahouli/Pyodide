"""Tests for persisted ADK session execution coordination."""

import asyncio

import pytest

from src.smart_rag.infrastructure.session.execution_lock import session_execution_lock


@pytest.mark.asyncio
async def test_same_session_turns_are_serialized():
    first_entered = asyncio.Event()
    release_first = asyncio.Event()
    second_entered = asyncio.Event()

    async def run_first():
        async with session_execution_lock("manager_app", "user-1", "session-1"):
            first_entered.set()
            await release_first.wait()

    async def run_second():
        await first_entered.wait()
        async with session_execution_lock("manager_app", "user-1", "session-1"):
            second_entered.set()

    first = asyncio.create_task(run_first())
    second = asyncio.create_task(run_second())
    await first_entered.wait()
    await asyncio.sleep(0)

    assert not second_entered.is_set()

    release_first.set()
    await asyncio.gather(first, second)
    assert second_entered.is_set()


@pytest.mark.asyncio
async def test_different_sessions_can_run_concurrently():
    first_entered = asyncio.Event()
    second_entered = asyncio.Event()

    async def run(session_id: str, entered: asyncio.Event):
        async with session_execution_lock("manager_app", "user-1", session_id):
            entered.set()
            await asyncio.wait_for(
                first_entered.wait() if session_id == "session-2" else second_entered.wait(),
                timeout=1,
            )

    await asyncio.gather(
        run("session-1", first_entered),
        run("session-2", second_entered),
    )


@pytest.mark.asyncio
async def test_cancelled_waiter_does_not_block_the_next_turn():
    owner_entered = asyncio.Event()
    release_owner = asyncio.Event()

    async def owner():
        async with session_execution_lock("manager_app", "user-1", "session-1"):
            owner_entered.set()
            await release_owner.wait()

    async def waiter():
        async with session_execution_lock("manager_app", "user-1", "session-1"):
            pass

    owner_task = asyncio.create_task(owner())
    await owner_entered.wait()
    cancelled_waiter = asyncio.create_task(waiter())
    await asyncio.sleep(0)
    cancelled_waiter.cancel()
    with pytest.raises(asyncio.CancelledError):
        await cancelled_waiter

    release_owner.set()
    await owner_task
    await asyncio.wait_for(waiter(), timeout=1)
