from __future__ import annotations

import asyncio
import logging
import math
import uuid
from contextlib import suppress

from app.persistence.ui_signal_outbox import UiSignalOutboxRepository
from app.realtime.publisher import RealtimeBroadcastPublisher

logger = logging.getLogger(__name__)


class UiSignalDispatcher:
    def __init__(self, repository: UiSignalOutboxRepository,
                 publisher: RealtimeBroadcastPublisher, *, interval_seconds: float = 1.0,
                 batch_size: int = 20, max_attempts: int = 8):
        self.repository = repository
        self.publisher = publisher
        self.interval_seconds = interval_seconds
        self.batch_size = batch_size
        self.max_attempts = max_attempts
        self.dispatcher_id = f"ui-signal:{uuid.uuid4().hex}"
        self._runner: asyncio.Task[None] | None = None

    async def start(self) -> None:
        if self._runner is None:
            self._runner = asyncio.create_task(self._run())

    async def stop(self) -> None:
        if self._runner is None:
            return
        self._runner.cancel()
        with suppress(asyncio.CancelledError):
            await self._runner
        self._runner = None

    async def dispatch_once(self) -> int:
        owner = f"{self.dispatcher_id}:{uuid.uuid4().hex}"
        timeout_seconds = self.publisher.timeout_seconds
        claim_seconds = max(30, math.ceil(timeout_seconds * self.batch_size) + 10)
        signals = await self.repository.claim(
            claim_owner=owner, claim_seconds=claim_seconds, batch_size=self.batch_size)
        published = 0
        for signal in signals:
            try:
                await self.publisher.publish(model_id=signal.model_id,
                                             event_type=signal.event_type,
                                             payload=signal.payload)
            except Exception as exc:
                retry = min(300, 2 ** min(8, signal.attempt_count))
                await self.repository.release(signal.id, owner, error=type(exc).__name__,
                                              retry_seconds=retry,
                                              max_attempts=self.max_attempts)
                logger.warning("Semantic UI signal publication failed",
                               extra={"signal_id": signal.id,
                                      "error_code": type(exc).__name__[:100]})
                continue
            if await self.repository.mark_published(signal.id, owner):
                published += 1
        return published

    async def _run(self) -> None:
        while True:
            try:
                published = await self.dispatch_once()
            except Exception as exc:
                logger.warning("Semantic UI signal dispatcher iteration failed",
                               extra={"error_code": type(exc).__name__[:100]})
                published = 0
            if published == 0:
                await asyncio.sleep(self.interval_seconds)
