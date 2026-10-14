"""Independent task-lease renewal for claimed long tasks (P0-02).

One guard per claimed task owns a small renewal thread with its own asyncio
loop and its own PostgreSQL connection, so a legitimate silent stage (an
archive parse, an AI call, a long save, a graph projection) never loses a
healthy lease just because the worker's main loop is busy or blocked. The
SQL predicate is the existing fenced renewal: exact task, owner and epoch,
state ``running``, lease not yet expired, with PostgreSQL's clock as the
authority.

Loss rules (fail closed):

- A fenced renewal that returns no row is permanent loss for this attempt.
- A database or network failure is *unverified*, never evidence of ownership.
  While unverified, only the already-granted lease time is trusted; once it
  runs out without a confirmed renewal the guard is lost for good, and a
  later reconnection cannot resurrect the attempt.

The guard never writes progress and never chooses a competing lease window:
progress reporting keeps its own fenced write (``checkpoint(..., renew=False)``)
and verifies ownership without moving the expiry.
"""

from __future__ import annotations

import asyncio
import logging
import os
import threading
import time
from dataclasses import dataclass

from app.persistence.postgres_jobs import RENEW_LEASE_SQL

logger = logging.getLogger(__name__)

DEFAULT_LEASE_SECONDS = 180
DEFAULT_RENEW_SECONDS = 20.0
_CONNECTION_TIMEOUT_SECONDS = 5
_RENEW_TIMEOUT_SECONDS = 10


class TaskLeaseLost(RuntimeError):
    """Ownership is expired, replaced, or cannot be re-verified in time."""


def lease_windows_from_env(environment: dict[str, str] | None = None) -> tuple[int, float]:
    """The guard's lease and renewal windows. Proposed P0 defaults (180 s kept
    alive every 20 s) to validate in staging, not observed production timings;
    a 7,200 s parser does not need a 7,200 s lease."""
    env = {**os.environ, **(environment or {})}

    def read(name: str, default: float) -> float:
        try:
            return float(env.get(name, str(default)))
        except ValueError:
            return default

    lease = max(int(read("SEMANTIC_TASK_LEASE_SECONDS", DEFAULT_LEASE_SECONDS)), 3)
    renew = min(max(read("SEMANTIC_TASK_LEASE_RENEW_SECONDS", DEFAULT_RENEW_SECONDS), 0.05), lease / 3)
    return lease, renew


@dataclass(frozen=True)
class TaskOwnership:
    task_id: int
    job_id: str
    lease_owner: str
    lease_epoch: int


class TaskLeaseGuard:
    """Lifetime tied to ONE successful claim.

    ``start()`` spawns the renewal thread and waits for its connection;
    ``stop()`` ends the thread and closes the connection, and must run in the
    worker's ``finally`` whatever the task's outcome, so a finished attempt can
    never keep extending a lease.
    """

    def __init__(self, ownership: TaskOwnership, *, lease_seconds: int = DEFAULT_LEASE_SECONDS,
                 renew_seconds: float = DEFAULT_RENEW_SECONDS, dsn: str | None = None):
        if renew_seconds <= 0 or lease_seconds <= 0:
            raise ValueError("lease and renewal windows must be positive")
        if renew_seconds * 3 > lease_seconds:
            raise ValueError("renew every less than a third of the lease")
        self.ownership = ownership
        self.lease_seconds = lease_seconds
        self.renew_seconds = renew_seconds
        self.dsn = dsn or os.environ["SEMANTIC_RUNTIME_DATABASE_URL"]
        self.lost_event = threading.Event()
        self._lost_reason = ""
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._connection = None  # owned by, and only used on, the renewal loop
        self._wake: asyncio.Event | None = None
        self._ready = threading.Event()
        # Monotonic early-warning bound of the lease time already granted. The
        # database clock remains the authority; this only fails the attempt
        # closed when no renewal has been confirmed for too long.
        self._assured_until = 0.0

    # -- lifecycle ---------------------------------------------------------

    async def start(self) -> None:
        if self._thread is not None:
            return
        self._assured_until = time.monotonic() + self.lease_seconds
        self._thread = threading.Thread(target=self._thread_main,
                                        name=f"task-lease-{self.ownership.task_id}", daemon=True)
        self._thread.start()
        if not await asyncio.to_thread(self._ready.wait, _CONNECTION_TIMEOUT_SECONDS + _RENEW_TIMEOUT_SECONDS):
            self.stop()
            raise TaskLeaseLost("the lease renewal thread did not start")

    def stop(self) -> None:
        """End renewals for good and release the renewal connection."""
        self._stop.set()
        loop = self._loop
        if loop is not None and loop.is_running():
            def wake() -> None:
                if self._wake is not None:
                    self._wake.set()
            try:
                loop.call_soon_threadsafe(wake)
            except RuntimeError:
                pass
        thread, self._thread = self._thread, None
        if thread is not None:
            thread.join(timeout=_CONNECTION_TIMEOUT_SECONDS + _RENEW_TIMEOUT_SECONDS)
        if not self._lost_reason:
            self._lost_reason = "the task attempt has ended"

    def _thread_main(self) -> None:
        asyncio.run(self._renew_loop())

    async def _renew_loop(self) -> None:
        import asyncpg

        loop = asyncio.get_running_loop()
        self._loop = loop
        wake = asyncio.Event()
        self._wake = wake
        try:
            try:
                self._connection = await asyncio.wait_for(
                    asyncpg.connect(self.dsn, timeout=_CONNECTION_TIMEOUT_SECONDS,
                                    command_timeout=_CONNECTION_TIMEOUT_SECONDS,
                                    statement_cache_size=0,
                                    server_settings={"application_name": "semantic-task-lease-guard"}),
                    _CONNECTION_TIMEOUT_SECONDS)
            except Exception as exc:
                self._mark_lost(f"the renewal connection never opened: {type(exc).__name__}")
                return
            self._ready.set()
            while not self._stop.is_set() and not self._lost_reason:
                try:
                    await asyncio.wait_for(self._renew_once(self._connection), _RENEW_TIMEOUT_SECONDS)
                except asyncio.CancelledError:
                    raise
                except Exception:
                    # Unverified, not ownership. Trust only the granted window.
                    try:
                        await self._connection.close()
                    except Exception:
                        pass
                    self._connection = None
                    if time.monotonic() > self._assured_until:
                        self._mark_lost("no confirmed renewal inside the granted lease window")
                        return
                    await self._reopen()
                if self._lost_reason:
                    break
                try:
                    await asyncio.wait_for(wake.wait(), self.renew_seconds)
                    wake.clear()
                except asyncio.TimeoutError:
                    pass
        finally:
            connection, self._connection = self._connection, None
            if connection is not None:
                try:
                    await connection.close()
                except Exception:
                    pass
            self._ready.set()

    async def _reopen(self) -> None:
        import asyncpg

        while not self._stop.is_set() and self._connection is None and not self._lost_reason:
            try:
                self._connection = await asyncio.wait_for(
                    asyncpg.connect(self.dsn, timeout=_CONNECTION_TIMEOUT_SECONDS,
                                    command_timeout=_CONNECTION_TIMEOUT_SECONDS,
                                    statement_cache_size=0,
                                    server_settings={"application_name": "semantic-task-lease-guard"}),
                    _CONNECTION_TIMEOUT_SECONDS)
            except Exception:
                if time.monotonic() > self._assured_until:
                    self._mark_lost("no confirmed renewal inside the granted lease window")
                    return
                await asyncio.sleep(min(self.renew_seconds, 2.0))

    def _mark_lost(self, reason: str) -> None:
        if self._lost_reason:
            return
        self._lost_reason = reason or "lease lost"
        self.lost_event.set()
        logger.warning("Task lease lost; the attempt must stop making effects",
                       extra={"task_id": self.ownership.task_id, "job_id": self.ownership.job_id,
                              "lease_epoch": self.ownership.lease_epoch})

    async def _renew_once(self, connection) -> bool:  # type: ignore[no-untyped-def]
        row = await connection.fetchrow(
            RENEW_LEASE_SQL, self.ownership.task_id, self.ownership.lease_owner,
            self.ownership.lease_epoch, self.lease_seconds)
        if row is None:
            self._mark_lost("the lease expired or was taken by another attempt")
            return False
        self._assured_until = time.monotonic() + self.lease_seconds
        return True

    # -- checks ------------------------------------------------------------

    def assert_healthy(self) -> None:
        """Raise unless a renewal is currently confirmed inside the lease window."""
        if self._lost_reason:
            raise TaskLeaseLost(self._lost_reason)
        if time.monotonic() > self._assured_until:
            self._mark_lost("no confirmed renewal inside the lease window")
            raise TaskLeaseLost(self._lost_reason)

    async def assert_owned(self) -> None:
        """Durable verification: one fenced renewal on the guard's connection.

        Runs on the renewal thread's loop, so ownership is checked where the
        lease is renewed. A bounded wait: a timeout is unverified, and therefore
        not proof of ownership.
        """
        self.assert_healthy()
        loop = self._loop
        if loop is None or loop.is_closed() or self._connection is None:
            raise TaskLeaseLost(self._lost_reason or "the lease renewal thread is not running")
        try:
            renewed = await asyncio.wait_for(
                asyncio.wrap_future(asyncio.run_coroutine_threadsafe(
                    self._renew_once(self._connection), loop)), _RENEW_TIMEOUT_SECONDS)
        except (asyncio.TimeoutError, RuntimeError) as exc:
            raise TaskLeaseLost(f"lease ownership could not be verified in time: {type(exc).__name__}") from exc
        if not renewed:
            raise TaskLeaseLost(self._lost_reason or "lease ownership was refused")

    def reason(self) -> str:
        return self._lost_reason
