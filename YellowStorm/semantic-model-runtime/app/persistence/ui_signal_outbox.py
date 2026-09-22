from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any


ALLOWED_EVENTS = {
    "data-revision-changed",
    "datasource-status-changed",
    "review-items-changed",
    "population-status-changed",
    "model-read-state-changed",
}
ALLOWED_PAYLOAD_KEYS = {"modelId", "dataRevision", "resource", "status", "reason"}


@dataclass(frozen=True)
class UiSignal:
    id: int
    model_id: str
    event_type: str
    payload: dict[str, Any]
    attempt_count: int


def _json(value: dict[str, Any]) -> str:
    return json.dumps(value, separators=(",", ":"), sort_keys=True)


def safe_payload(model_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    sanitized = {key: value for key, value in payload.items() if key in ALLOWED_PAYLOAD_KEYS}
    sanitized["modelId"] = model_id
    return sanitized


async def enqueue_ui_signal(connection: Any, *, model_id: str, event_type: str,
                            resource: str | None = None,
                            payload: dict[str, Any] | None = None) -> int:
    if event_type not in ALLOWED_EVENTS:
        raise ValueError("unsupported_ui_signal")
    body = safe_payload(model_id, payload or {})
    key = f"{model_id}:{event_type}:{resource or ''}"
    await connection.execute("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", key)
    row = await connection.fetchrow(
        """
        UPDATE semantic_jobs.ui_signal_outbox
        SET payload = $4::jsonb, available_at = now(), updated_at = now(), last_error = NULL
        WHERE id = (
          SELECT id FROM semantic_jobs.ui_signal_outbox
          WHERE model_id = $1::uuid AND event_type = $2
            AND resource IS NOT DISTINCT FROM $3 AND status = 'pending'
            AND claim_owner IS NULL
          ORDER BY id DESC LIMIT 1
        )
        RETURNING id
        """,
        model_id, event_type, resource, _json(body),
    )
    if row is None:
        row = await connection.fetchrow(
            """
            INSERT INTO semantic_jobs.ui_signal_outbox
              (model_id, event_type, resource, payload)
            VALUES ($1::uuid, $2, $3, $4::jsonb)
            RETURNING id
            """,
            model_id, event_type, resource, _json(body),
        )
    return int(row["id"])


class UiSignalOutboxRepository:
    def __init__(self, pool: Any):
        self.pool = pool

    async def claim(self, *, claim_owner: str, claim_seconds: int,
                    batch_size: int) -> list[UiSignal]:
        rows = await self.pool.fetch(
            """
            UPDATE semantic_jobs.ui_signal_outbox signal
            SET status = 'publishing', claim_owner = $1,
                claim_until = now() + make_interval(secs => $2),
                attempt_count = attempt_count + 1, updated_at = now()
            WHERE signal.id IN (
              SELECT id FROM semantic_jobs.ui_signal_outbox
              WHERE status IN ('pending', 'publishing') AND available_at <= now()
                AND (claim_until IS NULL OR claim_until < now())
              ORDER BY available_at, id FOR UPDATE SKIP LOCKED LIMIT $3
            )
            RETURNING id, model_id::text, event_type, payload, attempt_count
            """,
            claim_owner, claim_seconds, batch_size,
        )
        return [UiSignal(row["id"], row["model_id"], row["event_type"],
                         dict(row["payload"]) if not isinstance(row["payload"], str)
                         else json.loads(row["payload"]), row["attempt_count"])
                for row in rows]

    async def mark_published(self, signal_id: int, claim_owner: str) -> bool:
        row = await self.pool.fetchrow(
            """
            UPDATE semantic_jobs.ui_signal_outbox
            SET status = 'published', published_at = now(), claim_owner = NULL,
                claim_until = NULL, last_error = NULL, updated_at = now()
            WHERE id = $1 AND claim_owner = $2 AND claim_until > now()
              AND status = 'publishing' RETURNING id
            """,
            signal_id, claim_owner,
        )
        return row is not None

    async def release(self, signal_id: int, claim_owner: str, *, error: str,
                      retry_seconds: int, max_attempts: int) -> bool:
        row = await self.pool.fetchrow(
            """
            UPDATE semantic_jobs.ui_signal_outbox
            SET status = CASE WHEN attempt_count >= $5 THEN 'failed' ELSE 'pending' END,
                available_at = now() + make_interval(secs => $4),
                claim_owner = NULL, claim_until = NULL, last_error = $3, updated_at = now()
            WHERE id = $1 AND claim_owner = $2 AND status = 'publishing'
            RETURNING id
            """,
            signal_id, claim_owner, error[:200], retry_seconds, max_attempts,
        )
        return row is not None
