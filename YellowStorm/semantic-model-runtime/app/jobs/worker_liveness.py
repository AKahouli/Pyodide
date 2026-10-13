"""Worker liveness for the job queues.

Every Celery worker records itself in ``semantic_jobs.worker_heartbeats`` about every
``HEARTBEAT_INTERVAL_SECONDS`` from a daemon thread, so a task that blocks the (solo) worker
loop does not make the worker look gone. A worker is online while its last beat is younger
than ``ONLINE_WINDOW_SECONDS``. Readers (job reads, the dispatcher) query the table; nothing
calls ``celery inspect``.
"""

from __future__ import annotations

import asyncio
import logging
import os
import threading
from collections.abc import Sequence

import asyncpg

logger = logging.getLogger(__name__)

HEARTBEAT_INTERVAL_SECONDS = 15
ONLINE_WINDOW_SECONDS = 45
_DB_TIMEOUT_SECONDS = 5

UPSERT_HEARTBEAT_SQL = """
    INSERT INTO semantic_jobs.worker_heartbeats (worker_id, queues, pid)
    VALUES ($1, $2::text[], $3)
    ON CONFLICT (worker_id) DO UPDATE
      SET queues = EXCLUDED.queues, pid = EXCLUDED.pid, last_seen = now()
"""


async def _with_connection(dsn: str, statement: str, *args: object) -> None:
    connection = await asyncpg.connect(dsn, timeout=_DB_TIMEOUT_SECONDS, command_timeout=_DB_TIMEOUT_SECONDS)
    try:
        await connection.execute(statement, *args)
    finally:
        await connection.close()


class WorkerHeartbeat:
    """Daemon thread beating for one worker. Failures are logged on the way down and on the
    way back up, not on every beat."""

    def __init__(self, dsn: str, worker_id: str, queues: Sequence[str], interval: float = HEARTBEAT_INTERVAL_SECONDS):
        self.dsn = dsn
        self.worker_id = worker_id
        self.queues = list(queues)
        self.interval = interval
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._failing = False

    def beat_once(self) -> bool:
        try:
            asyncio.run(_with_connection(
                self.dsn, UPSERT_HEARTBEAT_SQL, self.worker_id, self.queues, os.getpid()))
        except Exception as exc:
            if not self._failing:
                logger.warning("Worker heartbeat failed; the queue may look unattended",
                               extra={"error_code": type(exc).__name__[:100]})
            self._failing = True
            return False
        if self._failing:
            logger.info("Worker heartbeat recovered")
        self._failing = False
        return True

    def _run(self) -> None:
        while True:
            self.beat_once()
            if self._stop.wait(self.interval):
                return

    def start(self) -> None:
        if self._thread is None:
            self._thread = threading.Thread(target=self._run, name="worker-heartbeat", daemon=True)
            self._thread.start()

    def stop(self) -> None:
        """Stop beating and drop the row so a clean shutdown shows as offline at once."""
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=_DB_TIMEOUT_SECONDS + 1)
            self._thread = None
        try:
            asyncio.run(_with_connection(
                self.dsn, "DELETE FROM semantic_jobs.worker_heartbeats WHERE worker_id = $1", self.worker_id))
        except Exception as exc:
            # The row ages out of the online window by itself.
            logger.warning("Worker heartbeat cleanup failed",
                           extra={"error_code": type(exc).__name__[:100]})


_heartbeat: WorkerHeartbeat | None = None


def start_worker_heartbeat(consumer: object) -> WorkerHeartbeat | None:
    """Begin beating for the worker whose consumer Celery passed to ``worker_ready``."""
    global _heartbeat
    dsn = os.environ.get("SEMANTIC_RUNTIME_DATABASE_URL", "")
    if not dsn or _heartbeat is not None:
        return _heartbeat
    queues = sorted(consumer.app.amqp.queues.consume_from)  # type: ignore[attr-defined]
    _heartbeat = WorkerHeartbeat(dsn, str(consumer.hostname), queues)  # type: ignore[attr-defined]
    _heartbeat.start()
    return _heartbeat


def stop_worker_heartbeat() -> None:
    global _heartbeat
    if _heartbeat is not None:
        _heartbeat.stop()
        _heartbeat = None
