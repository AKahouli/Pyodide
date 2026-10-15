"""Task-owned integration coverage against explicitly configured test schemas.

Run this file explicitly from the runtime. Jobs use a unique actor/model/queue and
no worker consumes that queue. Cleanup only removes this fixture's own job rows.
"""
import asyncio
import os
from contextlib import asynccontextmanager
from uuid import uuid4

import asyncpg
import pytest
import pytest_asyncio

from app.jobs.models import JobCommand
from app.jobs.service import JobService
from app.persistence.postgres_jobs import PostgresJobRepository

# Never import deployment .env settings from an integration-test collection.
DSN = os.environ.get("SEMANTIC_RUNTIME_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DSN, reason="Explicit semantic runtime test database unavailable")


@pytest_asyncio.fixture
async def owned_jobs():
    pool = await asyncpg.create_pool(DSN, min_size=1, max_size=4, command_timeout=10)
    actor = "qa-my-jobs-" + uuid4().hex
    model = str(uuid4())
    queue = "qa-my-jobs-" + uuid4().hex
    repository = PostgresJobRepository(pool)

    async def admit(*, owner=actor, model_id=model, scope=None):
        payload = {"purpose": "refresh", "fixture": uuid4().hex,
                   "scope": scope or {"kind": "model"}}
        result = await JobService(repository).admit(
            job_type="population.run",
            command=JobCommand.model_validate({"actorUserId": owner, "modelId": model_id, "payload": payload}),
            idempotency_key="qa-" + uuid4().hex,
            task_name="semantic-model-population.run", queue_name=queue)
        return result.job_id

    try:
        yield pool, repository, actor, model, queue, admit
    finally:
        # All owners in this fixture share this unique prefix; no user or other test is affected.
        await pool.execute("DELETE FROM semantic_jobs.jobs WHERE actor_user_id = $1 OR actor_user_id = $2", actor, actor + "-other")
        await pool.close()


@pytest.mark.asyncio
async def test_live_bulk_queue_filter_preserves_other_actor_model_and_running_history(owned_jobs):
    pool, repository, actor, model, queue, admit = owned_jobs
    queued = await admit(scope={"kind": "concept", "conceptId": "fact"})
    running = await admit()
    other_actor = await admit(owner=actor + "-other")
    other_model = await admit(model_id=str(uuid4()))
    task_id = await pool.fetchval("SELECT id FROM semantic_jobs.tasks WHERE job_id = $1::uuid", running)
    assert await repository.claim_task(task_id=task_id, queue_name=queue, lease_owner="qa", lease_seconds=120)
    page = await repository.list_my_jobs(actor_user_id=actor, model_ids=[model], view="active", page=1, limit=20)
    assert {job["jobId"] for job in page["items"]} == {queued, running}
    assert (await repository.get_job(queued, actor))["scope"] == {"kind": "concept", "conceptId": "fact"}
    assert await repository.get_job(queued, actor + "-other") is None
    assert await repository.cancel_queued_jobs(actor_user_id=actor, model_ids=[model]) == {"cancelled": 1, "skipped": 0}
    history = await repository.list_my_jobs(actor_user_id=actor, model_ids=[model], view="history", page=1, limit=20)
    assert history["items"][0]["jobId"] == queued and history["items"][0]["state"] == "cancelled"
    assert (await repository.get_job(running, actor))["state"] == "running"
    assert (await repository.get_job(other_actor, actor + "-other"))["state"] == "queued"
    assert (await repository.get_job(other_model, actor))["state"] == "queued"


@pytest.mark.asyncio
async def test_live_queue_removal_does_not_deadlock_with_claim_between_task_and_job_locks(owned_jobs):
    pool, repository, actor, _model, queue, admit = owned_jobs
    job_id = await admit()
    task_id = await pool.fetchval("SELECT id FROM semantic_jobs.tasks WHERE job_id = $1::uuid", job_id)
    task_locked = asyncio.Event()
    release_claim = asyncio.Event()

    class PausedConnection:
        def __init__(self, connection):
            self.connection = connection

        def __getattr__(self, name):
            return getattr(self.connection, name)

        async def fetchrow(self, sql, *args):
            row = await self.connection.fetchrow(sql, *args)
            if "UPDATE semantic_jobs.tasks" in sql and row is not None:
                task_locked.set()
                await release_claim.wait()
            return row

    class PausedPool:
        @asynccontextmanager
        async def acquire(self):
            async with pool.acquire() as connection:
                yield PausedConnection(connection)

    claimant = PostgresJobRepository(PausedPool())
    claim = asyncio.create_task(claimant.claim_task(task_id=task_id, queue_name=queue, lease_owner="qa", lease_seconds=120))
    try:
        await asyncio.wait_for(task_locked.wait(), timeout=10)
        # The real claim holds an uncommitted task lock, before its job update. The old
        # job-first cancellation waited on that task and could deadlock the claim.
        removed = await asyncio.wait_for(repository.request_cancel(job_id, actor, only_queued=True), timeout=5)
        assert removed["state"] == "queued"
    finally:
        release_claim.set()
        assert await asyncio.wait_for(claim, timeout=10)
    assert (await repository.get_job(job_id, actor))["state"] == "running"
    assert not await repository.cancel_requested(job_id)
