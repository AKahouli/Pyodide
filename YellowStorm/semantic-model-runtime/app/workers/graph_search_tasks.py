"""Search index worker: builds one generation per durable task (graph search).

Claims the ``semantic_jobs`` lease like the population worker, then owns the
generation through its own lease. A provider outage that may pass requeues the
task (bounded attempts); finished batches stay committed, so the next attempt
embeds only what is left.
"""

from __future__ import annotations

import logging

from app.jobs.recovery import max_attempts_from_env, retry_seconds_from_env

from .celery_app import SEARCH_QUEUES, celery_app

logger = logging.getLogger(__name__)
TASK_LEASE_SECONDS = 600


async def _run_task(task_id: int, lease_owner: str) -> dict:
    import os

    import asyncpg

    from app.graph_search.embeddings import EmbeddingError
    from app.graph_search.indexer import build_index
    from app.jobs.models import StaleLease
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
    repository = PostgresJobRepository(pool)

    async def finish(job_state: str, result: dict | None, error_code: str | None = None) -> dict:
        try:
            await repository.complete_task(task_id=task_id, lease_owner=lease_owner,
                                           lease_epoch=lease.lease_epoch, job_state=job_state,
                                           result=result, error_code=error_code)
        except StaleLease:
            return {"ok": False, "errorCode": "stale_lease"}
        return {"ok": job_state != "failed", **(result or {}), "jobState": job_state}

    try:
        lease = await repository.claim_task(task_id=task_id, queue_name=SEARCH_QUEUES[0],
                                            lease_owner=lease_owner, lease_seconds=TASK_LEASE_SECONDS)
        if lease is None:
            return {"ok": False, "errorCode": "lease_unavailable"}
        index_id = str(lease.payload.get("payload", {}).get("indexId") or "")
        if not index_id:
            return await finish("failed", None, "invalid_index_task")
        if lease.attempt_count > max_attempts:
            await search_store.fail_generation(pool, index_id, "attempts_exhausted")
            return await finish("failed", None, "attempts_exhausted")

        async def report(progress: dict) -> None:
            if not await repository.checkpoint(task_id=task_id, lease_owner=lease_owner,
                                               lease_epoch=lease.lease_epoch, progress=progress,
                                               lease_seconds=TASK_LEASE_SECONDS):
                raise StaleLease("search index lease lost while reporting progress")

        try:
            outcome = await build_index(pool, index_id=index_id, owner=lease_owner, report=report)
        except EmbeddingError as exc:
            if exc.retryable and lease.attempt_count < max_attempts:
                raise
            await search_store.fail_generation(pool, index_id, exc.code, lease_owner)
            return await finish("failed", {"indexId": index_id}, exc.code)
        result = {"indexId": index_id, **outcome}
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
                                              retry_seconds=retry_seconds)
            except Exception as requeue_exc:
                logger.warning("Search index requeue failed; lease recovery will retry",
                               extra={"error_code": type(requeue_exc).__name__[:100]})
        raise
    finally:
        await pool.close()


@celery_app.task(bind=True, name="semantic-model-search.index", queue=SEARCH_QUEUES[0])
def index_graph_search(self, task_id: int) -> dict:  # type: ignore[no-untyped-def]
    import asyncio
    import os
    import uuid

    if isinstance(task_id, bool) or not isinstance(task_id, int):
        return {"ok": False, "errorCode": "invalid_task_reference"}
    max_attempts = max_attempts_from_env(os.environ.get("SEMANTIC_TASK_MAX_ATTEMPTS"))
    retry_seconds = retry_seconds_from_env(os.environ.get("SEMANTIC_TASK_RETRY_SECONDS"))
    try:
        return asyncio.run(_run_task(task_id, f"search-worker:{uuid.uuid4().hex}"))
    except Exception as exc:
        logger.warning("Search index task failed, scheduling bounded retry",
                       extra={"error_code": type(exc).__name__[:100]})
        raise self.retry(exc=exc, countdown=retry_seconds, max_retries=max_attempts)
