from __future__ import annotations

import asyncio
import logging
import os
import uuid
from contextlib import suppress
from typing import Protocol

from app.workers.celery_app import celery_app

from .models import OutboxItem
from .recovery import (
    grace_seconds_from_env,
    max_attempts_from_env,
    retry_seconds_from_env,
)

logger = logging.getLogger(__name__)


class OutboxRepository(Protocol):
    async def claim_outbox(self, *, claim_owner: str, claim_seconds: int) -> OutboxItem | None: ...
    async def mark_outbox_published(self, outbox_id: int, claim_owner: str) -> bool: ...
    async def release_outbox(
        self, outbox_id: int, claim_owner: str, error_code: str, retry_seconds: int
    ) -> bool: ...
    async def recover_stalled_tasks(
        self, *, max_attempts: int, retry_seconds: int, grace_seconds: int, batch: int
    ) -> dict[str, int]: ...


class OutboxDispatcher:
    """At-least-once DB outbox -> RabbitMQ task-reference dispatcher.

    Broker delivery is only a hint. Rejected or lost deliveries are recovered
    from PostgreSQL: :meth:`recover_once` requeues tasks whose lease expired
    and republishes their outbox row, so a Celery rejection cannot strand a
    durable job.
    """

    def __init__(
        self,
        repository: OutboxRepository,
        interval_seconds: float = 1.0,
        max_attempts: int | None = None,
        retry_seconds: int | None = None,
        grace_seconds: int | None = None,
        recovery_batch: int = 50,
    ):
        self.repository = repository
        self.interval_seconds = interval_seconds
        self.max_attempts = (
            max_attempts if max_attempts is not None
            else max_attempts_from_env(os.environ.get("SEMANTIC_TASK_MAX_ATTEMPTS"))
        )
        self.retry_seconds = (
            retry_seconds if retry_seconds is not None
            else retry_seconds_from_env(os.environ.get("SEMANTIC_TASK_RETRY_SECONDS"))
        )
        self.grace_seconds = (
            grace_seconds if grace_seconds is not None
            else grace_seconds_from_env(os.environ.get("SEMANTIC_DISPATCH_GRACE_SECONDS"))
        )
        self.recovery_batch = recovery_batch
        self.dispatcher_id = f"dispatcher:{uuid.uuid4().hex}"
        self._runner: asyncio.Task[None] | None = None

    async def recover_once(self) -> dict[str, int]:
        """Recover tasks whose worker or delivery died before completion."""
        recover = getattr(self.repository, "recover_stalled_tasks", None)
        if recover is None:
            return {"exhausted": 0, "requeued": 0}
        return await recover(
            max_attempts=self.max_attempts,
            retry_seconds=self.retry_seconds,
            grace_seconds=self.grace_seconds,
            batch=self.recovery_batch,
        )

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
                await self.recover_once()
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
