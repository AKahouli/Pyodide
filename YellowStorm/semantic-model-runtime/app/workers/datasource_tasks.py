"""Datasource worker entry point (Phase 3).

Heavy parser libraries stay lazily imported inside task bodies, so importing
the API never initializes them (see ``test_api_skeleton``). The Celery task
claims the durable ``semantic_jobs`` lease, runs the pure deterministic
domain in :mod:`app.datasource.discovery`, then completes with fencing.
Only task references cross RabbitMQ; canonical inputs stay in PostgreSQL.
"""

from __future__ import annotations

import logging

from app.jobs.recovery import max_attempts_from_env, retry_seconds_from_env

from .celery_app import DATASOURCE_QUEUES, celery_app

logger = logging.getLogger(__name__)


def attempts_exhausted(attempt_count: int, max_attempts: int) -> bool:
    return attempt_count > max_attempts


def run_discovery_for_payload(command_dump: dict, *, authorize=None) -> dict:
    """Pure durable-payload entry point (no DB, no I/O). Shared by task/tests.

    Never raises: every deterministic validation failure maps to an
    ``errorCode`` so the worker can fence the task to a terminal state.
    The home workspace comes from the canonical top-level ``JobCommand``
    (``workspaceId``), not just the inner payload, so cross-workspace
    selections cannot bypass authorization when ``homeWorkspaceId`` is
    absent from the inner command.

    Cross-workspace access is authorized at execution time through the
    authoritative ``authorize`` verifier (default: deny). The payload's own
    grant claims are ignored: a queued job may not assert its own permission,
    and a revoked grant must not be resurrected from the payload.
    """
    from app.datasource.discovery import (
        deny_cross_workspace_verifier,
        discover,
        plan_ingestion,
        requires_cross_workspace_authorization,
    )

    try:
        if not isinstance(command_dump, dict):
            return {"ok": False, "errorCode": "invalid_command"}
        inner = command_dump.get("payload", command_dump)
        if not isinstance(inner, dict):
            return {"ok": False, "errorCode": "invalid_command"}
        source = inner.get("source", inner)
        if not isinstance(source, dict) or "assetId" not in source:
            return {"ok": False, "errorCode": "invalid_command"}
        options = inner.get("options")
        # The canonical top-level JobCommand workspace is the authenticated
        # home and is required: it is never inferred from the payload, and an
        # inner homeWorkspaceId may only repeat it. Omitting or spoofing it
        # cannot skip the execution-time authorization check.
        top_ws = command_dump.get("workspaceId")
        if top_ws is None:
            top_ws = command_dump.get("workspace_id")
        if not isinstance(top_ws, str) or not top_ws:
            return {"ok": False, "errorCode": "workspace_required"}
        inner_ws = inner.get("homeWorkspaceId")
        if inner_ws is not None and (not isinstance(inner_ws, str) or inner_ws != top_ws):
            return {"ok": False, "errorCode": "workspace_forbidden"}
        home_ws = top_ws

        if requires_cross_workspace_authorization(home_ws, source.get("workspaceId")):
            actor = command_dump.get("actorUserId") or inner.get("actorUserId")
            if not isinstance(actor, str) or not actor:
                return {"ok": False, "errorCode": "workspace_forbidden"}
            verifier = authorize or deny_cross_workspace_verifier
            try:
                allowed = bool(verifier(actor_user_id=actor, home_workspace_id=home_ws,
                                        source_workspace_id=source.get("workspaceId", "")))
            except Exception:
                # An unverifiable authorization decision fails closed.
                return {"ok": False, "errorCode": "workspace_forbidden"}
            if not allowed:
                return {"ok": False, "errorCode": "workspace_forbidden"}

        profile = discover(source, options if isinstance(options, dict) else None)
    except ValueError as exc:
        return {"ok": False, "errorCode": str(exc) or "invalid_source"}
    plan = plan_ingestion(profile)
    gaps = profile.get("status") in ("partial", "indexing_required")
    return {"ok": True, "profile": profile, "ingestionPlan": plan,
            "jobState": "completed_with_gaps" if gaps else "completed"}


async def _run_task(task_id: int, lease_owner: str) -> dict:
    import asyncpg

    from app.jobs.models import StaleLease
    from app.persistence.postgres_jobs import PostgresJobRepository

    from .celery_app import DATASOURCE_QUEUES as _QUEUES
    import os

    max_attempts = max_attempts_from_env(os.environ.get("SEMANTIC_TASK_MAX_ATTEMPTS"))
    retry_seconds = retry_seconds_from_env(os.environ.get("SEMANTIC_TASK_RETRY_SECONDS"))
    pool = await asyncpg.create_pool(
        os.environ["SEMANTIC_RUNTIME_DATABASE_URL"], min_size=1, max_size=2,
        command_timeout=10,
        server_settings={"application_name": "semantic-model-datasource-worker",
                         "statement_timeout": "10s", "lock_timeout": "2s",
                         "idle_in_transaction_session_timeout": "10s"},
    )
    lease = None
    try:
        repository = PostgresJobRepository(pool)
        lease = await repository.claim_task(task_id=task_id, queue_name=_QUEUES[1],
                                            lease_owner=lease_owner, lease_seconds=120)
        if lease is None:
            return {"ok": False, "errorCode": "lease_unavailable"}
        if attempts_exhausted(lease.attempt_count, max_attempts):
            # Bounded redelivery: fence to a terminal failed state instead of
            # rejecting forever after the DB comes back.
            try:
                await repository.complete_task(task_id=task_id, lease_owner=lease_owner,
                                               lease_epoch=lease.lease_epoch, job_state="failed",
                                               result=None, error_code="attempts_exhausted")
            except StaleLease:
                return {"ok": False, "errorCode": "stale_lease"}
            return {"ok": False, "errorCode": "attempts_exhausted"}
        try:
            outcome = run_discovery_for_payload(lease.payload)
        except Exception:
            # Defensive: run_discovery_for_payload never raises by contract,
            # but a claimed task must always reach fenced terminal completion.
            outcome = {"ok": False, "errorCode": "discovery_failed"}
        if not outcome.get("ok"):
            try:
                await repository.complete_task(task_id=task_id, lease_owner=lease_owner,
                                               lease_epoch=lease.lease_epoch, job_state="failed",
                                               result=None, error_code=outcome["errorCode"])
            except StaleLease:
                return {"ok": False, "errorCode": "stale_lease"}
            return outcome
        result = {"profile": outcome["profile"], "ingestionPlan": outcome["ingestionPlan"]}
        try:
            await repository.complete_task(task_id=task_id, lease_owner=lease_owner,
                                           lease_epoch=lease.lease_epoch,
                                           job_state=outcome["jobState"], result=result)
        except StaleLease:
            return {"ok": False, "errorCode": "stale_lease"}
        return {"ok": True, **result, "jobState": outcome["jobState"]}
    except Exception as exc:
        # Infra/control-plane failure after a successful claim: release the
        # lease and reset the outbox row so the next dispatch (or the
        # dispatcher's lease-expiry recovery) reclaims it. If even this fails
        # the lease simply expires and recovery picks it up. Then re-raise so
        # the broker does not treat the delivery as handled.
        if lease is not None:
            try:
                await PostgresJobRepository(pool).requeue_task(
                    task_id=task_id, lease_owner=lease_owner, lease_epoch=lease.lease_epoch,
                    error_code=type(exc).__name__, retry_seconds=retry_seconds)
            except Exception as requeue_exc:
                logger.warning("Semantic discovery requeue failed; lease recovery will retry",
                               extra={"error_code": type(requeue_exc).__name__[:100]})
        raise
    finally:
        await pool.close()


@celery_app.task(bind=True, name="semantic-model-datasource.discover", queue=DATASOURCE_QUEUES[1])
def discover_asset(self, task_id: int) -> dict:  # type: ignore[no-untyped-def]
    import asyncio
    import os
    import uuid

    if isinstance(task_id, bool) or not isinstance(task_id, int):
        # Deterministic invalid reference: ack it, nothing to retry.
        return {"ok": False, "errorCode": "invalid_task_reference"}
    max_attempts = max_attempts_from_env(os.environ.get("SEMANTIC_TASK_MAX_ATTEMPTS"))
    retry_seconds = retry_seconds_from_env(os.environ.get("SEMANTIC_TASK_RETRY_SECONDS"))
    try:
        return asyncio.run(_run_task(task_id, f"datasource-worker:{uuid.uuid4().hex}"))
    except Exception as exc:
        # Infra/control-plane failure. Celery 5.3.6 rejects failure/timeout with
        # requeue=False when acks_on_failure_or_timeout is off, so a bare raise
        # would discard the delivery. self.retry is the only path that
        # genuinely redelivers, and max_retries bounds it so a permanent
        # misconfiguration (for example a missing DSN) cannot loop forever.
        # The dispatcher's lease/outbox recovery covers the case where the
        # retry budget is exhausted. No payloads or secrets are logged.
        logger.warning("Semantic discovery task failed, scheduling bounded retry",
                       extra={"error_code": type(exc).__name__[:100]})
        raise self.retry(exc=exc, countdown=retry_seconds, max_retries=max_attempts)
