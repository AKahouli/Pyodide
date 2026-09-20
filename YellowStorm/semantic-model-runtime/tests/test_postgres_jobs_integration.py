from __future__ import annotations

import asyncio
import os
from pathlib import Path

import asyncpg
import pytest
import pytest_asyncio

from app.jobs.models import IdempotencyConflict, JobCommand, StaleLease
from app.jobs.service import JobService
from app.persistence.postgres_jobs import PostgresJobRepository

DSN = os.environ.get("SEMANTIC_RUNTIME_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DSN, reason="SEMANTIC_RUNTIME_TEST_DATABASE_URL not set")
MIGRATION = Path(__file__).resolve().parents[1] / "migrations" / "001_durable_jobs.sql"


@pytest_asyncio.fixture
async def pool():
    assert DSN
    connection = await asyncpg.connect(DSN)
    try:
        await connection.execute("DROP SCHEMA IF EXISTS semantic_jobs CASCADE")
        await connection.execute(MIGRATION.read_text(encoding="utf-8"))
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
