"""Search index worker: builds one generation per durable task (graph search).

Claims the ``semantic_jobs`` lease like the population worker, then owns the
generation through its own lease. A provider outage that may pass requeues the
task (bounded attempts); finished batches stay committed, so the next attempt
embeds only what is left.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable
from typing import Any

from app.jobs.recovery import max_attempts_from_env, retry_seconds_from_env
from app.jobs.error_details import capture_error, outcome_details
from app.jobs.worker_identity import worker_identity

from .celery_app import SEARCH_QUEUES, celery_app

logger = logging.getLogger(__name__)

# One identity per worker process (P0-01): task and generation leases are owned under
# it, so instances sharing a host never touch each other's ownership. A restart recovers
# another instance's leases only when they really expire in PostgreSQL.
IDENTITY = worker_identity("search")


class BuildStalled(RuntimeError):
    """The build made no progress for as long as its generation lease lasts (a step that never returns)."""

    code = "index_stalled"


async def run_watched(build: Awaitable[Any], progressed_at: dict[str, float], stall_seconds: float,
                      check_seconds: float = 15.0, guard: Any = None) -> Any:
    """Run ``build`` and cancel it when ``progressed_at["at"]`` (monotonic time of the last real
    progress) is older than ``stall_seconds``. A worker stuck in one await would otherwise hold its
    slot for good: the task lease is recovered in the database, but the requeued task has no worker
    left to run it. Raises ``BuildStalled`` so the task is requeued (or failed past its attempts)."""
    running = asyncio.ensure_future(build)
    try:
        while True:
            done, _ = await asyncio.wait({running}, timeout=min(check_seconds, 0.1) if guard else check_seconds)
            if guard is not None:
                guard.assert_healthy()
            if done:
                return running.result()
            if time.monotonic() - progressed_at["at"] > stall_seconds:
                running.cancel()
                # A step that ignores the cancellation is abandoned rather than waited for.
                await asyncio.wait({running}, timeout=30)
                raise BuildStalled("search index build made no progress")
    except BaseException:
        running.cancel()
        await asyncio.wait({running}, timeout=1)
        raise


async def _run_task(task_id: int, lease_owner: str) -> dict:
    import os

    import asyncpg

    from app.graph_search.embeddings import EmbeddingError, profile_from_env
    from app.graph_search.indexer import GENERATION_LEASE_SECONDS, build_index, build_lease_seconds
    from app.graph_search.settings import IndexBuildSettings, ValidationError
    from app.jobs.service import INDEX_BUILD_PAYLOAD_KEY
    from app.jobs.models import StaleLease
    from app.jobs.task_lease_guard import TaskLeaseGuard, TaskOwnership, lease_windows_from_env
    from app.persistence import graph_search_store as search_store
    from app.persistence.postgres_jobs import PostgresJobRepository

    max_attempts = max_attempts_from_env(os.environ.get("SEMANTIC_TASK_MAX_ATTEMPTS"))
    retry_seconds = retry_seconds_from_env(os.environ.get("SEMANTIC_TASK_RETRY_SECONDS"))
    pool = await asyncpg.create_pool(
        os.environ["SEMANTIC_RUNTIME_DATABASE_URL"], min_size=1, max_size=2, command_timeout=30,
        server_settings={"application_name": "semantic-model-search-worker",
                         "statement_timeout": "30s", "lock_timeout": "2s",
                         "idle_in_transaction_session_timeout": "30s"})
    lease = None
    guard = None
    scope = None
    lease_seconds, renew_seconds = lease_windows_from_env()
    repository = PostgresJobRepository(pool)

    async def finish(job_state: str, result: dict | None, error_code: str | None = None,
                     exception: BaseException | None = None) -> dict:
        try:
            details = None
            if job_state == "failed" and error_code != "cancelled":
                context = {"jobId": lease.job_id, "taskId": str(task_id), "attempt": lease.attempt_count,
                           "indexId": str(lease.payload.get("payload", {}).get("indexId") or "")}
                if exception is not None:
                    details = capture_error(exception, code=getattr(exception, "code", error_code), phase="search", attempt=lease.attempt_count,
                                            job_id=lease.job_id, task_id=task_id,
                                            index_id=str(lease.payload.get("payload", {}).get("indexId") or ""))
                else:
                    details = outcome_details({"errorCode": error_code}, phase="search", **context)
            await repository.complete_task(task_id=task_id, lease_owner=lease_owner,
                                            lease_epoch=lease.lease_epoch, job_state=job_state,
                                            result=result, error_code=error_code, error_details=details)
        except StaleLease:
            return {"ok": False, "errorCode": "stale_lease"}
        return {"ok": job_state != "failed", **(result or {}), "jobState": job_state}

    try:
        lease = await repository.claim_task(task_id=task_id, queue_name=SEARCH_QUEUES[0],
                                            lease_owner=lease_owner, lease_seconds=lease_seconds)
        if lease is None:
            return {"ok": False, "errorCode": "lease_unavailable"}
        ownership = TaskOwnership(task_id, lease.job_id, lease_owner, lease.lease_epoch)
        guard = TaskLeaseGuard(ownership, lease_seconds=lease_seconds, renew_seconds=renew_seconds)
        await guard.start()
        await guard.assert_owned()
        scope = search_store._task_ownership.set(ownership)
        index_id = str(lease.payload.get("payload", {}).get("indexId") or "")
        if not index_id:
            return await finish("failed", None, "invalid_index_task")
        if lease.attempt_count > max_attempts:
            state = await search_store._fail_abandoned_generation(pool, index_id, "attempts_exhausted")
            if state == "ready":
                return await finish("completed", {"indexId": index_id, "state": "ready", "reused": True})
            return await finish("failed", None, "attempts_exhausted")

        # An earlier attempt of this job (it crashed, or its worker restarted) may still hold the
        # generation; this attempt owns the job now, so the build resumes instead of reporting "busy".
        if await search_store.adopt_generation(pool, index_id, lease.job_id, lease_owner):
            logger.info("Search index build resumed from an earlier attempt of the same job")

        # The administrator's build knobs ride on the job; unreadable ones count as absent.
        build = None
        given = lease.payload.get("payload", {}).get(INDEX_BUILD_PAYLOAD_KEY)
        if given:
            try:
                build = IndexBuildSettings.model_validate(given)
            except ValidationError:
                logger.warning("Unreadable search index build settings; the environment's used")

        # Real progress only (a page read, a chunk reused, a wave stored): the clock the watchdog reads.
        progressed_at = {"at": time.monotonic()}
        profile = profile_from_env()
        stall_seconds = build_lease_seconds(profile.with_build(build)) if profile else GENERATION_LEASE_SECONDS

        async def report(progress: dict) -> None:
            guard.assert_healthy()
            progressed_at["at"] = time.monotonic()
            if not await repository.checkpoint(task_id=task_id, lease_owner=lease_owner,
                                               lease_epoch=lease.lease_epoch, progress=progress,
                                               lease_seconds=lease_seconds, renew=False):
                raise StaleLease("search index lease lost while reporting progress")

        async def should_stop() -> bool:
            guard.assert_healthy()
            return await repository.cancel_requested(lease.job_id)

        try:
            outcome = await run_watched(
                build_index(pool, index_id=index_id, owner=lease_owner, report=report, build=build,
                            should_stop=should_stop),
                progressed_at, stall_seconds, guard=guard)
        except BuildStalled as exc:
            logger.warning("Search index build stalled; its worker is released",
                           extra={"attempt": lease.attempt_count, "stall_seconds": stall_seconds})
            if lease.attempt_count < max_attempts:
                raise
            state = await search_store._fail_abandoned_generation(pool, index_id, "index_interrupted")
            if state == "ready":
                return await finish("completed", {"indexId": index_id, "state": "ready", "reused": True})
            return await finish("failed", {"indexId": index_id}, "index_interrupted", exc)
        except EmbeddingError as exc:
            if exc.retryable and lease.attempt_count < max_attempts:
                raise
            await search_store.fail_generation(pool, index_id, exc.code, lease_owner)
            return await finish("failed", {"indexId": index_id}, exc.code, exc)
        result = {"indexId": index_id, **outcome}
        if outcome.get("state") == "cancelled":
            try:
                await repository.cancel_task(task_id=task_id, lease_owner=lease_owner,
                                             lease_epoch=lease.lease_epoch)
            except StaleLease:
                return {"ok": False, "errorCode": "stale_lease"}
            return {"ok": False, "errorCode": "cancelled", "jobState": "cancelled", **result}
        # Busy: another live job owns this generation and will finish it.
        if outcome.get("state") == "ready" or outcome.get("busy"):
            return await finish("completed", result)
        return await finish("failed", result, outcome.get("errorCode") or str(outcome.get("state")))
    except Exception as exc:
        if lease is not None:
            try:
                await repository.requeue_task(task_id=task_id, lease_owner=lease_owner,
                                              lease_epoch=lease.lease_epoch,
                                              error_code=getattr(exc, "code", type(exc).__name__),
                                               retry_seconds=retry_seconds,
                                               error_details=capture_error(exc, phase="search", attempt=lease.attempt_count,
                                                                           job_id=lease.job_id, task_id=task_id))
            except Exception as requeue_exc:
                logger.warning("Search index requeue failed; lease recovery will retry",
                               extra={"error_code": type(requeue_exc).__name__[:100]})
        raise
    finally:
        if scope is not None:
            search_store._task_ownership.reset(scope)
        if guard is not None:
            guard.stop()
        # A connection stuck on a lost network would make a graceful close wait as long as the hang did.
        try:
            await asyncio.wait_for(pool.close(), 30)
        except asyncio.TimeoutError:
            pool.terminate()


@celery_app.task(bind=True, name="semantic-model-search.index", queue=SEARCH_QUEUES[0])
def index_graph_search(self, task_id: int) -> dict:  # type: ignore[no-untyped-def]
    import asyncio
    import os

    if isinstance(task_id, bool) or not isinstance(task_id, int):
        return {"ok": False, "errorCode": "invalid_task_reference"}
    max_attempts = max_attempts_from_env(os.environ.get("SEMANTIC_TASK_MAX_ATTEMPTS"))
    retry_seconds = retry_seconds_from_env(os.environ.get("SEMANTIC_TASK_RETRY_SECONDS"))
    try:
        return asyncio.run(_run_task(task_id, IDENTITY.lease_owner()))
    except Exception as exc:
        logger.warning("Search index task failed, scheduling bounded retry",
                       extra={"error_code": type(exc).__name__[:100]})
        raise self.retry(exc=exc, countdown=retry_seconds, max_retries=max_attempts)
