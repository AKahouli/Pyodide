"""Owned native task lifetime, independent of any RPC observer.

The caller supplies a durable sanitized event sink and owned final settlement.
No production transport starts this until the complete background gate passes.
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field

from src.root_runtime.background_actions import BackgroundActionUnknown
from src.root_runtime.background_sessions import BackgroundOwnershipError, FencedBackgroundSessionService

logger = logging.getLogger(__name__)


@dataclass
class BackgroundInvocation:
    service: FencedBackgroundSessionService
    abort: asyncio.Event = field(default_factory=asyncio.Event)
    task: asyncio.Task | None = None
    status: str = 'running'
    stop_requested: bool = False


class BackgroundInvocationSupervisor:
    def __init__(self, *, owner_check_seconds=2, abort_grace_seconds=5):
        if owner_check_seconds <= 0 or abort_grace_seconds <= 0:
            raise ValueError('Supervisor intervals must be positive')
        self.owner_check_seconds = owner_check_seconds
        self.abort_grace_seconds = abort_grace_seconds
        self.active: dict[str, BackgroundInvocation] = {}
        self._lock = asyncio.Lock()

    async def start_or_attach(self, service, run, persist_event, settle):
        if not isinstance(service, FencedBackgroundSessionService):
            raise ValueError('Background supervisor requires a fenced native service')
        await service.validate_owner()
        grant = service.grant
        async with self._lock:
            existing = self.active.get(grant.execution_id)
            if existing is not None:
                previous = existing.service.grant
                if (previous.owner, previous.fence, previous.session_id) != (grant.owner, grant.fence, grant.session_id):
                    raise BackgroundOwnershipError('Previous local owner must stop before takeover')
                return existing
            if grant.resume_intent == 'attach':
                raise BackgroundOwnershipError('No local invocation to attach; durable reconciliation required')
            handle = BackgroundInvocation(service)
            self.active[grant.execution_id] = handle
            handle.task = asyncio.create_task(self._execute(handle, run, persist_event, settle))
            return handle

    async def stop(self, execution_id):
        handle = self.active.get(execution_id)
        if handle is None:
            return
        handle.stop_requested = True
        handle.abort.set()
        await asyncio.shield(handle.task)

    async def _seal_and_drain(self, queue, finished, consumer, watcher):
        seal = asyncio.create_task(queue.put(finished))
        pending = {seal, consumer}
        watched_owner = watcher
        stop_deadline = None
        try:
            while pending:
                watched = pending | ({watched_owner} if watched_owner is not None else set())
                timeout = None if stop_deadline is None else max(0, stop_deadline - asyncio.get_running_loop().time())
                done, _ = await asyncio.wait(watched, timeout=timeout, return_when=asyncio.FIRST_COMPLETED)
                if not done:
                    raise TimeoutError('Background event drain exceeded native abort grace')
                for task in done:
                    await task
                    pending.discard(task)
                    if task is watched_owner:
                        watched_owner = None
                        stop_deadline = asyncio.get_running_loop().time() + self.abort_grace_seconds
        finally:
            if not seal.done():
                seal.cancel()
            await asyncio.gather(seal, return_exceptions=True)

    async def _execute(self, handle, run, persist_event, settle):
        queue = asyncio.Queue(maxsize=64)
        finished = object()

        async def drain():
            while True:
                event = await queue.get()
                if event is finished:
                    return
                # Legacy producers send None before returning. Settlement must
                # wait for Runner completion, not that observer sentinel.
                if event is not None:
                    await persist_event(event)

        async def watch_owner():
            while not handle.abort.is_set():
                try:
                    await asyncio.wait_for(handle.abort.wait(), self.owner_check_seconds)
                except asyncio.TimeoutError:
                    await handle.service.validate_owner()

        consumer = asyncio.create_task(drain())
        worker = asyncio.create_task(run(queue, handle.abort))
        watcher = asyncio.create_task(watch_owner())
        result = None
        failure_status = None
        try:
            done, _ = await asyncio.wait((worker, consumer, watcher), return_when=asyncio.FIRST_COMPLETED)
            if consumer in done:
                await consumer
                raise RuntimeError('Durable event sink ended before native execution')
            if watcher in done:
                await watcher
                # Explicit Stop allows native abort events to drain; authority
                # loss raises above and cannot settle under a stale owner.
                result = await asyncio.wait_for(asyncio.shield(worker), self.abort_grace_seconds)
            else:
                result = await worker
            await self._seal_and_drain(queue, finished, consumer, watcher)
            await handle.service.validate_owner()
            acknowledged = await settle(result, 'cancelled' if handle.stop_requested else 'finished')
            handle.status = acknowledged if acknowledged in ('completed', 'waiting', 'failed', 'outcome_unknown', 'cancelled') else (
                'cancelled' if handle.stop_requested else 'finished')
        except (BackgroundOwnershipError, BackgroundActionUnknown):
            handle.status = 'cancelled' if handle.stop_requested else 'outcome_unknown'
            failure_status = handle.status
            handle.abort.set()
        except BaseException as error:
            handle.status = 'cancelled' if handle.stop_requested else (
                'outcome_unknown' if isinstance(error, asyncio.CancelledError) else 'failed')
            failure_status = handle.status
            handle.abort.set()
            logger.error('Background native task failed execution=%s error_type=%s',
                handle.service.grant.execution_id, type(error).__name__)
        finally:
            for task in (worker, consumer, watcher):
                if not task.done():
                    task.cancel()
            await asyncio.gather(worker, consumer, watcher, return_exceptions=True)
            if failure_status is not None:
                try:
                    if failure_status != 'cancelled':
                        await handle.service.validate_owner()
                    await settle(None, failure_status)
                except BackgroundOwnershipError:
                    handle.status = 'outcome_unknown'
                except Exception as error:
                    handle.status = 'outcome_unknown'
                    logger.error('Background settlement requires reconciliation execution=%s error_type=%s',
                        handle.service.grant.execution_id, type(error).__name__)
            async with self._lock:
                if self.active.get(handle.service.grant.execution_id) is handle:
                    del self.active[handle.service.grant.execution_id]
