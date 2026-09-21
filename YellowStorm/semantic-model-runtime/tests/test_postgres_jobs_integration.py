from __future__ import annotations

import asyncio
import os
from pathlib import Path

import asyncpg
import pytest
import pytest_asyncio

from app.jobs.models import IdempotencyConflict, JobCommand, SourceEvent, StaleLease
from app.jobs.service import JobService
from app.persistence.postgres_jobs import PostgresJobRepository

DSN = os.environ.get("SEMANTIC_RUNTIME_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DSN, reason="SEMANTIC_RUNTIME_TEST_DATABASE_URL not set")
MIGRATIONS = sorted((Path(__file__).resolve().parents[1] / "migrations").glob("*.sql"))


@pytest_asyncio.fixture
async def pool():
    assert DSN
    connection = await asyncpg.connect(DSN)
    try:
        for schema in ("semantic_jobs", "semantic_datasource", "semantic_runtime",
                       "semantic_population", "semantic_search"):
            await connection.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
        for migration in MIGRATIONS:
            await connection.execute(migration.read_text(encoding="utf-8"))
    finally:
        await connection.close()
    value = await asyncpg.create_pool(DSN, min_size=1, max_size=6)
    yield value
    await value.close()


def command(purpose: str = "build") -> JobCommand:
    return JobCommand.model_validate(
        {"actorUserId": "user-1", "modelId": "model-1", "payload": {"purpose": purpose}}
    )


async def admit(repository: PostgresJobRepository, key: str = "idem-1", purpose: str = "build"):
    return await JobService(repository).admit(
        job_type="population.run",
        command=command(purpose),
        idempotency_key=key,
        task_name="semantic-model-population.run",
        queue_name="semantic-model-population.batch",
    )


@pytest.mark.asyncio
async def test_migration_and_concurrent_idempotent_admission(pool: asyncpg.Pool):
    repository = PostgresJobRepository(pool)
    first, second = await asyncio.gather(admit(repository), admit(repository))
    assert first.job_id == second.job_id
    assert {first.reused, second.reused} == {False, True}
    assert await pool.fetchval("SELECT count(*) FROM semantic_jobs.jobs") == 1
    assert await pool.fetchval("SELECT count(*) FROM semantic_jobs.tasks") == 1
    assert await pool.fetchval("SELECT count(*) FROM semantic_jobs.outbox") == 1
    assert await pool.fetchval("SELECT count(*) FROM semantic_jobs.events") == 1


@pytest.mark.asyncio
async def test_same_key_different_operation_conflicts(pool: asyncpg.Pool):
    repository = PostgresJobRepository(pool)
    await admit(repository)
    with pytest.raises(IdempotencyConflict):
        await JobService(repository).admit(
            job_type="datasource.discovery",
            command=command(),
            idempotency_key="idem-1",
            task_name="semantic-model-datasource.discover",
            queue_name="semantic-model-datasource.batch",
        )


@pytest.mark.asyncio
async def test_source_events_create_idempotent_revisions_and_ignore_stale_heads(pool: asyncpg.Pool):
    repository = PostgresJobRepository(pool)
    newer = SourceEvent.model_validate({
        "eventId": "event-new", "eventType": "workspace.document.indexing_ready.v1",
        "occurredAt": "2026-09-20T12:00:00Z",
        "payload": {"workspaceId": "workspace-1", "documentId": "document-1"},
    })
    older = SourceEvent.model_validate({
        "eventId": "reconcile:event-old", "eventType": "workspace.document.registered.v1",
        "occurredAt": "2026-09-20T11:00:00Z",
        "payload": {"workspaceId": "workspace-1", "documentId": "document-1"},
    })

    assert await repository.record_source_event(newer) == {
        "revision": 1, "reused": False, "headAdvanced": True,
    }
    assert await repository.record_source_event(newer) == {"revision": 1, "reused": True}
    await pool.execute(
        "UPDATE semantic_jobs.source_heads SET last_reconciled_at = '2000-01-01'"
    )
    assert await repository.record_source_event(older) == {
        "revision": 2, "reused": False, "headAdvanced": False,
    }
    head = await pool.fetchrow(
        "SELECT event_id, revision, last_reconciled_at FROM semantic_jobs.source_heads "
        "WHERE workspace_id = $1 AND asset_id = $2",
        "workspace-1", "document-1",
    )
    assert head["event_id"] == "event-new" and head["revision"] == 1
    assert head["last_reconciled_at"].year > 2000

    await pool.execute(
        "UPDATE semantic_jobs.source_heads SET last_reconciled_at = '2000-01-01'"
    )
    assert await repository.record_source_event(older) == {"revision": 2, "reused": True}
    assert await pool.fetchval(
        "SELECT last_reconciled_at > '2000-01-01' FROM semantic_jobs.source_heads"
    ) is True

    deleted = SourceEvent.model_validate({
        "eventId": "aaa-delete", "eventType": "workspace.document.deleted.v1",
        "occurredAt": "2026-09-20T12:00:00Z",
        "payload": {"workspaceId": "workspace-1", "documentId": "document-1"},
    })
    assert await repository.record_source_event(deleted) == {
        "revision": 3, "reused": False, "headAdvanced": True,
    }
    head = await pool.fetchrow(
        "SELECT event_id, revision, deleted FROM semantic_jobs.source_heads WHERE workspace_id = $1 AND asset_id = $2",
        "workspace-1", "document-1",
    )
    assert dict(head) == {"event_id": "aaa-delete", "revision": 3, "deleted": True}


@pytest.mark.asyncio
async def test_claim_race_and_lease_epoch_fence(pool: asyncpg.Pool):
    repository = PostgresJobRepository(pool)
    await admit(repository)
    task_id = await pool.fetchval("SELECT id FROM semantic_jobs.tasks")
    one, two = await asyncio.gather(
        repository.claim_task(task_id=task_id, queue_name="semantic-model-population.batch", lease_owner="w1", lease_seconds=30),
        repository.claim_task(task_id=task_id, queue_name="semantic-model-population.batch", lease_owner="w2", lease_seconds=30),
    )
    original = one or two
    assert original is not None
    assert (one is None) != (two is None)
    await pool.execute(
        "UPDATE semantic_jobs.tasks SET lease_expires_at = now() - interval '1 second' WHERE id = $1",
        task_id,
    )
    replacement = await repository.claim_task(
        task_id=task_id,
        queue_name="semantic-model-population.batch",
        lease_owner="w3",
        lease_seconds=30,
    )
    assert replacement and replacement.lease_epoch == original.lease_epoch + 1
    assert await repository.checkpoint(
        task_id=task_id,
        lease_owner=original.lease_owner,
        lease_epoch=original.lease_epoch,
        progress={"done": 1},
        lease_seconds=30,
    ) is False
    assert await repository.checkpoint(
        task_id=task_id,
        lease_owner="w3",
        lease_epoch=replacement.lease_epoch,
        progress={"done": 2},
        lease_seconds=30,
    ) is True


@pytest.mark.asyncio
async def test_completion_is_atomic_and_stale_duplicate_is_rejected(pool: asyncpg.Pool):
    repository = PostgresJobRepository(pool)
    admitted = await admit(repository)
    task_id = await pool.fetchval("SELECT id FROM semantic_jobs.tasks")
    lease = await repository.claim_task(
        task_id=task_id,
        queue_name="semantic-model-population.batch",
        lease_owner="worker",
        lease_seconds=30,
    )
    assert lease
    result = await repository.complete_task(
        task_id=task_id,
        lease_owner="worker",
        lease_epoch=lease.lease_epoch,
        job_state="completed",
        result={"revision": 42},
    )
    assert result == {"jobId": admitted.job_id, "state": "completed"}
    assert await pool.fetchval("SELECT state FROM semantic_jobs.jobs") == "completed"
    assert await pool.fetchval("SELECT count(*) FROM semantic_jobs.events WHERE event_type='job.completed'") == 1
    with pytest.raises(StaleLease):
        await repository.complete_task(
            task_id=task_id,
            lease_owner="worker",
            lease_epoch=lease.lease_epoch,
            job_state="completed",
            result={},
        )


@pytest.mark.asyncio
async def test_admission_rolls_back_when_outbox_insert_fails(pool: asyncpg.Pool):
    repository = PostgresJobRepository(pool)
    await pool.execute("ALTER TABLE semantic_jobs.outbox RENAME TO outbox_hold")
    try:
        with pytest.raises(asyncpg.UndefinedTableError):
            await admit(repository)
        assert await pool.fetchval("SELECT count(*) FROM semantic_jobs.jobs") == 0
        assert await pool.fetchval("SELECT count(*) FROM semantic_jobs.tasks") == 0
    finally:
        await pool.execute("ALTER TABLE semantic_jobs.outbox_hold RENAME TO outbox")


@pytest.mark.asyncio
async def test_outbox_claim_expires_and_can_be_reclaimed(pool: asyncpg.Pool):
    repository = PostgresJobRepository(pool)
    await admit(repository)
    first = await repository.claim_outbox(claim_owner="d1", claim_seconds=30)
    assert first
    await pool.execute(
        "UPDATE semantic_jobs.outbox SET claim_expires_at = now() - interval '1 second' WHERE id = $1",
        first.outbox_id,
    )
    second = await repository.claim_outbox(claim_owner="d2", claim_seconds=30)
    assert second and second.outbox_id == first.outbox_id
    assert await repository.mark_outbox_published(first.outbox_id, "d1") is False
    assert await repository.mark_outbox_published(second.outbox_id, "d2") is True


async def _expire_lease(pool: asyncpg.Pool, task_id: int) -> None:
    await pool.execute(
        "UPDATE semantic_jobs.tasks SET lease_expires_at = now() - interval '1 second' WHERE id = $1",
        task_id,
    )


async def _age_dispatch(pool: asyncpg.Pool, seconds: int = 3600) -> None:
    await pool.execute(
        "UPDATE semantic_jobs.outbox SET published_at = now() - make_interval(secs => $1), "
        "claim_owner = NULL, claim_expires_at = NULL",
        seconds,
    )


def _recover(repository: PostgresJobRepository, *, max_attempts: int = 3,
             retry_seconds: int = 0, grace_seconds: int = 60):
    return repository.recover_stalled_tasks(
        max_attempts=max_attempts, retry_seconds=retry_seconds,
        grace_seconds=grace_seconds, batch=50,
    )


@pytest.mark.asyncio
async def test_infra_failure_releases_lease_for_immediate_redelivery(pool: asyncpg.Pool):
    repository = PostgresJobRepository(pool)
    await admit(repository)
    task_id = await pool.fetchval("SELECT id FROM semantic_jobs.tasks")
    lease = await repository.claim_task(
        task_id=task_id, queue_name="semantic-model-population.batch",
        lease_owner="w1", lease_seconds=30,
    )
    assert lease and lease.attempt_count == 1
    claimed = await repository.claim_outbox(claim_owner="d1", claim_seconds=30)
    assert claimed and await repository.mark_outbox_published(claimed.outbox_id, "d1") is True
    # A task that ran far longer than the grace window before failing.
    await _age_dispatch(pool, seconds=3600)

    assert await repository.requeue_task(
        task_id=task_id, lease_owner="w1", lease_epoch=lease.lease_epoch,
        error_code="ConnectionError", retry_seconds=30,
    ) is True
    # The requeue starts the grace clock at the scheduled retry arrival, so an
    # immediate recovery republish cannot pre-empt the Celery retry.
    assert await _recover(repository, grace_seconds=60, retry_seconds=30) == {
        "exhausted": 0, "requeued": 0}
    assert await pool.fetchval("SELECT published_at FROM semantic_jobs.outbox") is not None
    row = await pool.fetchrow(
        "SELECT state, lease_owner, lease_expires_at FROM semantic_jobs.tasks WHERE id = $1", task_id
    )
    assert row["state"] == "queued" and row["lease_owner"] is None and row["lease_expires_at"] is None
    # The outbox row stays published (broker redelivery owns the fast path), and
    # the grace clock starts when the scheduled retry is expected to arrive.
    assert await pool.fetchval("SELECT published_at FROM semantic_jobs.outbox") is not None
    assert await pool.fetchval("SELECT count(*) FROM semantic_jobs.outbox") == 1
    assert await pool.fetchval(
        "SELECT published_at > now() + interval '29 seconds' FROM semantic_jobs.outbox"
    ) is True
    # Recovery cannot republish ahead of the scheduled retry, even when the
    # retry delay exceeds the grace window.
    assert await _recover(repository, grace_seconds=60, retry_seconds=30) == {
        "exhausted": 0, "requeued": 0}
    # Once the retry window and grace both pass with no delivery, recovery
    # republishes it.
    await pool.execute(
        "UPDATE semantic_jobs.outbox SET published_at = now() - interval '120 seconds'")
    assert await _recover(repository, grace_seconds=60, retry_seconds=30) == {
        "exhausted": 0, "requeued": 1}

    # Redelivery reclaims immediately (no wait for the old lease) and the
    # attempt counter advances toward the cap.
    reclaimed = await repository.claim_task(
        task_id=task_id, queue_name="semantic-model-population.batch",
        lease_owner="w2", lease_seconds=30,
    )
    assert reclaimed and reclaimed.attempt_count == 2
    # A stale owner can no longer release the lease another worker holds.
    assert await repository.requeue_task(
        task_id=task_id, lease_owner="w1", lease_epoch=lease.lease_epoch,
        error_code="ConnectionError", retry_seconds=30,
    ) is False


@pytest.mark.asyncio
async def test_retry_longer_than_grace_still_cannot_pre_empt_the_retry(pool: asyncpg.Pool):
    """retry_seconds >= grace_seconds is the dangerous ordering: a naive
    now()-based grace clock would republish before the Celery retry lands."""
    repository = PostgresJobRepository(pool)
    await admit(repository)
    task_id = await pool.fetchval("SELECT id FROM semantic_jobs.tasks")
    lease = await repository.claim_task(
        task_id=task_id, queue_name="semantic-model-population.batch",
        lease_owner="w1", lease_seconds=30,
    )
    assert lease
    claimed = await repository.claim_outbox(claim_owner="d1", claim_seconds=30)
    assert claimed and await repository.mark_outbox_published(claimed.outbox_id, "d1") is True

    assert await repository.requeue_task(
        task_id=task_id, lease_owner="w1", lease_epoch=lease.lease_epoch,
        error_code="ConnectionError", retry_seconds=300,
    ) is True
    assert await pool.fetchval(
        "SELECT published_at > now() + interval '290 seconds' FROM semantic_jobs.outbox"
    ) is True
    # grace (30) far below retry (300): still no republish, because the grace
    # clock starts at the scheduled retry arrival, not at requeue time.
    assert await _recover(repository, grace_seconds=30, retry_seconds=300) == {
        "exhausted": 0, "requeued": 0}


@pytest.mark.asyncio
async def test_expired_lease_recovery_requeues_then_terminates_at_attempt_cap(pool: asyncpg.Pool):
    repository = PostgresJobRepository(pool)
    admitted = await admit(repository)
    task_id = await pool.fetchval("SELECT id FROM semantic_jobs.tasks")

    lease = await repository.claim_task(
        task_id=task_id, queue_name="semantic-model-population.batch",
        lease_owner="dead-worker", lease_seconds=30,
    )
    assert lease
    await _expire_lease(pool, task_id)

    assert await _recover(repository, max_attempts=1) == {"exhausted": 0, "requeued": 1}
    assert await pool.fetchval("SELECT state FROM semantic_jobs.tasks WHERE id = $1", task_id) == "queued"
    assert await pool.fetchval("SELECT published_at FROM semantic_jobs.outbox") is None

    second = await repository.claim_task(
        task_id=task_id, queue_name="semantic-model-population.batch",
        lease_owner="dead-worker-2", lease_seconds=30,
    )
    assert second and second.attempt_count == 2
    await _expire_lease(pool, task_id)

    # attempt_count (2) > max_attempts (1): fence terminally instead of looping.
    assert await _recover(repository, max_attempts=1) == {"exhausted": 1, "requeued": 0}
    assert await pool.fetchval("SELECT state FROM semantic_jobs.tasks WHERE id = $1", task_id) == "failed"
    assert await pool.fetchval("SELECT error_code FROM semantic_jobs.tasks WHERE id = $1", task_id) == "attempts_exhausted"
    job = await pool.fetchrow("SELECT state, error_code FROM semantic_jobs.jobs WHERE id = $1::uuid", admitted.job_id)
    assert job["state"] == "failed" and job["error_code"] == "attempts_exhausted"
    assert await pool.fetchval(
        "SELECT count(*) FROM semantic_jobs.events WHERE event_type = 'job.failed'"
    ) == 1
    # Recovery is idempotent once the task is terminal.
    assert await _recover(repository, max_attempts=1) == {"exhausted": 0, "requeued": 0}


@pytest.mark.asyncio
async def test_published_dispatch_never_claimed_is_republished_after_grace(pool: asyncpg.Pool):
    """A worker that died before claim_task leaves a queued task whose outbox
    row is already published. Without this path the job would be stranded."""
    repository = PostgresJobRepository(pool)
    await admit(repository)
    task_id = await pool.fetchval("SELECT id FROM semantic_jobs.tasks")
    claimed = await repository.claim_outbox(claim_owner="d1", claim_seconds=30)
    assert claimed and await repository.mark_outbox_published(claimed.outbox_id, "d1") is True

    # Inside the grace window the delivery is still expected: no recovery.
    await _age_dispatch(pool, seconds=1)
    assert await _recover(repository, grace_seconds=60) == {"exhausted": 0, "requeued": 0}

    # Past the grace window it is republished and reclaimed.
    await _age_dispatch(pool, seconds=120)
    assert await _recover(repository, grace_seconds=60, retry_seconds=30) == {"exhausted": 0, "requeued": 1}
    assert await pool.fetchval("SELECT state FROM semantic_jobs.tasks WHERE id = $1", task_id) == "queued"
    assert await pool.fetchval("SELECT published_at FROM semantic_jobs.outbox") is None
    # Backoff is capped linear on the dispatch count (1 -> retry_seconds).
    assert await pool.fetchval(
        "SELECT next_attempt_at > now() + interval '29 seconds' FROM semantic_jobs.outbox"
    ) is True
    reclaimed = await repository.claim_task(
        task_id=task_id, queue_name="semantic-model-population.batch",
        lease_owner="w2", lease_seconds=30,
    )
    assert reclaimed and reclaimed.attempt_count == 1


@pytest.mark.asyncio
async def test_backlogged_queue_never_fails_an_unattempted_task(pool: asyncpg.Pool):
    """A healthy but slow queue must not exhaust a task no worker attempted:
    the never-claimed class republishes without a bound on dispatch count."""
    repository = PostgresJobRepository(pool)
    admitted = await admit(repository)
    task_id = await pool.fetchval("SELECT id FROM semantic_jobs.tasks")
    claimed = await repository.claim_outbox(claim_owner="d1", claim_seconds=30)
    assert claimed and await repository.mark_outbox_published(claimed.outbox_id, "d1") is True
    # Simulate many republish cycles worth of backlog: the outbox dispatch
    # counter is far past the task attempt cap.
    await pool.execute(
        "UPDATE semantic_jobs.outbox SET attempt_count = 50, "
        "published_at = now() - interval '1 hour'"
    )
    result = await _recover(repository, max_attempts=3, retry_seconds=30, grace_seconds=60)
    assert result == {"exhausted": 0, "requeued": 1}
    assert await pool.fetchval("SELECT state FROM semantic_jobs.tasks WHERE id = $1", task_id) == "queued"
    job = await pool.fetchrow("SELECT state FROM semantic_jobs.jobs WHERE id = $1::uuid", admitted.job_id)
    assert job["state"] == "queued"
    # Backoff is capped rather than unbounded.
    assert await pool.fetchval(
        "SELECT next_attempt_at <= now() + interval '601 seconds' FROM semantic_jobs.outbox"
    ) is True


@pytest.mark.asyncio
async def test_recovery_leaves_live_leases_and_completed_jobs_untouched(pool: asyncpg.Pool):
    repository = PostgresJobRepository(pool)
    admitted = await admit(repository)
    task_id = await pool.fetchval("SELECT id FROM semantic_jobs.tasks")
    lease = await repository.claim_task(
        task_id=task_id, queue_name="semantic-model-population.batch",
        lease_owner="healthy", lease_seconds=30,
    )
    assert lease
    # A live lease, and a task whose dispatch was just published, are untouched.
    await _age_dispatch(pool, seconds=1)
    assert await _recover(repository, max_attempts=1) == {"exhausted": 0, "requeued": 0}
    await repository.complete_task(
        task_id=task_id, lease_owner="healthy", lease_epoch=lease.lease_epoch,
        job_state="completed", result={"ok": True},
    )
    await _expire_lease(pool, task_id)
    await _age_dispatch(pool, seconds=3600)
    assert await _recover(repository, max_attempts=0) == {"exhausted": 0, "requeued": 0}
    assert await pool.fetchval("SELECT state FROM semantic_jobs.jobs WHERE id = $1::uuid", admitted.job_id) == "completed"
