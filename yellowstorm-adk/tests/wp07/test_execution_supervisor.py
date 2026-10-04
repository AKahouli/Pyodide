import asyncio
from dataclasses import replace
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import text

from tests.wp07.test_background_sessions import guarded_native
from src.root_runtime.background_sessions import BackgroundOwnershipError, FencedBackgroundSessionService
from src.root_runtime.execution_supervisor import BackgroundInvocationSupervisor


@pytest.mark.asyncio
async def test_observer_disconnect_and_duplicate_attach_keep_one_owned_runner(guarded_native):
    service, _session, _grant, _engine = guarded_native
    supervisor = BackgroundInvocationSupervisor(owner_check_seconds=.05)
    started, release = asyncio.Event(), asyncio.Event()
    calls = []
    sink, settle = AsyncMock(), AsyncMock()

    async def run(queue, abort):
        calls.append('runner')
        started.set()
        await release.wait()
        await queue.put({'terminal': 'completed'})
        return 'full output'

    handle = await supervisor.start_or_attach(service, run, sink, settle)
    await started.wait()

    async def observe():
        return await asyncio.shield(handle.task)

    observer = asyncio.create_task(observe())
    await asyncio.sleep(0)
    observer.cancel()
    with pytest.raises(asyncio.CancelledError):
        await observer
    assert not handle.task.done()
    assert await supervisor.start_or_attach(service, run, sink, settle) is handle
    release.set()
    await handle.task
    assert calls == ['runner'] and supervisor.active == {}
    sink.assert_awaited_once_with({'terminal': 'completed'})
    settle.assert_awaited_once_with('full output', 'finished')


@pytest.mark.asyncio
async def test_settlement_waits_for_runner_and_durable_sink_even_after_stream_sentinel(guarded_native):
    service, _session, _grant, _engine = guarded_native
    supervisor = BackgroundInvocationSupervisor()
    sink_started, sink_release, runner_release = asyncio.Event(), asyncio.Event(), asyncio.Event()
    settle = AsyncMock()

    async def sink(event):
        sink_started.set()
        await sink_release.wait()

    async def run(queue, abort):
        await queue.put({'lifecycle': 'waiting'})
        await queue.put(None)
        await runner_release.wait()
        return None

    handle = await supervisor.start_or_attach(service, run, sink, settle)
    await sink_started.wait()
    assert settle.await_count == 0
    runner_release.set()
    await asyncio.sleep(.02)
    assert settle.await_count == 0
    sink_release.set()
    await handle.task
    settle.assert_awaited_once_with(None, 'finished')


@pytest.mark.asyncio
async def test_owner_loss_stops_and_joins_runner_without_stale_settlement(guarded_native):
    service, _session, grant, engine = guarded_native
    supervisor = BackgroundInvocationSupervisor(owner_check_seconds=.02)
    started, joined = asyncio.Event(), asyncio.Event()
    settle = AsyncMock()

    async def run(queue, abort):
        started.set()
        try:
            await asyncio.Event().wait()
        finally:
            joined.set()

    handle = await supervisor.start_or_attach(service, run, AsyncMock(), settle)
    await started.wait()
    async with engine.begin() as connection:
        await connection.execute(text("UPDATE conversation.root_background_jobs SET owner='successor',fence=fence+1 WHERE execution_id=:id"),
            {'id': grant.execution_id})
    await asyncio.wait_for(handle.task, 5)
    assert joined.is_set() and handle.status == 'outcome_unknown' and supervisor.active == {}
    settle.assert_not_awaited()


@pytest.mark.asyncio
async def test_attach_without_local_runner_requires_reconciliation(guarded_native):
    _service, _session, grant, engine = guarded_native
    service = FencedBackgroundSessionService(replace(grant, resume_intent='attach'), db_engine=engine)
    run = AsyncMock()
    with pytest.raises(BackgroundOwnershipError, match='reconciliation'):
        await BackgroundInvocationSupervisor().start_or_attach(service, run, AsyncMock(), AsyncMock())
    run.assert_not_awaited()


@pytest.mark.asyncio
async def test_uncertain_action_joins_native_task_before_owned_unknown_settlement(guarded_native):
    from src.root_runtime.background_actions import BackgroundActionUnknown
    service, _session, _grant, _engine = guarded_native
    supervisor = BackgroundInvocationSupervisor()
    joined = asyncio.Event()
    settled = []

    async def run(queue, abort):
        try:
            raise BackgroundActionUnknown('external action needs reconciliation')
        finally:
            joined.set()

    async def settle(result, status):
        assert joined.is_set()
        settled.append((result, status))

    handle = await supervisor.start_or_attach(service, run, AsyncMock(), settle)
    await handle.task
    assert settled == [(None, 'outcome_unknown')] and supervisor.active == {}


@pytest.mark.asyncio
async def test_owner_loss_during_post_runner_drain_joins_blocked_sink(guarded_native):
    service, _session, grant, engine = guarded_native
    supervisor = BackgroundInvocationSupervisor(owner_check_seconds=.02)
    sink_started, sink_joined, runner_done = asyncio.Event(), asyncio.Event(), asyncio.Event()
    settle = AsyncMock()

    async def sink(event):
        sink_started.set()
        try:
            await asyncio.Event().wait()
        finally:
            sink_joined.set()

    async def run(queue, abort):
        await queue.put({'terminal': 'completed'})
        runner_done.set()
        return 'output'

    handle = await supervisor.start_or_attach(service, run, sink, settle)
    await sink_started.wait(); await runner_done.wait()
    async with engine.begin() as connection:
        await connection.execute(text("UPDATE conversation.root_background_jobs SET owner='successor',fence=fence+1 WHERE execution_id=:id"),
            {'id': grant.execution_id})
    await asyncio.wait_for(handle.task, 5)
    assert sink_joined.is_set() and handle.status == 'outcome_unknown' and supervisor.active == {}
    settle.assert_not_awaited()


@pytest.mark.asyncio
async def test_failed_sink_with_full_queue_does_not_deadlock_final_sentinel(guarded_native):
    service, _session, _grant, _engine = guarded_native
    supervisor = BackgroundInvocationSupervisor()
    sink_started, release_sink, runner_done = asyncio.Event(), asyncio.Event(), asyncio.Event()
    settled = []

    async def sink(event):
        sink_started.set()
        await release_sink.wait()
        raise OSError('durable sink unavailable')

    async def run(queue, abort):
        await queue.put({'first': True})
        await sink_started.wait()
        for index in range(queue.maxsize):
            await queue.put({'index': index})
        runner_done.set()
        return 'output'

    async def settle(result, status):
        settled.append((result, status))

    handle = await supervisor.start_or_attach(service, run, sink, settle)
    await runner_done.wait()
    await asyncio.sleep(.02)
    release_sink.set()
    await asyncio.wait_for(handle.task, 5)
    assert settled == [(None, 'failed')] and supervisor.active == {}
