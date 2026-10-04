import asyncio
import time
from types import SimpleNamespace

import pytest

from src.root_runtime.worker_permits import worker_permit


@pytest.mark.asyncio
async def test_busy_slot_waits_then_releases_same_owner(monkeypatch):
    calls = []
    async def post(scope, path, payload):
        calls.append(payload)
        return {'acquired': len(calls) > 1}
    monkeypatch.setattr('src.root_runtime.worker_permits._post', post)
    async with worker_permit(SimpleNamespace(deadline_epoch_ms=time.time() * 1000 + 1000), 'child') as waited:
        assert waited is True
    assert [item['operation'] for item in calls] == ['acquire', 'acquire', 'release']
    assert len({item['owner'] for item in calls}) == 1


@pytest.mark.asyncio
async def test_stop_before_wait_never_acquires(monkeypatch):
    async def forbidden(*args):
        raise AssertionError('Must not request a permit')
    monkeypatch.setattr('src.root_runtime.worker_permits._post', forbidden)
    stop = asyncio.Event(); stop.set()
    with pytest.raises(asyncio.CancelledError):
        async with worker_permit(SimpleNamespace(deadline_epoch_ms=time.time() * 1000 + 1000), 'child', stop):
            raise AssertionError('Must not start')


@pytest.mark.asyncio
async def test_stop_during_grant_releases_without_start(monkeypatch):
    calls = []; stop = asyncio.Event()
    async def post(scope, path, payload):
        calls.append(payload['operation']); stop.set()
        return {'acquired': True}
    monkeypatch.setattr('src.root_runtime.worker_permits._post', post)
    with pytest.raises(asyncio.CancelledError):
        async with worker_permit(SimpleNamespace(deadline_epoch_ms=time.time() * 1000 + 1000), 'child', stop):
            raise AssertionError('Must not start')
    assert calls == ['acquire', 'release']


@pytest.mark.asyncio
async def test_native_base_exception_propagates_after_release(monkeypatch):
    class NativeWait(BaseException):
        pass
    calls = []
    async def post(scope, path, payload):
        calls.append(payload['operation'])
        return {'acquired': True}
    monkeypatch.setattr('src.root_runtime.worker_permits._post', post)
    with pytest.raises(NativeWait):
        async with worker_permit(SimpleNamespace(deadline_epoch_ms=time.time() * 1000 + 1000), 'child'):
            raise NativeWait()
    assert calls == ['acquire', 'release']


@pytest.mark.asyncio
async def test_expired_deadline_never_acquires(monkeypatch):
    async def forbidden(*args):
        raise AssertionError('Must not request a permit')
    monkeypatch.setattr('src.root_runtime.worker_permits._post', forbidden)
    with pytest.raises(TimeoutError):
        async with worker_permit(SimpleNamespace(deadline_epoch_ms=1), 'child'):
            raise AssertionError('Must not start')
