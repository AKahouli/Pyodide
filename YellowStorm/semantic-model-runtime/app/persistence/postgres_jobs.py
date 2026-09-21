from __future__ import annotations

import json
from typing import Any

import asyncpg

from app.jobs.models import (
    Admission,
    IdempotencyConflict,
    JobCommand,
    Lease,
    OutboxItem,
    SourceEvent,
    StaleLease,
)
from app.jobs.recovery import backoff_seconds


def _json(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"), sort_keys=True)


def _object(value: Any) -> dict[str, Any]:
    if isinstance(value, str):
        value = json.loads(value)
    return value if isinstance(value, dict) else {}


class PostgresJobRepository:
    """Parameterized PostgreSQL repository for P2.4 durable execution."""

    def __init__(self, pool: asyncpg.Pool):
        self.pool = pool

    async def record_source_event(self, event: SourceEvent) -> dict[str, Any]:
        payload = event.payload.model_dump(by_alias=True, mode="json")
        workspace_id = event.payload.workspace_id
        asset_id = event.payload.document_id
        is_reconciliation = event.event_id.startswith("reconcile:")
        async with self.pool.acquire() as connection:
            async with connection.transaction():
                await connection.execute(
                    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
                    f"{workspace_id}:{asset_id}",
                )
                existing = await connection.fetchrow(
                    "SELECT revision FROM semantic_jobs.source_revisions WHERE event_id = $1",
                    event.event_id,
                )
                if existing is not None:
                    if is_reconciliation:
                        await connection.execute(
                            """
                            UPDATE semantic_jobs.source_heads SET last_reconciled_at = now()
                            WHERE workspace_id = $1 AND asset_id = $2
                            """,
                            workspace_id,
                            asset_id,
                        )
                    return {"revision": existing["revision"], "reused": True}
                revision = await connection.fetchval(
                    """
                    SELECT COALESCE(max(revision), 0) + 1
                    FROM semantic_jobs.source_revisions
                    WHERE workspace_id = $1 AND asset_id = $2
                    """,
                    workspace_id,
                    asset_id,
                )
                await connection.execute(
                    """
                    INSERT INTO semantic_jobs.source_revisions
                      (event_id, workspace_id, asset_id, revision, event_type, occurred_at, payload)
                    VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
                    """,
                    event.event_id,
                    workspace_id,
                    asset_id,
                    revision,
                    event.event_type,
                    event.occurred_at,
                    _json(payload),
                )
                applied = await connection.fetchval(
                    """
                    INSERT INTO semantic_jobs.source_heads
                      (workspace_id, asset_id, revision, event_id, event_type, occurred_at, payload, deleted)
                    VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
                    ON CONFLICT (workspace_id, asset_id) DO UPDATE
                    SET revision = EXCLUDED.revision, event_id = EXCLUDED.event_id,
                        event_type = EXCLUDED.event_type, occurred_at = EXCLUDED.occurred_at,
                        payload = EXCLUDED.payload, deleted = EXCLUDED.deleted,
                        last_reconciled_at = now(), updated_at = now()
                    WHERE EXCLUDED.occurred_at > source_heads.occurred_at
                       OR (EXCLUDED.occurred_at = source_heads.occurred_at
                           AND EXCLUDED.revision > source_heads.revision)
                    RETURNING revision
                    """,
                    workspace_id,
                    asset_id,
                    revision,
                    event.event_id,
                    event.event_type,
                    event.occurred_at,
                    _json(payload),
                    event.event_type == "workspace.document.deleted.v1",
                )
                if is_reconciliation and applied is None:
                    await connection.execute(
                        """
                        UPDATE semantic_jobs.source_heads SET last_reconciled_at = now()
                        WHERE workspace_id = $1 AND asset_id = $2
                        """,
                        workspace_id,
                        asset_id,
                    )
                return {"revision": revision, "reused": False, "headAdvanced": applied is not None}

    async def admit(
        self,
        *,
        job_type: str,
        command: JobCommand,
        idempotency_key: str,
        command_hash: str,
        task_name: str,
        queue_name: str,
    ) -> Admission:
        command_json = _json(command.model_dump(by_alias=True, mode="json"))
        task_key = f"{job_type}:initial"
        async with self.pool.acquire() as connection:
            async with connection.transaction():
                row = await connection.fetchrow(
                    """
                    INSERT INTO semantic_jobs.jobs
                      (job_type, actor_user_id, model_id, workspace_id,
                       idempotency_key, command_hash, command)
                    VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
                    ON CONFLICT (actor_user_id, idempotency_key) DO NOTHING
                    RETURNING id::text, state
                    """,
                    job_type,
                    command.actor_user_id,
                    command.model_id,
                    command.workspace_id,
                    idempotency_key,
                    command_hash,
                    command_json,
                )
                if row is None:
                    existing = await connection.fetchrow(
                        """
                        SELECT id::text, state, command_hash
                        FROM semantic_jobs.jobs
                        WHERE actor_user_id = $1 AND idempotency_key = $2
                        """,
                        command.actor_user_id,
                        idempotency_key,
                    )
                    if existing is None or existing["command_hash"] != command_hash:
                        raise IdempotencyConflict("idempotency key already has a different payload")
                    return Admission(existing["id"], existing["state"], True)

                task = await connection.fetchrow(
                    """
                    INSERT INTO semantic_jobs.tasks
                      (job_id, task_key, task_name, queue_name, payload)
                    VALUES ($1::uuid, $2, $3, $4, $5::jsonb)
                    RETURNING id
                    """,
                    row["id"],
                    task_key,
                    task_name,
                    queue_name,
                    command_json,
                )
                dispatch = _json({"jobId": row["id"], "taskId": task["id"]})
                await connection.execute(
                    """
                    INSERT INTO semantic_jobs.outbox (task_id, event_type, payload)
                    VALUES ($1, 'task.dispatch', $2::jsonb)
                    """,
                    task["id"],
                    dispatch,
                )
                await connection.execute(
                    """
                    INSERT INTO semantic_jobs.events (job_id, task_id, event_type, payload)
                    VALUES ($1::uuid, $2, 'job.queued', '{}'::jsonb)
                    """,
                    row["id"],
                    task["id"],
                )
                return Admission(row["id"], row["state"], False)

    async def get_job(self, job_id: str, actor_user_id: str) -> dict[str, Any] | None:
        row = await self.pool.fetchrow(
            """
            SELECT id::text, job_type, model_id, workspace_id, state, progress,
                   result, error_code, created_at, started_at, completed_at, updated_at
            FROM semantic_jobs.jobs
            WHERE id = $1::uuid AND actor_user_id = $2
            """,
            job_id,
            actor_user_id,
        )
        if row is None:
            return None
        return {
            "jobId": row["id"],
            "jobType": row["job_type"],
            "modelId": row["model_id"],
            "workspaceId": row["workspace_id"],
            "state": row["state"],
            "progress": _object(row["progress"]),
            "result": _object(row["result"]) if row["result"] is not None else None,
            "errorCode": row["error_code"],
            "createdAt": row["created_at"],
            "startedAt": row["started_at"],
            "completedAt": row["completed_at"],
            "updatedAt": row["updated_at"],
        }

    async def list_events(
        self, job_id: str, actor_user_id: str, after: int, limit: int
    ) -> list[dict[str, Any]]:
        rows = await self.pool.fetch(
            """
            SELECT e.id, e.event_type, e.payload, e.created_at
            FROM semantic_jobs.events e
            JOIN semantic_jobs.jobs j ON j.id = e.job_id
            WHERE e.job_id = $1::uuid AND j.actor_user_id = $2 AND e.id > $3
            ORDER BY e.id
            LIMIT $4
            """,
            job_id,
            actor_user_id,
            after,
            limit,
        )
        return [
            {
                "eventId": row["id"],
                "eventType": row["event_type"],
                "payload": _object(row["payload"]),
                "createdAt": row["created_at"],
            }
            for row in rows
        ]

    async def claim_task(
        self, *, task_id: int, queue_name: str, lease_owner: str, lease_seconds: int
    ) -> Lease | None:
        async with self.pool.acquire() as connection:
            async with connection.transaction():
                row = await connection.fetchrow(
                    """
                    UPDATE semantic_jobs.tasks
                    SET state = 'running', attempt_count = attempt_count + 1,
                        lease_epoch = lease_epoch + 1, lease_owner = $2,
                        lease_expires_at = now() + make_interval(secs => $3),
                        started_at = COALESCE(started_at, now()), updated_at = now()
                    WHERE id = (
                      SELECT id FROM semantic_jobs.tasks
                      WHERE id = $4 AND queue_name = $1
                        AND (state = 'queued'
                             OR (state = 'running' AND lease_expires_at < now()))
                      ORDER BY created_at, id
                      FOR UPDATE SKIP LOCKED
                      LIMIT 1
                    )
                    RETURNING id, job_id::text, task_name, payload, lease_epoch,
                              lease_owner, lease_expires_at, attempt_count
                    """,
                    queue_name,
                    lease_owner,
                    lease_seconds,
                    task_id,
                )
                if row is None:
                    return None
                await connection.execute(
                    """
                    UPDATE semantic_jobs.jobs
                    SET state = 'running', started_at = COALESCE(started_at, now()), updated_at = now()
                    WHERE id = $1::uuid AND state IN ('queued', 'waiting_dependencies', 'running')
                    """,
                    row["job_id"],
                )
                await connection.execute(
                    """
                    INSERT INTO semantic_jobs.events (job_id, task_id, event_type, payload)
                    VALUES ($1::uuid, $2, 'task.started', jsonb_build_object('leaseEpoch', $3::bigint))
                    """,
                    row["job_id"],
                    row["id"],
                    row["lease_epoch"],
                )
                return Lease(
                    row["id"],
                    row["job_id"],
                    row["task_name"],
                    _object(row["payload"]),
                    row["lease_epoch"],
                    row["lease_owner"],
                    row["lease_expires_at"],
                    row["attempt_count"],
                )

    async def renew_lease(
        self, *, task_id: int, lease_owner: str, lease_epoch: int, lease_seconds: int
    ) -> bool:
        row = await self.pool.fetchrow(
            """
            UPDATE semantic_jobs.tasks
            SET lease_expires_at = now() + make_interval(secs => $4), updated_at = now()
            WHERE id = $1 AND lease_owner = $2 AND lease_epoch = $3
              AND state = 'running' AND lease_expires_at > now()
            RETURNING id
            """,
            task_id,
            lease_owner,
            lease_epoch,
            lease_seconds,
        )
        return row is not None

    async def checkpoint(
        self,
        *,
        task_id: int,
        lease_owner: str,
        lease_epoch: int,
        progress: dict[str, Any],
        lease_seconds: int,
    ) -> bool:
        async with self.pool.acquire() as connection:
            async with connection.transaction():
                row = await connection.fetchrow(
                    """
                    UPDATE semantic_jobs.tasks t
                    SET checkpoint = $4::jsonb,
                        lease_expires_at = now() + make_interval(secs => $5), updated_at = now()
                    WHERE t.id = $1 AND t.lease_owner = $2 AND t.lease_epoch = $3
                      AND t.state = 'running' AND t.lease_expires_at > now()
                    RETURNING t.job_id::text
                    """,
                    task_id,
                    lease_owner,
                    lease_epoch,
                    _json(progress),
                    lease_seconds,
                )
                if row is None:
                    return False
                await connection.execute(
                    "UPDATE semantic_jobs.jobs SET progress = $2::jsonb, updated_at = now() WHERE id = $1::uuid",
                    row["job_id"],
                    _json(progress),
                )
                return True

    async def complete_task(
        self,
        *,
        task_id: int,
        lease_owner: str,
        lease_epoch: int,
        job_state: str,
        result: dict[str, Any] | None,
        error_code: str | None = None,
    ) -> dict[str, Any]:
        if job_state not in ("completed", "completed_with_gaps", "failed"):
            raise ValueError("unsupported terminal job state")
        task_state = "failed" if job_state == "failed" else "completed"
        async with self.pool.acquire() as connection:
            async with connection.transaction():
                row = await connection.fetchrow(
                    """
                    UPDATE semantic_jobs.tasks
                    SET state = $4, result = $5::jsonb, error_code = $6,
                        completed_at = now(), lease_owner = NULL,
                        lease_expires_at = NULL, updated_at = now()
                    WHERE id = $1 AND lease_owner = $2 AND lease_epoch = $3
                      AND state = 'running' AND lease_expires_at > now()
                    RETURNING job_id::text
                    """,
                    task_id,
                    lease_owner,
                    lease_epoch,
                    task_state,
                    _json(result) if result is not None else None,
                    error_code,
                )
                if row is None:
                    raise StaleLease("task lease is stale or expired")
                await connection.execute(
                    """
                    UPDATE semantic_jobs.jobs
                    SET state = $2, result = $3::jsonb, error_code = $4,
                        completed_at = now(), updated_at = now()
                    WHERE id = $1::uuid
                    """,
                    row["job_id"],
                    job_state,
                    _json(result) if result is not None else None,
                    error_code,
                )
                event_type = "job.failed" if job_state == "failed" else "job.completed"
                await connection.execute(
                    """
                    INSERT INTO semantic_jobs.events (job_id, task_id, event_type, payload)
                    VALUES ($1::uuid, $2, $3, jsonb_build_object('state', $4::text))
                    """,
                    row["job_id"],
                    task_id,
                    event_type,
                    job_state,
                )
                return {"jobId": row["job_id"], "state": job_state}

    async def requeue_task(
        self,
        *,
        task_id: int,
        lease_owner: str,
        lease_epoch: int,
        error_code: str,
        retry_seconds: int,
    ) -> bool:
        """Release a live lease so the next delivery can reclaim immediately.

        Fenced on the current owner/epoch so a stale worker cannot release a
        task another worker now owns. The outbox row is deliberately left
        published, and its ``published_at`` is set to the moment the scheduled
        retry is expected to arrive (``now() + retry_seconds``). The recovery
        grace clock therefore starts after the Celery retry, so recovery can
        never republish ahead of an already-scheduled delivery, and a task that
        ran longer than the grace window is not mistaken for never claimed.
        """
        async with self.pool.acquire() as connection:
            async with connection.transaction():
                row = await connection.fetchrow(
                    """
                    UPDATE semantic_jobs.tasks
                    SET state = 'queued', lease_owner = NULL, lease_expires_at = NULL,
                        error_code = $4, updated_at = now()
                    WHERE id = $1 AND state = 'running'
                      AND lease_owner = $2 AND lease_epoch = $3
                      AND lease_expires_at > now()
                    RETURNING id
                    """,
                    task_id,
                    lease_owner,
                    lease_epoch,
                    error_code[:100],
                )
                if row is None:
                    return False
                await connection.execute(
                    """
                    UPDATE semantic_jobs.outbox
                    SET published_at = now() + make_interval(secs => $3),
                        claim_owner = NULL, claim_expires_at = NULL,
                        last_error_code = $2
                    WHERE task_id = $1 AND event_type = 'task.dispatch'
                      AND published_at IS NOT NULL
                    """,
                    task_id,
                    error_code[:100],
                    retry_seconds,
                )
                return True

    async def recover_stalled_tasks(
        self,
        *,
        max_attempts: int,
        retry_seconds: int,
        grace_seconds: int,
        batch: int = 50,
    ) -> dict[str, int]:
        """Backstop for delivery lost without a worker finishing (P2.6).

        Two classes under ``FOR UPDATE SKIP LOCKED`` so concurrent API
        replicas and dispatcher instances never recover the same task twice:

        - **Expired running lease** — a worker claimed the task and then died.
          Bounded by the task attempt count, which only real claims increment,
          so queue latency can never exhaust a task no worker attempted. Past
          the cap the task and job are fenced to ``failed``.
        - **Published but never claimed** — the worker failed before the claim
          or the broker dropped the delivery. Only considered stalled after
          ``grace_seconds``; it is republished with capped backoff and is
          **never** marked failed, so a healthy-but-backlogged queue cannot
          terminate a job.
        """
        async with self.pool.acquire() as connection:
            async with connection.transaction():
                expired = await connection.fetch(
                    """
                    SELECT id, attempt_count
                    FROM semantic_jobs.tasks
                    WHERE state = 'running' AND lease_expires_at < now()
                    ORDER BY lease_expires_at, id
                    FOR UPDATE SKIP LOCKED
                    LIMIT $1
                    """,
                    batch,
                )
                stalled = await connection.fetch(
                    """
                    SELECT t.id, o.attempt_count AS dispatch_count
                    FROM semantic_jobs.tasks t
                    JOIN semantic_jobs.outbox o
                      ON o.task_id = t.id AND o.event_type = 'task.dispatch'
                    WHERE t.state = 'queued'
                      AND o.published_at IS NOT NULL
                      AND o.published_at < now() - make_interval(secs => $1)
                      AND (o.claim_expires_at IS NULL OR o.claim_expires_at < now())
                    ORDER BY o.published_at, t.id
                    FOR UPDATE OF t, o SKIP LOCKED
                    LIMIT $2
                    """,
                    grace_seconds,
                    batch,
                )

                give_up = [row["id"] for row in expired if row["attempt_count"] > max_attempts]
                requeue_running = [row["id"] for row in expired
                                   if row["attempt_count"] <= max_attempts]

                exhausted = 0
                if give_up:
                    rows = await connection.fetch(
                        """
                        UPDATE semantic_jobs.tasks
                        SET state = 'failed', error_code = 'attempts_exhausted',
                            completed_at = now(), lease_owner = NULL,
                            lease_expires_at = NULL, updated_at = now()
                        WHERE id = ANY($1::bigint[]) AND state = 'running'
                        RETURNING id, job_id::text
                        """,
                        give_up,
                    )
                    exhausted = len(rows)
                    for row in rows:
                        await connection.execute(
                            """
                            UPDATE semantic_jobs.jobs
                            SET state = 'failed', error_code = 'attempts_exhausted',
                                completed_at = now(), updated_at = now()
                            WHERE id = $1::uuid
                              AND state IN ('queued', 'waiting_dependencies', 'running',
                                            'cancel_requested')
                            """,
                            row["job_id"],
                        )
                        await connection.execute(
                            """
                            INSERT INTO semantic_jobs.events (job_id, task_id, event_type, payload)
                            VALUES ($1::uuid, $2, 'job.failed',
                                    jsonb_build_object('reason', 'attempts_exhausted'))
                            """,
                            row["job_id"],
                            row["id"],
                        )

                if requeue_running:
                    await connection.execute(
                        """
                        UPDATE semantic_jobs.tasks
                        SET state = 'queued', lease_owner = NULL, lease_expires_at = NULL,
                            updated_at = now()
                        WHERE id = ANY($1::bigint[]) AND state = 'running'
                        """,
                        requeue_running,
                    )
                # A dead worker also loses its broker requeue, so these are
                # republished promptly rather than waiting for a delivery.
                if requeue_running:
                    await connection.execute(
                        """
                        UPDATE semantic_jobs.outbox
                        SET published_at = NULL, claim_owner = NULL, claim_expires_at = NULL,
                            next_attempt_at = now(), last_error_code = 'lease_expired'
                        WHERE event_type = 'task.dispatch' AND task_id = ANY($1::bigint[])
                        """,
                        requeue_running,
                    )

                # Lost deliveries: republish with capped backoff, never fail.
                republished = 0
                for row in stalled:
                    await connection.execute(
                        """
                        UPDATE semantic_jobs.outbox
                        SET published_at = NULL, claim_owner = NULL, claim_expires_at = NULL,
                            next_attempt_at = now() + make_interval(secs => $2),
                            last_error_code = 'delivery_not_claimed'
                        WHERE task_id = $1 AND event_type = 'task.dispatch'
                        """,
                        row["id"],
                        backoff_seconds(retry_seconds, row["dispatch_count"]),
                    )
                    republished += 1

                return {"exhausted": exhausted, "requeued": len(requeue_running) + republished}

    async def claim_outbox(
        self, *, claim_owner: str, claim_seconds: int
    ) -> OutboxItem | None:
        row = await self.pool.fetchrow(
            """
            UPDATE semantic_jobs.outbox o
            SET claim_owner = $1,
                claim_expires_at = now() + make_interval(secs => $2),
                attempt_count = attempt_count + 1
            WHERE o.id = (
              SELECT id FROM semantic_jobs.outbox
              WHERE published_at IS NULL AND next_attempt_at <= now()
                AND (claim_expires_at IS NULL OR claim_expires_at < now())
              ORDER BY id
              FOR UPDATE SKIP LOCKED
              LIMIT 1
            )
            RETURNING o.id, o.task_id, o.payload
            """,
            claim_owner,
            claim_seconds,
        )
        if row is None:
            return None
        task = await self.pool.fetchrow(
            "SELECT task_name, queue_name FROM semantic_jobs.tasks WHERE id = $1",
            row["task_id"],
        )
        if task is None:
            return None
        return OutboxItem(
            row["id"], row["task_id"], task["task_name"], task["queue_name"],
            _object(row["payload"]), claim_owner,
        )

    async def mark_outbox_published(self, outbox_id: int, claim_owner: str) -> bool:
        row = await self.pool.fetchrow(
            """
            UPDATE semantic_jobs.outbox
            SET published_at = now(), claim_owner = NULL, claim_expires_at = NULL,
                last_error_code = NULL
            WHERE id = $1 AND claim_owner = $2 AND claim_expires_at > now()
              AND published_at IS NULL
            RETURNING id
            """,
            outbox_id,
            claim_owner,
        )
        return row is not None

    async def release_outbox(
        self, outbox_id: int, claim_owner: str, error_code: str, retry_seconds: int
    ) -> bool:
        row = await self.pool.fetchrow(
            """
            UPDATE semantic_jobs.outbox
            SET claim_owner = NULL, claim_expires_at = NULL,
                next_attempt_at = now() + make_interval(secs => $4),
                last_error_code = $3
            WHERE id = $1 AND claim_owner = $2 AND published_at IS NULL
            RETURNING id
            """,
            outbox_id,
            claim_owner,
            error_code,
            retry_seconds,
        )
        return row is not None
