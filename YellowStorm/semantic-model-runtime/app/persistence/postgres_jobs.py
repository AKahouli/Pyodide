from __future__ import annotations

import hashlib
import json
import os
from typing import Any

import asyncpg

from app.datasource.discovery import parser_fingerprint
from app.datasource.email_archive import resolve_column
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
from app.persistence.ui_signal_outbox import enqueue_ui_signal

TERMINAL_JOB_STATES = {
    "completed", "completed_with_gaps", "failed", "cancelled", "superseded",
}


def _json(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"), sort_keys=True)


def _object(value: Any) -> dict[str, Any]:
    if isinstance(value, str):
        value = json.loads(value)
    return value if isinstance(value, dict) else {}


def _fingerprint(value: Any) -> str:
    body = json.dumps(value, separators=(",", ":"), sort_keys=True)
    return f"sha256:{hashlib.sha256(body.encode()).hexdigest()}"


class PostgresJobRepository:
    """Parameterized PostgreSQL repository for P2.4 durable execution."""

    def __init__(self, pool: asyncpg.Pool):
        self.pool = pool
        self.realtime_enabled = os.environ.get("SEMANTIC_MODEL_REALTIME_ENABLED") == "true"

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
                if applied is not None:
                    await connection.execute(
                        """
                        INSERT INTO semantic_datasource.mapping_health
                          (model_id, mapping_id, mapping_version, state, warnings)
                        SELECT m.model_id, m.id,
                          'sha256:' || encode(digest(m.updated_at::text || m.field_mappings::text, 'sha256'), 'hex'),
                          CASE WHEN $3 THEN 'unavailable' ELSE 'checking' END,
                          jsonb_build_array(jsonb_build_object('code', 'source_observation_changed'))
                        FROM semantic_model.source_mappings m
                        -- A workspace key names a whole workspace, never one file that could change.
                        WHERE m.workspace_id=$1 AND m.document_id=$2
                          AND m.document_id NOT LIKE 'workspace:%'
                        ON CONFLICT (model_id, mapping_id) DO UPDATE SET
                          state=EXCLUDED.state, missing_fields='[]'::jsonb,
                          available_fields='[]'::jsonb,
                          warnings=EXCLUDED.warnings, checked_at=now()
                        """,
                        workspace_id, asset_id,
                        event.event_type == "workspace.document.deleted.v1",
                    )
                    if not payload.get("deleted") and event.event_type != "workspace.document.deleted.v1":
                        await self._enqueue_event_discovery(connection, event, payload)
                if self.realtime_enabled and applied is not None:
                    models = await connection.fetch(
                        """
                        SELECT DISTINCT model_id::text
                        FROM semantic_model.source_mappings
                        WHERE workspace_id = $1 AND (document_id = $2 OR scope = 'workspace')
                        """,
                        workspace_id, asset_id,
                    )
                    for model in models:
                        await enqueue_ui_signal(
                            connection, model_id=model["model_id"],
                            event_type="datasource-status-changed", resource=asset_id,
                            payload={"resource": asset_id, "status": event.event_type,
                                     "reason": "source_observation_changed"},
                        )
                return {"revision": revision, "reused": False, "headAdvanced": applied is not None}

    async def _enqueue_event_discovery(
        self, connection: asyncpg.Connection, event: SourceEvent, payload: dict[str, Any]
    ) -> None:
        actor = payload.get("createdBy")
        mime = payload.get("mimeType")
        if not isinstance(actor, str) or not actor or not isinstance(mime, str):
            return
        source = {
            "workspaceId": event.payload.workspace_id,
            "assetId": event.payload.document_id,
            "originalName": payload.get("originalName"),
            "mimeType": mime,
            "sizeBytes": payload.get("sizeBytes"),
            "contentHash": payload.get("contentHash"),
            "uploadedAt": payload.get("uploadedAt") or event.occurred_at.isoformat(),
            "indexingStatus": payload.get("indexingStatus"),
            "sourceEventId": event.event_id,
        }
        updated_at = payload.get("updatedAt")
        size = payload.get("sizeBytes")
        source["sourceVersion"] = (payload.get("contentHash") or
                                   (f"{updated_at}:{size}" if updated_at and isinstance(size, int)
                                    else None))
        sheets = await connection.fetch(
            """
            SELECT DISTINCT sheet_name
            FROM semantic_model.source_mappings
            WHERE workspace_id=$1 AND document_id=$2
            """,
            event.payload.workspace_id, event.payload.document_id,
        )
        for row in sheets:
            sheet_name = row["sheet_name"]
            options = {"sheetName": sheet_name} if sheet_name else {}
            command = {"actorUserId": actor, "modelId": None,
                       "workspaceId": event.payload.workspace_id,
                       "payload": {"source": source, "options": options}}
            command_json = _json(command)
            command_hash = _fingerprint(command)
            idempotency_key = f"source-event:{_fingerprint({'eventId': event.event_id, 'sheet': sheet_name})}"
            job = await connection.fetchrow(
                """
                INSERT INTO semantic_jobs.jobs
                  (job_type, actor_user_id, workspace_id, idempotency_key, command_hash, command)
                VALUES ('datasource.discovery', $1, $2, $3, $4, $5::jsonb)
                ON CONFLICT (actor_user_id, idempotency_key) DO NOTHING
                RETURNING id::text
                """,
                actor, event.payload.workspace_id, idempotency_key, command_hash, command_json,
            )
            if job is None:
                continue
            task = await connection.fetchrow(
                """
                INSERT INTO semantic_jobs.tasks (job_id, task_key, task_name, queue_name, payload)
                VALUES ($1::uuid, 'datasource.discovery:initial',
                        'semantic-model-datasource.discover', 'semantic-model-datasource.batch', $2::jsonb)
                RETURNING id
                """,
                job["id"], command_json,
            )
            await connection.execute(
                """
                INSERT INTO semantic_jobs.outbox (task_id, event_type, payload)
                VALUES ($1, 'task.dispatch', jsonb_build_object('jobId', $2::text, 'taskId', $1::bigint))
                """,
                task["id"], job["id"],
            )
            await connection.execute(
                "INSERT INTO semantic_jobs.events (job_id, task_id, event_type) VALUES ($1::uuid, $2, 'job.queued')",
                job["id"], task["id"],
            )

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
        effective_key = idempotency_key
        async with self.pool.acquire() as connection:
            async with connection.transaction():
                while True:
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
                        effective_key,
                        command_hash,
                        command_json,
                    )
                    if row is not None:
                        break
                    existing = await connection.fetchrow(
                        """
                        SELECT id::text, state, command_hash, result
                        FROM semantic_jobs.jobs
                        WHERE actor_user_id = $1 AND idempotency_key = $2
                        """,
                        command.actor_user_id,
                        effective_key,
                    )
                    if existing is None or existing["command_hash"] != command_hash:
                        raise IdempotencyConflict("idempotency key already has a different payload")
                    # A failed discovery is retried too: handing back the failure would leave the
                    # file unreadable until its content changes, even once the cause is fixed.
                    if (job_type in ("population.run", "datasource.discovery")
                            and existing["state"] in ("failed", "cancelled")):
                        # A retry of a terminal failure or a stopped run needs a fresh durable job,
                        # while concurrent retries must converge on the same one.
                        effective_key = hashlib.sha256(
                            f"{idempotency_key}:{existing['id']}".encode()
                        ).hexdigest()
                        continue
                    if (job_type == "datasource.discovery"
                            and effective_key == idempotency_key
                            and existing["state"] in TERMINAL_JOB_STATES):
                        result = _object(existing["result"])
                        profile = result.get("profile")
                        options = command.payload.get("options", {})
                        current_parser = parser_fingerprint(
                            options if isinstance(options, dict) else {})
                        if (not isinstance(profile, dict)
                                or profile.get("parserFingerprint") != current_parser):
                            effective_key = f"{idempotency_key}:parser:{current_parser}"
                            continue
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

    async def list_jobs(
        self, *, actor_user_id: str, model_id: str, job_type: str, limit: int
    ) -> list[dict[str, Any]]:
        """The actor's latest jobs of this type for the model, newest first."""
        rows = await self.pool.fetch(
            """
            SELECT id::text FROM semantic_jobs.jobs
            WHERE actor_user_id = $1 AND model_id = $2 AND job_type = $3
            ORDER BY created_at DESC
            LIMIT $4
            """,
            actor_user_id,
            model_id,
            job_type,
            limit,
        )
        jobs = [await self.get_job(row["id"], actor_user_id) for row in rows]
        return [job for job in jobs if job is not None]

    async def find_active_job(
        self, *, actor_user_id: str, model_id: str, job_type: str
    ) -> dict[str, Any] | None:
        """The actor's latest job of this type for the model that has not ended yet."""
        job_id = await self.pool.fetchval(
            """
            SELECT id::text FROM semantic_jobs.jobs
            WHERE actor_user_id = $1 AND model_id = $2 AND job_type = $3
              AND state IN ('queued', 'waiting_dependencies', 'running', 'cancel_requested')
            ORDER BY created_at DESC
            LIMIT 1
            """,
            actor_user_id,
            model_id,
            job_type,
        )
        return await self.get_job(job_id, actor_user_id) if job_id else None

    async def request_cancel(self, job_id: str, actor_user_id: str) -> dict[str, Any] | None:
        """Stop a job. One that has not started ends at once; a running one is asked to stop
        and its worker ends it at its next progress report, keeping nothing it read."""
        async with self.pool.acquire() as connection:
            async with connection.transaction():
                job = await connection.fetchrow(
                    """
                    SELECT id::text, state FROM semantic_jobs.jobs
                    WHERE id = $1::uuid AND actor_user_id = $2
                    FOR UPDATE
                    """,
                    job_id,
                    actor_user_id,
                )
                if job is None:
                    return None
                if job["state"] not in TERMINAL_JOB_STATES and job["state"] != "cancel_requested":
                    running = await connection.fetchval(
                        "SELECT count(*) FROM semantic_jobs.tasks WHERE job_id = $1::uuid AND state = 'running'",
                        job_id,
                    )
                    if running:
                        await connection.execute(
                            """
                            UPDATE semantic_jobs.jobs SET state = 'cancel_requested', updated_at = now()
                            WHERE id = $1::uuid
                            """,
                            job_id,
                        )
                        await connection.execute(
                            """
                            INSERT INTO semantic_jobs.events (job_id, event_type, payload)
                            VALUES ($1::uuid, 'job.cancel_requested', '{}'::jsonb)
                            """,
                            job_id,
                        )
                    else:
                        await connection.execute(
                            """
                            UPDATE semantic_jobs.tasks
                            SET state = 'cancelled', completed_at = now(), updated_at = now()
                            WHERE job_id = $1::uuid AND state = 'queued'
                            """,
                            job_id,
                        )
                        await self._finish_cancelled(connection, job_id, None)
        return await self.get_job(job_id, actor_user_id)

    async def cancel_requested(self, job_id: str) -> bool:
        return await self.pool.fetchval(
            "SELECT state = 'cancel_requested' FROM semantic_jobs.jobs WHERE id = $1::uuid", job_id
        ) is True

    async def cancel_task(self, *, task_id: int, lease_owner: str, lease_epoch: int) -> dict[str, Any]:
        """End a running task whose job was asked to stop, while still holding its lease."""
        async with self.pool.acquire() as connection:
            async with connection.transaction():
                row = await connection.fetchrow(
                    """
                    UPDATE semantic_jobs.tasks
                    SET state = 'cancelled', completed_at = now(), lease_owner = NULL,
                        lease_expires_at = NULL, updated_at = now()
                    WHERE id = $1 AND lease_owner = $2 AND lease_epoch = $3
                      AND state = 'running' AND lease_expires_at > now()
                    RETURNING job_id::text
                    """,
                    task_id,
                    lease_owner,
                    lease_epoch,
                )
                if row is None:
                    raise StaleLease("task lease is stale or expired")
                await self._finish_cancelled(connection, row["job_id"], task_id)
                return {"jobId": row["job_id"], "state": "cancelled"}

    async def _finish_cancelled(self, connection: Any, job_id: str, task_id: int | None) -> None:
        job = await connection.fetchrow(
            """
            UPDATE semantic_jobs.jobs
            SET state = 'cancelled', error_code = 'cancelled', completed_at = now(), updated_at = now()
            WHERE id = $1::uuid AND state NOT IN ('completed', 'completed_with_gaps', 'failed',
                                                  'cancelled', 'superseded')
            RETURNING model_id
            """,
            job_id,
        )
        if job is None:
            return
        await connection.execute(
            """
            INSERT INTO semantic_jobs.events (job_id, task_id, event_type, payload)
            VALUES ($1::uuid, $2, 'job.cancelled', jsonb_build_object('state', 'cancelled'))
            """,
            job_id,
            task_id,
        )
        if self.realtime_enabled and job["model_id"]:
            await enqueue_ui_signal(
                connection, model_id=job["model_id"], event_type="population-status-changed",
                resource=job_id, payload={"resource": job_id, "status": "cancelled", "reason": "job_terminal"},
            )

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
                        AND NOT EXISTS (SELECT 1 FROM semantic_jobs.jobs j
                                        WHERE j.id = semantic_jobs.tasks.job_id
                                          AND j.state IN ('cancel_requested', 'cancelled'))
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
                affected_models: dict[str, str] = {}
                if task_state == "completed" and result is not None:
                    affected_models = await self._persist_datasource_result(
                        connection, row["job_id"], result)
                elif task_state == "failed":
                    affected_models = await self._persist_datasource_failure(
                        connection, row["job_id"], error_code)
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
                if self.realtime_enabled:
                    job = await connection.fetchrow(
                        "SELECT job_type, model_id::text FROM semantic_jobs.jobs WHERE id = $1::uuid",
                        row["job_id"],
                    )
                    if job is not None and job["model_id"]:
                        signal_type = ("datasource-status-changed"
                                       if job["job_type"].startswith("datasource.")
                                       else "population-status-changed")
                        await enqueue_ui_signal(
                            connection, model_id=job["model_id"], event_type=signal_type,
                            resource=row["job_id"],
                            payload={"resource": row["job_id"], "status": job_state,
                                     "reason": "job_terminal"},
                        )
                    for model_id, asset_id in affected_models.items():
                        if job is not None and model_id == job["model_id"]:
                            continue
                        await enqueue_ui_signal(
                            connection, model_id=model_id,
                            event_type="datasource-status-changed", resource=asset_id,
                            payload={"resource": asset_id, "status": job_state,
                                     "reason": "mapping_health_recomputed"},
                        )
                return {"jobId": row["job_id"], "state": job_state}

    async def _persist_datasource_result(
        self, connection: asyncpg.Connection, job_id: str, result: dict[str, Any]
    ) -> dict[str, str]:
        job = await connection.fetchrow(
            "SELECT job_type, command FROM semantic_jobs.jobs WHERE id = $1::uuid",
            job_id,
        )
        if job is None or job["job_type"] != "datasource.discovery":
            return {}
        command = _object(job["command"])
        payload = command.get("payload")
        source = payload.get("source") if isinstance(payload, dict) else None
        profile = result.get("profile")
        if not isinstance(source, dict) or not isinstance(profile, dict):
            return {}
        await connection.execute(
            "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
            f"{source.get('workspaceId')}:{source.get('assetId')}",
        )
        asset_ref = profile.get("assetRef")
        if not isinstance(asset_ref, dict):
            return {}
        options = payload.get("options") if isinstance(payload.get("options"), dict) else {}
        stored_profile = {**profile}
        for key in ("fieldProfiles", "contentFingerprint", "scannedRows"):
            if key in result:
                stored_profile[key] = result[key]
        await connection.execute(
            """
            INSERT INTO semantic_datasource.discovery_profiles
              (id, workspace_id, asset_id, source_fingerprint, source_version,
               parser_version, options_fingerprint, status, profile, preview)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb)
            ON CONFLICT (workspace_id, asset_id, source_fingerprint, options_fingerprint)
            DO UPDATE SET id=EXCLUDED.id, source_version=EXCLUDED.source_version,
              parser_version=EXCLUDED.parser_version, status=EXCLUDED.status,
              profile=EXCLUDED.profile, preview=EXCLUDED.preview, completed_at=now()
            """,
            profile.get("profileId"), asset_ref.get("workspaceId"), asset_ref.get("assetId"),
            asset_ref.get("assetVersionId"), source.get("sourceVersion"),
            profile.get("parserFingerprint"), _fingerprint(options), profile.get("status"),
            _json(stored_profile), _json(result.get("mappingPreview"))
            if isinstance(result.get("mappingPreview"), dict) else None,
        )
        if not await self._source_observation_is_current(connection, source):
            return {}
        model_ids = await self._recompute_mapping_health(
            connection, asset_ref, source.get("sourceVersion"), stored_profile
        )
        asset_id = asset_ref.get("assetId")
        return {model_id: asset_id for model_id in model_ids if isinstance(asset_id, str)}

    async def _persist_datasource_failure(
        self, connection: asyncpg.Connection, job_id: str, error_code: str | None
    ) -> dict[str, str]:
        job = await connection.fetchrow(
            "SELECT job_type, command FROM semantic_jobs.jobs WHERE id = $1::uuid", job_id)
        if job is None or job["job_type"] != "datasource.discovery":
            return {}
        command = _object(job["command"])
        payload = command.get("payload")
        source = payload.get("source") if isinstance(payload, dict) else None
        options = payload.get("options") if isinstance(payload, dict) else None
        if not isinstance(source, dict):
            return {}
        await connection.execute(
            "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
            f"{source.get('workspaceId')}:{source.get('assetId')}",
        )
        if not await self._source_observation_is_current(connection, source):
            return {}
        sheet_name = options.get("sheetName", "") if isinstance(options, dict) else ""
        rows = await connection.fetch(
            """
            INSERT INTO semantic_datasource.mapping_health
              (model_id, mapping_id, mapping_version, state, warnings)
            SELECT m.model_id, m.id,
              'sha256:' || encode(digest(m.updated_at::text || m.field_mappings::text, 'sha256'), 'hex'),
              'unavailable', jsonb_build_array(jsonb_build_object('code', $4::text))
            FROM semantic_model.source_mappings m
            WHERE m.workspace_id=$1 AND m.document_id=$2 AND m.sheet_name=$3
            ON CONFLICT (model_id, mapping_id) DO UPDATE SET
              mapping_version=EXCLUDED.mapping_version, state=EXCLUDED.state,
              missing_fields='[]'::jsonb, available_fields='[]'::jsonb,
              warnings=EXCLUDED.warnings, checked_at=now()
            RETURNING model_id::text
            """,
            source.get("workspaceId"), source.get("assetId"), sheet_name,
            error_code or "discovery_failed",
        )
        asset_id = source.get("assetId")
        return {row["model_id"]: asset_id for row in rows if isinstance(asset_id, str)}

    async def _source_observation_is_current(
        self, connection: asyncpg.Connection, source: dict[str, Any]
    ) -> bool:
        head = await connection.fetchrow(
            """
            SELECT event_id, payload, deleted
            FROM semantic_jobs.source_heads
            WHERE workspace_id=$1 AND asset_id=$2
            """,
            source.get("workspaceId"), source.get("assetId"),
        )
        if head is None:
            return True
        if head["deleted"]:
            return False
        source_event_id = source.get("sourceEventId")
        if isinstance(source_event_id, str):
            return source_event_id == head["event_id"]
        payload = _object(head["payload"])
        current_version = payload.get("contentHash")
        if not current_version:
            updated_at = payload.get("updatedAt")
            size = payload.get("sizeBytes")
            current_version = (
                f"{updated_at}:{size}"
                if updated_at and isinstance(size, int)
                else None
            )
        expected_version = source.get("sourceVersion")
        return (
            not isinstance(current_version, str)
            or not isinstance(expected_version, str)
            or current_version == expected_version
        )

    async def _recompute_mapping_health(
        self, connection: asyncpg.Connection, asset_ref: dict[str, Any],
        source_version: Any, profile: dict[str, Any]
    ) -> set[str]:
        available = [field.get("name") for field in profile.get("fieldProfiles", [])
                     if isinstance(field, dict) and isinstance(field.get("name"), str)]
        structure = profile.get("structure") if isinstance(profile.get("structure"), dict) else {}
        selected_sheet = structure.get("selectedSheet")
        if structure.get("kind") == "csv":
            selected_sheet = "CSV"
        selected_sheet = selected_sheet if isinstance(selected_sheet, str) else ""
        rows = await connection.fetch(
            """
            SELECT m.id::text, m.model_id::text, m.field_mappings,
                   m.validated_source_version, COALESCE(w.enabled, false) AS source_enabled,
                   m.updated_at
            FROM semantic_model.source_mappings m
            LEFT JOIN semantic_model.workspace_links w
              ON w.model_id=m.model_id AND w.workspace_id=m.workspace_id
            WHERE m.workspace_id=$1 AND m.document_id=$2 AND m.sheet_name=$3
            """,
            asset_ref.get("workspaceId"), asset_ref.get("assetId"), selected_sheet,
        )
        available_set = set(available)
        model_ids: set[str] = set()
        for row in rows:
            model_ids.add(row["model_id"])
            mappings = row["field_mappings"]
            if isinstance(mappings, str):
                mappings = json.loads(mappings)
            required = [item.get("sourceField") for item in mappings or []
                        if isinstance(item, dict) and item.get("mode") == "direct"
                        and isinstance(item.get("sourceField"), str)]
            missing = [field for field in required
                       if resolve_column(field, available_set) not in available_set]
            if not row["source_enabled"]:
                state = "unavailable"
            elif missing:
                state = "broken"
            elif source_version and source_version == row["validated_source_version"]:
                state = "healthy"
            else:
                state = "changed"
            mapping_version = _fingerprint({"updatedAt": row["updated_at"].isoformat(),
                                            "fields": mappings})
            await connection.execute(
                """
                INSERT INTO semantic_datasource.mapping_health
                  (model_id, mapping_id, source_fingerprint, mapping_version, state,
                   missing_fields, available_fields, warnings)
                VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb)
                ON CONFLICT (model_id, mapping_id) DO UPDATE SET
                  source_fingerprint=EXCLUDED.source_fingerprint,
                  mapping_version=EXCLUDED.mapping_version, state=EXCLUDED.state,
                  missing_fields=EXCLUDED.missing_fields,
                  available_fields=EXCLUDED.available_fields,
                  warnings=EXCLUDED.warnings, checked_at=now()
                """,
                row["model_id"], row["id"], asset_ref.get("assetVersionId"), mapping_version,
                state, _json(missing), _json(available), _json(profile.get("warnings", [])),
            )
        return model_ids

    async def get_cached_discovery_profile(
        self, command: dict[str, Any], source_fingerprint: str, parser_version: str
    ) -> dict[str, Any] | None:
        payload = command.get("payload") if isinstance(command, dict) else None
        source = payload.get("source") if isinstance(payload, dict) else None
        if not isinstance(source, dict):
            return None
        options = payload.get("options") if isinstance(payload.get("options"), dict) else {}
        row = await self.pool.fetchrow(
            """
            SELECT profile
            FROM semantic_datasource.discovery_profiles
            WHERE workspace_id=$1 AND asset_id=$2 AND source_fingerprint=$3
              AND options_fingerprint=$4 AND parser_version=$5
              AND source_version IS NOT DISTINCT FROM $6
              -- "Indexing required" depends on the index, not on the file: read the file again.
              AND profile->>'status' IS DISTINCT FROM 'indexing_required'
            ORDER BY completed_at DESC LIMIT 1
            """,
            source.get("workspaceId"), source.get("assetId"), source_fingerprint,
            _fingerprint(options), parser_version, source.get("sourceVersion"),
        )
        return _object(row["profile"]) if row is not None else None

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

    async def release_abandoned_leases(self, *, node_prefix: str, boot_prefix: str) -> int:
        """Expire the leases a worker node held before it restarted.

        Lease owners are ``<node_prefix><boot id>:<run id>``; a node that starts again
        gets a new boot id, so any lease of the node under another boot id belongs to a
        process that is gone. Expired now, recovery ends a run asked to stop and requeues
        the others at once instead of waiting for the lease to run out.
        """
        result = await self.pool.execute(
            """
            UPDATE semantic_jobs.tasks
            SET lease_expires_at = now() - interval '1 second', updated_at = now()
            WHERE state = 'running' AND lease_expires_at > now()
              AND starts_with(lease_owner, $1) AND NOT starts_with(lease_owner, $2)
            """,
            node_prefix,
            boot_prefix,
        )
        return int(result.split()[-1]) if result else 0

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
                    SELECT t.id, t.attempt_count, t.job_id::text AS job_id,
                           j.state = 'cancel_requested' AS stopping
                    FROM semantic_jobs.tasks t
                    JOIN semantic_jobs.jobs j ON j.id = t.job_id
                    WHERE t.state = 'running' AND t.lease_expires_at < now()
                    ORDER BY t.lease_expires_at, t.id
                    FOR UPDATE OF t SKIP LOCKED
                    LIMIT $1
                    """,
                    batch,
                )
                stopped = [row for row in expired if row["stopping"]]
                for row in stopped:
                    await connection.execute(
                        """
                        UPDATE semantic_jobs.tasks
                        SET state = 'cancelled', completed_at = now(), lease_owner = NULL,
                            lease_expires_at = NULL, updated_at = now()
                        WHERE id = $1 AND state = 'running'
                        """,
                        row["id"],
                    )
                    await self._finish_cancelled(connection, row["job_id"], row["id"])
                expired = [row for row in expired if not row["stopping"]]
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
