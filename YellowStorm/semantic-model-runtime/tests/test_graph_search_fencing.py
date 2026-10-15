"""Unit fences and opt-in races on the primary's dedicated disposable F2 DB."""
from contextlib import asynccontextmanager
from types import SimpleNamespace
import asyncio
import time
import os
import uuid
from pathlib import Path
from urllib.parse import urlparse

import pytest
import pytest_asyncio

from app.jobs.models import StaleLease
from app.persistence import graph_search_store as store
from app.workers.graph_search_tasks import run_watched


class Connection:
    def __init__(self, lost=None):
        self.events = []
        self.lost = lost
        self.depth = 0

    @asynccontextmanager
    async def transaction(self):
        self.depth += 1
        try:
            yield
        finally:
            self.depth -= 1

    async def fetchrow(self, sql, *args):
        assert self.depth
        kind = "task" if "semantic_jobs.tasks" in sql else "generation"
        self.events.append(kind)
        assert "FOR UPDATE" in sql
        return None if kind == self.lost else {"id": 1}

    async def executemany(self, sql, rows):
        assert self.depth
        self.events.append("write")

    async def fetchval(self, sql, *args):
        assert self.depth
        return True


@pytest.mark.asyncio
@pytest.mark.parametrize("lost", [None, "task", "generation"])
@pytest.mark.parametrize("kind", ["documents", "passages"])
async def test_vector_batch_locks_task_then_generation_before_any_write(lost, kind):
    connection = Connection(lost)
    ownership = SimpleNamespace(task_id=1, job_id="job", lease_owner="worker", lease_epoch=2)
    token = store._task_ownership.set(ownership)
    try:
        write = store.store_vectors if kind == "documents" else store.store_passage_vectors
        call = write(connection, index_id="ix", model_id="model", fingerprint="f", vectors=[])
        if lost:
            with pytest.raises(StaleLease):
                await call
            assert "write" not in connection.events
        else:
            await call
            assert connection.events == ["task", "generation", "write", "write"]
    finally:
        store._task_ownership.reset(token)
    assert connection.depth == 0


@pytest.mark.asyncio
async def test_task_loss_cancels_silent_step_without_waiting_for_stall():
    cancelled = asyncio.Event()

    async def build():
        try:
            await asyncio.sleep(3600)
        finally:
            cancelled.set()

    class Guard:
        def assert_healthy(self):
            raise StaleLease("lost")

    with pytest.raises(StaleLease):
        await asyncio.wait_for(run_watched(build(), {"at": time.monotonic()}, 600, guard=Guard()), 2)
    assert cancelled.is_set()


@pytest.mark.asyncio
async def test_standalone_batch_checks_generation_without_task():
    connection = Connection("generation")
    token = store._generation_owner.set("standalone")
    try:
        with pytest.raises(StaleLease):
            await store.store_vectors(connection, index_id="ix", model_id="m", fingerprint="f", vectors=[])
    finally:
        store._generation_owner.reset(token)
    assert connection.events == ["generation"]


@pytest_asyncio.fixture
async def f2_db(request):
    import asyncpg

    # CLI override is useful when the harness permits pytest but not env-setting
    # shell commands. No connection URL or credentials are persisted in source.
    dsn = os.getenv("SEMANTIC_F2_TEST_DSN") or request.config._get_override_ini_value("f2_dsn")
    if not dsn:
        pytest.skip("explicit dedicated F2 DSN not supplied")
    target = urlparse(dsn)
    assert target.hostname in ("127.0.0.1", "localhost", "::1")
    assert target.path in ("/semantic_f2_test", "/semantic_p0_test")
    pool = await asyncpg.create_pool(dsn, min_size=1, max_size=4, command_timeout=15)
    try:
        for schema in ("semantic_jobs", "semantic_datasource", "semantic_runtime",
                       "semantic_population", "semantic_graph_search", "semantic_model"):
            await pool.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
        await pool.execute("CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pg_trgm")
        for migration in sorted((Path(__file__).parents[1] / "migrations").glob("*.sql")):
            await pool.execute(migration.read_text(encoding="utf-8"))
        yield pool
    finally:
        await pool.close()


@pytest_asyncio.fixture
async def f2_attempt(f2_db):
    from app.jobs.task_lease_guard import TaskOwnership

    pool = f2_db
    run = uuid.uuid4().hex
    digest = "sha256:" + "0" * 64
    await pool.execute(
        "INSERT INTO semantic_population.data_revisions (id,model_id,model_version_id,spec_hash) "
        "VALUES ($1,$1,'v',$2)", run, digest)
    job = str(await pool.fetchval(
        "INSERT INTO semantic_jobs.jobs (job_type,actor_user_id,idempotency_key,command_hash,command) "
        "VALUES ('graph_search.index','f2',$1,$2,'{}') RETURNING id", run, digest))
    task = await pool.fetchval(
        "INSERT INTO semantic_jobs.tasks (job_id,task_key,task_name,queue_name,payload,state,lease_owner,"
        "lease_epoch,lease_expires_at) VALUES ($1::uuid,'index','index','search','{}','running','old',1,"
        "clock_timestamp()+interval '1 minute') RETURNING id", job)
    generation = await store.create_generation(pool, model_id=run, data_revision_id=run,
        projection_ref="p", spec_hash=digest, fingerprint="f")
    index_id = generation["index_id"]
    await store.set_generation_job(pool, index_id, 1, job)
    assert await store.claim_generation(pool, index_id, "old", 60)
    token = store._task_ownership.set(TaskOwnership(task, job, "old", 1))
    try:
        yield pool, index_id, task, job, run
    finally:
        store._task_ownership.reset(token)
        # Dedicated database; remove only this run's rows/partitions, never other fixtures.
        await pool.execute("DELETE FROM semantic_population.data_revisions WHERE id=$1", run)
        await pool.execute("DELETE FROM semantic_jobs.jobs WHERE id=$1::uuid", job)
        await pool.execute("DELETE FROM semantic_graph_search.embedding_cache WHERE model_id=$1", run)


def document(entity="e"):
    return dict(entityId=entity, conceptId="c", label="record", labelKey="record", sourceWorkspaces=[],
        searchText="record", lexicalText="record", contentHash="sha256:" + "1" * 64,
        exactOnly=False, diagnostics={}, passages=[dict(ordinal=0, fieldKey="f", fieldLabel="F",
        start=0, end=6, text="record", searchText="record", lexicalText="record",
        contentHash="sha256:" + "2" * 64)])


@pytest.mark.asyncio
@pytest.mark.parametrize("loss", ["task_epoch", "task_expired", "generation_owner", "generation_expired"])
async def test_realdb_stale_mutations_never_write_or_mark_ready(f2_attempt, loss):
    pool, ix, task, job, model = f2_attempt
    if loss == "task_epoch":
        await pool.execute("UPDATE semantic_jobs.tasks SET lease_epoch=2 WHERE id=$1", task)
    elif loss == "task_expired":
        await pool.execute("UPDATE semantic_jobs.tasks SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", task)
    elif loss == "generation_owner":
        await pool.execute("UPDATE semantic_graph_search.index_generations SET owner='new' WHERE index_id=$1::uuid", ix)
    else:
        await pool.execute("UPDATE semantic_graph_search.index_generations SET lease_until=clock_timestamp()-interval '1 second' WHERE index_id=$1::uuid", ix)
    calls = [lambda: store.insert_documents(pool, ix, [document()]),
             lambda: store.insert_passages(pool, ix, [document()]),
             lambda: store.store_vectors(pool, index_id=ix, model_id=model, fingerprint="f",
                 vectors=[("e", document()["contentHash"], vector())]),
             lambda: store.store_passage_vectors(pool, index_id=ix, model_id=model, fingerprint="f",
                 vectors=[("e", 0, document()["contentHash"], vector())]),
             lambda: store.renew_generation(pool, ix, "old", 60),
             lambda: store.finish_generation(pool, ix, "old", 0)]
    for call in calls:
        with pytest.raises(StaleLease):
            await call()
    assert await pool.fetchval("SELECT count(*) FROM semantic_graph_search.entity_documents WHERE index_id=$1::uuid", ix) == 0
    assert await pool.fetchval("SELECT count(*) FROM semantic_graph_search.entity_passages WHERE index_id=$1::uuid", ix) == 0
    assert (await store.get_generation_by_id(pool, ix))["state"] == "indexing"
    assert await pool.fetchval("SELECT count(*) FROM semantic_graph_search.embedding_cache WHERE model_id=$1", model) == 0


def vector():
    return "[" + ",".join(["1"] + ["0"] * 2559) + "]"


@pytest.mark.asyncio
async def test_realdb_current_writes_resume_and_finish(f2_attempt):
    from app.jobs.task_lease_guard import TaskOwnership
    pool, ix, task, job, model = f2_attempt
    doc = document()
    vector = "[" + ",".join(["1"] + ["0"] * 2559) + "]"
    await store.insert_documents(pool, ix, [doc])
    await store.insert_passages(pool, ix, [doc])
    await store.store_vectors(pool, index_id=ix, model_id=model, fingerprint="f",
        vectors=[("e", doc["contentHash"], vector)])
    await pool.execute("UPDATE semantic_jobs.tasks SET lease_epoch=2,lease_owner='new' WHERE id=$1", task)
    with pytest.raises(StaleLease):
        await store.adopt_generation(pool, ix, job, "new")
    token = store._task_ownership.set(TaskOwnership(task, job, "new", 2))
    try:
        assert await store.adopt_generation(pool, ix, job, "new")
        assert await store.claim_generation(pool, ix, "new", 60)
        assert await store.pending_documents(pool, ix, 10) == []
        await store.store_passage_vectors(pool, index_id=ix, model_id=model, fingerprint="f",
            vectors=[("e", 0, doc["passages"][0]["contentHash"], vector)])
        assert await store.renew_generation(pool, ix, "new", 60)
        assert await store.finish_generation(pool, ix, "new", 1) == "ready"
    finally:
        store._task_ownership.reset(token)


@pytest.mark.asyncio
@pytest.mark.parametrize("row", ["task", "generation"])
async def test_realdb_replacement_committed_while_batch_waits_is_rechecked(f2_attempt, row):
    pool, ix, task, job, model = f2_attempt
    async with pool.acquire() as blocker, blocker.transaction():
        if row == "task":
            await blocker.execute("UPDATE semantic_jobs.tasks SET lease_epoch=2 WHERE id=$1", task)
        else:
            await blocker.execute("UPDATE semantic_graph_search.index_generations SET owner='new' WHERE index_id=$1::uuid", ix)
        writing = asyncio.create_task(store.insert_documents(pool, ix, [document()]))
        # Prove the write is waiting for a DB row lock before committing replacement.
        for _ in range(100):
            if await pool.fetchval("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock')"):
                break
            await asyncio.sleep(0.01)
        else:
            pytest.fail("write never reached competing row lock")
    with pytest.raises(StaleLease):
        await asyncio.wait_for(writing, 3)
    assert await pool.fetchval("SELECT count(*) FROM semantic_graph_search.entity_documents WHERE index_id=$1::uuid", ix) == 0
    assert (await store.get_generation_by_id(pool, ix))["state"] == "indexing"


@pytest.mark.asyncio
async def test_realdb_batch_cache_failure_rolls_back_document_vectors(f2_attempt):
    import asyncpg
    pool, ix, task, job, model = f2_attempt
    await store.insert_documents(pool, ix, [document()])
    # UPDATE succeeds, then a NULL cache hash violates NOT NULL: whole batch rolls back.
    with pytest.raises(asyncpg.NotNullViolationError):
        await store.store_vectors(pool, index_id=ix, model_id=model, fingerprint="f",
            vectors=[("e", None, vector())])
    assert len(await store.pending_documents(pool, ix, 10)) == 1
    assert await pool.fetchval("SELECT count(*) FROM semantic_graph_search.embedding_cache WHERE model_id=$1", model) == 0


@pytest.mark.asyncio
async def test_realdb_standalone_generation_loss_rejects_batch_and_finish(f2_attempt):
    pool, ix, task, job, model = f2_attempt
    task_token = store._task_ownership.set(None)
    generation_token = store._generation_owner.set("old")
    try:
        await store.insert_documents(pool, ix, [document()])
        await pool.execute("UPDATE semantic_graph_search.index_generations SET owner='new' WHERE index_id=$1::uuid", ix)
        with pytest.raises(StaleLease):
            await store.store_vectors(pool, index_id=ix, model_id=model, fingerprint="f",
                vectors=[("e", document()["contentHash"], vector())])
        with pytest.raises(StaleLease):
            await store.finish_generation(pool, ix, "old", 1)
        assert len(await store.pending_documents(pool, ix, 10)) == 1
        assert (await store.get_generation_by_id(pool, ix))["state"] == "indexing"
    finally:
        store._generation_owner.reset(generation_token)
        store._task_ownership.reset(task_token)


@pytest.mark.asyncio
@pytest.mark.parametrize("expiring", ["task", "generation"])
async def test_realdb_lease_expiring_during_lock_wait_cannot_write(f2_attempt, expiring):
    pool, ix, task, job, model = f2_attempt
    if expiring == "task":
        await pool.execute("UPDATE semantic_jobs.tasks SET lease_expires_at=clock_timestamp()+interval '300 milliseconds' WHERE id=$1", task)
    else:
        await pool.execute("UPDATE semantic_graph_search.index_generations SET lease_until=clock_timestamp()+interval '300 milliseconds' WHERE index_id=$1::uuid", ix)
    async with pool.acquire() as blocker, blocker.transaction():
        await blocker.fetchrow("SELECT index_id FROM semantic_graph_search.index_generations WHERE index_id=$1::uuid FOR UPDATE", ix)
        writing = asyncio.create_task(store.insert_documents(pool, ix, [document()]))
        for _ in range(100):
            if await pool.fetchval("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock')"):
                break
            await asyncio.sleep(0.01)
        else:
            pytest.fail("batch never waited for generation lock")
        await asyncio.sleep(0.35)
    with pytest.raises(StaleLease):
        await asyncio.wait_for(writing, 3)
    assert await pool.fetchval("SELECT count(*) FROM semantic_graph_search.entity_documents WHERE index_id=$1::uuid", ix) == 0
