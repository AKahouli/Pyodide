"""F3 races. DB cases require an explicitly provisioned, migrated isolated DB.

No default DSN, migrations, DROP SCHEMA or shared baseline fixtures are used.
Stale-epoch coverage is reused from test_p0_baseline_races.py::test_f03_stale_attempt_cannot_activate_the_draft_binding.
"""
from __future__ import annotations

import asyncio
import os
from contextlib import asynccontextmanager
from uuid import uuid4

import asyncpg
import pytest
import pytest_asyncio

from app.jobs.models import JobCommand, StaleLease
from app.persistence import population_store as store
from app.persistence.postgres_jobs import CandidateRejected, PostgresJobRepository


@pytest.mark.asyncio
async def test_cutover_lock_uses_transaction_connection_and_exact_namespace():
    calls = []

    class Connection:
        @asynccontextmanager
        async def transaction(self):
            calls.append("begin")
            yield
            calls.append("commit")

        async def execute(self, sql, key):
            assert sql == "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))"
            calls.append(key)

    async with store.model_cutover_transaction(Connection(), "model-a"):
        calls.append("write")
    assert calls == ["begin", "semantic:model:cutover:model-a", "write", "commit"]


@pytest.mark.asyncio
async def test_clone_activation_uses_same_short_transaction_protocol():
    from app.persistence.model_clone_store import activate_cloned_revision

    calls = []

    class Connection:
        @asynccontextmanager
        async def transaction(self):
            calls.append("begin")
            yield
            calls.append("commit")

        async def execute(self, sql, *args):
            if "pg_advisory_xact_lock" in sql:
                assert args == ("semantic:model:cutover:clone",)
                calls.append("lock")
            else:
                assert "INSERT INTO semantic_runtime.active_bindings" in sql
                calls.append("insert")

    await activate_cloned_revision(
        Connection(), model_id="clone", model_version_id="v1", revision_id="dr_test",
        projection_ref="age:v2:test", correction_sequence=0)
    assert calls == ["begin", "lock", "insert", "commit"]


@pytest_asyncio.fixture
async def isolated_pool(monkeypatch):
    dsn = os.environ.get("SEMANTIC_F3_ISOLATED_DATABASE_URL")
    if not dsn:
        pytest.skip("Primary must supply SEMANTIC_F3_ISOLATED_DATABASE_URL for migrated isolated DB")
    from scripts.migrate import migrate

    connection = await asyncpg.connect(dsn)
    try:
        await connection.execute("CREATE EXTENSION IF NOT EXISTS vector")
        # Existing baseline fixtures apply all migrations without bookkeeping.
        # Do not replay non-idempotent historical migrations over that schema.
        populated = await connection.fetchval(
            "SELECT to_regclass('semantic_population.data_revisions') IS NOT NULL")
    finally:
        await connection.close()
    monkeypatch.setenv("SEMANTIC_RUNTIME_DATABASE_URL", dsn)
    if not populated:
        await migrate()
    pool = await asyncpg.create_pool(dsn, min_size=1, max_size=6)
    try:
        yield pool
    finally:
        await pool.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("operation", ["correction", "specification"])
async def test_writers_lock_before_insert_and_commit_after(monkeypatch, operation):
    calls = []

    class Connection:
        @asynccontextmanager
        async def transaction(self):
            calls.append("begin")
            yield
            calls.append("commit")

        async def execute(self, sql, key):
            assert "pg_advisory_xact_lock" in sql
            assert key == "semantic:model:cutover:m1"
            calls.append("lock")

        async def fetchrow(self, sql, *args):
            assert "INSERT INTO" in sql
            calls.append("insert")
            return {"sequence": 1, "id": "s1"}

    class Pool:
        @asynccontextmanager
        async def acquire(self):
            yield Connection()

    if operation == "correction":
        assert await store.record_correction(
            Pool(), model_id="m1", model_version_id="v1", actor_user_id="u1",
            reason="test", target_identity={"id": "x"}, action="edit_entity") == 1
    else:
        assert await store.mirror_specification(
            Pool(), home_workspace_id="w1", model_id="m1", model_version_id="v1",
            spec_hash="hash", specification={}, select_current=True) == "s1"
    assert calls == ["begin", "lock", "insert", "commit"]


@pytest.mark.asyncio
@pytest.mark.parametrize("writer", ["correction", "specification"])
@pytest.mark.parametrize("writer_first", [True, False])
async def test_commits_serialize_with_fenced_cutover(isolated_pool, monkeypatch, writer, writer_first):
    pool = isolated_pool
    model = str(uuid4())
    revision = "dr_" + uuid4().hex[:24]
    spec = "sha256:" + "1" * 64
    repository = PostgresJobRepository(pool)
    command = JobCommand.model_validate({"actorUserId": "f3-" + model, "modelId": model,
                                         "payload": {"purpose": "build"}})
    admission = await repository.admit(
        job_type="population.run", command=command, idempotency_key=model,
        command_hash=spec, task_name="semantic-model-population.run", queue_name="f3-test")
    job = admission.job_id
    task_id = await pool.fetchval("SELECT id FROM semantic_jobs.tasks WHERE job_id=$1::uuid", job)
    claim = await repository.claim_task(task_id=task_id, queue_name="f3-test",
                                        lease_owner=model, lease_seconds=300)
    assert claim is not None
    tasks = []
    try:
        await store.mirror_specification(pool, home_workspace_id=model, model_id=model,
                                         model_version_id="v1", spec_hash=spec, specification={})
        await store.create_data_revision(
            pool, revision_id=revision, model_id=model, model_version_id="v1", spec_hash=spec,
            execution_fingerprint=spec, source_observations=[], correction_sequence=0, coverage={})
        await store.set_revision_validation(pool, revision, "valid")
        await store.set_revision_projection(pool, revision, "age:v2:f3")
        activate = {"modelId": model, "modelVersionId": "v1", "revisionId": revision,
                    "projectionRef": "age:v2:f3", "specHash": spec,
                    "correctionSequence": 0, "expectedVersion": None}
        held, blocked, release = asyncio.Event(), asyncio.Event(), asyncio.Event()
        original = store.lock_model_cutover
        entrants = 0

        async def gated(connection, model_id):
            nonlocal entrants
            entrants += 1
            position = entrants
            if position == 2:
                # Real PostgreSQL proves the second transaction cannot enter;
                # no timing/sleep assumption about whether it reached the lock.
                acquired = await connection.fetchval(
                    "SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0))",
                    f"semantic:model:cutover:{model_id}")
                assert acquired is False
                blocked.set()
            await original(connection, model_id)
            if position == 1:
                held.set()
                await asyncio.wait_for(release.wait(), 10)

        monkeypatch.setattr(store, "lock_model_cutover", gated)

        async def write():
            if writer == "correction":
                return await store.record_correction(
                    pool, model_id=model, model_version_id="v1", actor_user_id=model,
                    reason="F3 race", target_identity={"id": model}, action="edit_entity", payload={})
            return await store.mirror_specification(
                pool, home_workspace_id=model, model_id=model, model_version_id="v1",
                spec_hash="sha256:" + "2" * 64, specification={}, select_current=True)

        async def finalize():
            return await repository.finalize_population_task(
                task_id=task_id, lease_owner=model, lease_epoch=claim.lease_epoch,
                job_state="completed", result={}, activate=activate)

        tasks.append(asyncio.create_task(write() if writer_first else finalize()))
        await asyncio.wait_for(held.wait(), 10)
        tasks.append(asyncio.create_task(finalize() if writer_first else write()))
        await asyncio.wait_for(blocked.wait(), 10)
        assert not tasks[1].done()
        # A different model can acquire its mutex while both contend on this one.
        async with pool.acquire() as connection:
            async with connection.transaction():
                await asyncio.wait_for(original(connection, str(uuid4())), 2)
        release.set()
        outcomes = await asyncio.wait_for(asyncio.gather(*tasks, return_exceptions=True), 10)
        assert not isinstance(outcomes[0], BaseException)
        if writer_first:
            assert isinstance(outcomes[1], CandidateRejected)
            assert await store.get_active_binding(pool, model, "draft") is None
            assert await pool.fetchval("SELECT state FROM semantic_jobs.jobs WHERE id=$1::uuid", job) == "running"
        else:
            assert not isinstance(outcomes[1], BaseException)
            binding = await store.get_active_binding(pool, model, "draft")
            assert binding["data_revision_id"] == revision
            assert await pool.fetchval("SELECT state FROM semantic_jobs.jobs WHERE id=$1::uuid", job) == "completed"
    finally:
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        # Only this run's unique data, using the existing partition-aware cleanup.
        monkeypatch.undo()
        await pool.execute("UPDATE semantic_jobs.jobs SET state='failed' WHERE id=$1::uuid AND state='running'", job)
        await store.delete_model(pool, model)


@pytest.mark.asyncio
@pytest.mark.parametrize("delay_at", ["cutover_lock", "cas"])
async def test_expired_lease_after_lock_or_cas_rolls_back(isolated_pool, monkeypatch, delay_at):
    pool = isolated_pool
    model, revision = str(uuid4()), "dr_" + uuid4().hex[:24]
    spec = "sha256:" + "3" * 64
    repository = PostgresJobRepository(pool)
    admission = await repository.admit(
        job_type="population.run", command=JobCommand.model_validate(
            {"actorUserId": model, "modelId": model, "payload": {"purpose": "build"}}),
        idempotency_key=model, command_hash=spec,
        task_name="semantic-model-population.run", queue_name="f3-expiry")
    job = admission.job_id
    task_id = await pool.fetchval("SELECT id FROM semantic_jobs.tasks WHERE job_id=$1::uuid", job)
    claim = await repository.claim_task(task_id=task_id, queue_name="f3-expiry",
                                       lease_owner=model, lease_seconds=300)
    running = None
    try:
        await store.mirror_specification(pool, home_workspace_id=model, model_id=model,
                                        model_version_id="v1", spec_hash=spec, specification={})
        await store.create_data_revision(
            pool, revision_id=revision, model_id=model, model_version_id="v1", spec_hash=spec,
            execution_fingerprint=spec, source_observations=[], correction_sequence=0, coverage={})
        await store.set_revision_validation(pool, revision, "valid")
        await store.set_revision_projection(pool, revision, "age:v2:f3-expiry")
        activation = {"modelId": model, "modelVersionId": "v1", "revisionId": revision,
                      "projectionRef": "age:v2:f3-expiry", "specHash": spec,
                      "correctionSequence": 0, "expectedVersion": None}
        entered = asyncio.Event()
        original_lock, original_cas = store.lock_model_cutover, store._cas_active_binding

        async def short_lease(connection):
            await connection.execute(
                "UPDATE semantic_jobs.tasks SET lease_expires_at=clock_timestamp() + "
                "interval '100 milliseconds' WHERE id=$1", task_id)

        async def gated_lock(connection, model_id):
            # Task/job locks are already held, preventing concurrent renewal.
            await short_lease(connection)
            entered.set()
            await original_lock(connection, model_id)

        async def delayed_cas(connection, **kwargs):
            await short_lease(connection)
            result = await original_cas(connection, **kwargs)
            assert result is not None
            await connection.execute("SELECT pg_sleep(0.5)")
            return result

        async with pool.acquire() as blocker:
            async with blocker.transaction():
                if delay_at == "cutover_lock":
                    await original_lock(blocker, model)
                    monkeypatch.setattr(store, "lock_model_cutover", gated_lock)
                else:
                    monkeypatch.setattr(store, "_cas_active_binding", delayed_cas)
                running = asyncio.create_task(repository.finalize_population_task(
                    task_id=task_id, lease_owner=model, lease_epoch=claim.lease_epoch,
                    job_state="completed", result={}, activate=activation))
                if delay_at == "cutover_lock":
                    await asyncio.wait_for(entered.wait(), 5)
                    await blocker.execute("SELECT pg_sleep(0.5)")
                    assert not running.done()
        with pytest.raises(StaleLease):
            await asyncio.wait_for(running, 5)
        assert await store.get_active_binding(pool, model, "draft") is None
        assert await pool.fetchval("SELECT state FROM semantic_jobs.tasks WHERE id=$1", task_id) == "running"
        assert await pool.fetchval("SELECT state FROM semantic_jobs.jobs WHERE id=$1::uuid", job) == "running"
        assert await pool.fetchval(
            "SELECT count(*) FROM semantic_jobs.events WHERE job_id=$1::uuid AND event_type='job.completed'", job) == 0
    finally:
        if running is not None:
            if not running.done():
                running.cancel()
            await asyncio.gather(running, return_exceptions=True)
        monkeypatch.undo()
        await pool.execute("UPDATE semantic_jobs.jobs SET state='failed' WHERE id=$1::uuid", job)
        await store.delete_model(pool, model)
