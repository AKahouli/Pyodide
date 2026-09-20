from __future__ import annotations

import asyncio
import logging
import uuid
from contextlib import suppress
from typing import Protocol

from app.workers.celery_app import celery_app

from .models import OutboxItem

logger = logging.getLogger(__name__)


class OutboxRepository(Protocol):
    async def claim_outbox(self, *, claim_owner: str, claim_seconds: int) -> OutboxItem | None: ...
    async def mark_outbox_published(self, outbox_id: int, claim_owner: str) -> bool: ...
    async def release_outbox(
        self, outbox_id: int, claim_owner: str, error_code: str, retry_seconds: int
    ) -> bool: ...


class OutboxDispatcher:
    """At-least-once DB outbox -> RabbitMQ task-reference dispatcher."""

    def __init__(self, repository: OutboxRepository, interval_seconds: float = 1.0):
        self.repository = repository
        self.interval_seconds = interval_seconds
        self.dispatcher_id = f"dispatcher:{uuid.uuid4().hex}"
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

    async def dispatch_once(self) -> bool:
        claim = f"{self.dispatcher_id}:{uuid.uuid4().hex}"
        item = await self.repository.claim_outbox(claim_owner=claim, claim_seconds=30)
        if item is None:
            return False
        try:
            # Only references cross RabbitMQ. Canonical inputs remain in PostgreSQL.
            celery_app.send_task(
                item.task_name,
                args=[item.task_id],
                queue=item.queue_name,
                task_id=f"semantic-task-{item.task_id}",
            )
        except Exception as exc:
            await self.repository.release_outbox(
                item.outbox_id, claim, type(exc).__name__[:100], retry_seconds=5
            )
            logger.warning("Semantic task dispatch failed", extra={"outbox_id": item.outbox_id})
            return False
        if not await self.repository.mark_outbox_published(item.outbox_id, claim):
            # Delivery may have succeeded; leave the row for idempotent redelivery.
            logger.warning("Semantic outbox publish acknowledgement was fenced", extra={"outbox_id": item.outbox_id})
            return False
        return True

    async def _run(self) -> None:
        while True:
            try:
                dispatched = await self.dispatch_once()
            except Exception as exc:
                # Database/broker control-plane failures must not silently kill
                # the supervised dispatcher. Never log payloads or credentials.
                logger.warning(
                    "Semantic outbox dispatcher iteration failed",
                    extra={"error_code": type(exc).__name__[:100]},
                )
                dispatched = False
            if not dispatched:
                await asyncio.sleep(self.interval_seconds)
