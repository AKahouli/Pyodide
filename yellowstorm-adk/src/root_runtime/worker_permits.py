"""Foreground shared-slot ownership; no permit is needed by the coordinator."""
from __future__ import annotations

import asyncio
import time
from contextlib import asynccontextmanager
from uuid import uuid4

from src.logger.logging import get_logger
from src.root_runtime.delegate_resolver import _post

logger = get_logger('root_runtime.worker_permits')


@asynccontextmanager
async def worker_permit(scope, child_id: str, abort_signal=None):
    owner = uuid4().hex
    path = f'children/{child_id}/permit'
    acquired = False
    waited = False
    try:
        while not acquired:
            if abort_signal is not None and abort_signal.is_set():
                raise asyncio.CancelledError('Worker permit wait cancelled')
            deadline = getattr(scope, 'deadline_epoch_ms', None)
            if not deadline or time.time() * 1000 >= deadline:
                raise TimeoutError('Worker permit deadline expired')
            response = await _post(scope, path, {'owner': owner, 'operation': 'acquire'})
            if not isinstance(response.get('acquired'), bool):
                raise ValueError('Invalid trusted worker permit response')
            acquired = response.get('acquired') is True
            if not acquired:
                waited = True
                if abort_signal is None:
                    await asyncio.sleep(0.1)
                else:
                    try:
                        await asyncio.wait_for(abort_signal.wait(), timeout=0.1)
                    except TimeoutError:
                        continue
        # Check cancellation again after the asynchronous grant; cleanup owns
        # the permit even when Stop wins just before child execution starts.
        if abort_signal is not None and abort_signal.is_set():
            raise asyncio.CancelledError('Worker start cancelled')
        if time.time() * 1000 >= deadline:
            raise TimeoutError('Worker start deadline expired')
        yield waited
    finally:
        if acquired:
            try:
                await _post(scope, path, {'owner': owner, 'operation': 'release'})
            except Exception:
                # A failed release retains the slot; preserve native WAIT or
                # cancellation instead of turning it into a successful item.
                logger.exception('Could not release owned foreground worker slot')
