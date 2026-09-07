"""Process-local coordination for persisted ADK session turns."""

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass


PERSISTED_SESSION_APP_NAME = "manager_app"


@dataclass
class _LockEntry:
    lock: asyncio.Lock
    references: int = 0


_entries: dict[tuple[str, str, str], _LockEntry] = {}
_entries_guard = asyncio.Lock()


@asynccontextmanager
async def session_execution_lock(
    app_name: str,
    user_id: str,
    session_id: str,
) -> AsyncIterator[None]:
    """Allow only one active turn for a persisted ADK session per process."""
    key = (app_name, user_id, session_id)
    async with _entries_guard:
        entry = _entries.get(key)
        if entry is None:
            entry = _LockEntry(lock=asyncio.Lock())
            _entries[key] = entry
        entry.references += 1

    acquired = False
    try:
        await entry.lock.acquire()
        acquired = True
        yield
    finally:
        if acquired:
            entry.lock.release()
        async with _entries_guard:
            entry.references -= 1
            if entry.references == 0:
                _entries.pop(key, None)
