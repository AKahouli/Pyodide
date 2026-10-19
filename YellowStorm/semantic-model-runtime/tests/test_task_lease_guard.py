from __future__ import annotations

import asyncio
import os
import sys
import threading
import time
from pathlib import Path

import asyncpg
import pytest
import pytest_asyncio

from app.datasource import parser_sandbox
from app.jobs.task_lease_guard import TaskLeaseGuard, TaskLeaseLost, TaskOwnership, lease_windows_from_env
from app.persistence.postgres_jobs import PostgresJobRepository

DSN = os.environ.get("SEMANTIC_RUNTIME_TEST_DATABASE_URL")
GUARD_DSN = os.environ.get("SEMANTIC_RUNTIME_GUARD_TEST_DATABASE_URL", DSN)
pytestmark = pytest.mark.skipif(not (DSN and GUARD_DSN),
                                reason="SEMANTIC_RUNTIME_TEST_DATABASE_URL not set")

QUEUE = "semantic-model-population.batch"


@pytest_asyncio.fixture
async def pool():
    connection = await asyncpg.connect(DSN)
    try:
        for schema in ("semantic_jobs", "semantic_datasource", "semantic_runtime",
                       "semantic_population", "semantic_graph_search", "semantic_model"):
            await connection.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
        from pathlib import Path

        for migration in sorted((Path(__file__).resolve().parents[1] / "migrations").glob("*.sql")):
            await connection.execute(migration.read_text(encoding="utf-8"))
    finally:
        await connection.close()
    value = await asyncpg.create_pool(DSN, min_size=1, max_size=4)
    yield value
    await value.close()


async def claimed(pool: asyncpg.Pool, *, owner: str, lease_seconds: int):
    from app.jobs.models import JobCommand
    from app.jobs.service import JobService

    command = JobCommand.model_validate(
        {"actorUserId": "user-1", "modelId": "11111111-1111-1111-1111-111111111111",
         "payload": {"purpose": "build"}})
    admission = await JobService(PostgresJobRepository(pool)).admit(
        job_type="population.run", command=command, idempotency_key=owner,
        task_name="semantic-model-population.run", queue_name=QUEUE)
    task_id = await pool.fetchval("SELECT id FROM semantic_jobs.tasks WHERE job_id = $1::uuid",
                                  admission.job_id)
    lease = await PostgresJobRepository(pool).claim_task(
        task_id=task_id, queue_name=QUEUE, lease_owner=owner, lease_seconds=lease_seconds)
    assert lease is not None
    return lease


def ownership_of(lease) -> TaskOwnership:  # type: ignore[no-untyped-def]
    return TaskOwnership(task_id=lease.task_id, job_id=lease.job_id,
                         lease_owner=lease.lease_owner, lease_epoch=lease.lease_epoch)


@pytest.mark.asyncio
async def test_a_silent_stage_stays_owned_while_the_guard_renews(pool: asyncpg.Pool):
    lease = await claimed(pool, owner="population-worker:i1:r1", lease_seconds=3)
    guard = TaskLeaseGuard(ownership_of(lease), lease_seconds=3, renew_seconds=0.4, dsn=GUARD_DSN)
    try:
        await guard.start()
        # The stage runs silently far past the lease window: no progress at all.
        await asyncio.sleep(4.5)
        guard.assert_healthy()
        # A competitor cannot take the task, and the owner can still finish.
        competitor = await PostgresJobRepository(pool).claim_task(
            task_id=lease.task_id, queue_name=QUEUE,
            lease_owner="population-worker:i2:r2", lease_seconds=30)
        assert competitor is None
        await PostgresJobRepository(pool).complete_task(
            task_id=lease.task_id, lease_owner=lease.lease_owner, lease_epoch=lease.lease_epoch,
            job_state="completed", result={})
    finally:
        guard.stop()


@pytest.mark.asyncio
async def test_takeover_marks_the_old_guard_lost_irreversibly(pool: asyncpg.Pool):
    repository = PostgresJobRepository(pool)
    lease = await claimed(pool, owner="population-worker:i1:r1", lease_seconds=2)
    guard = TaskLeaseGuard(ownership_of(lease), lease_seconds=6, renew_seconds=0.3, dsn=GUARD_DSN)
    try:
        await guard.start()
        await pool.execute(
            "UPDATE semantic_jobs.tasks SET lease_expires_at = now() - interval '1 second' WHERE id = $1",
            lease.task_id)
        newer = await repository.claim_task(task_id=lease.task_id, queue_name=QUEUE,
                                            lease_owner="population-worker:i2:r2", lease_seconds=30)
        assert newer is not None and newer.lease_epoch > lease.lease_epoch
        # The next renewal returns no row: permanent loss for the old attempt.
        with pytest.raises(asyncio.TimeoutError):
            await asyncio.wait_for(guard._wake.wait() if guard._wake else asyncio.sleep(2), 0.1)
        for _ in range(50):
            if guard.lost_event.is_set():
                break
            await asyncio.sleep(0.1)
        assert guard.lost_event.is_set()
        with pytest.raises(TaskLeaseLost):
            guard.assert_healthy()
        with pytest.raises(TaskLeaseLost):
            await guard.assert_owned()
        # The stale attempt cannot complete either.
        from app.jobs.models import StaleLease

        with pytest.raises(StaleLease):
            await repository.complete_task(task_id=lease.task_id, lease_owner=lease.lease_owner,
                                           lease_epoch=lease.lease_epoch, job_state="completed", result={})
    finally:
        guard.stop()


@pytest.mark.asyncio
async def test_db_outage_past_the_granted_window_fails_closed(pool: asyncpg.Pool):
    """Unverified renewals never prove ownership: once PostgreSQL stays
    unreachable past the granted lease window, the attempt is lost for good -
    and a reachable database afterwards cannot resurrect it."""
    lease = await claimed(pool, owner="population-worker:i1:r1", lease_seconds=3)
    guard = TaskLeaseGuard(ownership_of(lease), lease_seconds=3, renew_seconds=0.3, dsn=GUARD_DSN)
    try:
        await guard.start()
        assert guard.assert_healthy() is None
        # The database stops answering the guard: its live connection is cut
        # and no reconnect can succeed (unavailable longer than the lease).
        victim = await pool.fetchval(
            "SELECT pid FROM pg_stat_activity WHERE application_name = 'semantic-task-lease-guard' "
            "AND datname = current_database()")
        assert victim is not None
        await pool.execute("SELECT pg_terminate_backend($1)", victim)
        guard.dsn = "postgresql://nobody:nobody@127.0.0.1:1/none"
        # The granted window (3 s) passes without a confirmed renewal: lost.
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            if guard.lost_event.is_set():
                break
            await asyncio.sleep(0.2)
        assert guard.lost_event.is_set()
        with pytest.raises(TaskLeaseLost):
            await guard.assert_owned()
        # A reachable database again must not resurrect the lost attempt; the
        # expired lease is recovery's to hand to a fresh owner.
        guard.dsn = GUARD_DSN
        reachable = await pool.fetchval("SELECT 1")
        assert reachable == 1
        with pytest.raises(TaskLeaseLost):
            await guard.assert_owned()
        assert guard.lost_event.is_set()
    finally:
        guard.stop()


@pytest.mark.asyncio
async def test_progress_reports_verify_without_renewing(pool: asyncpg.Pool):
    repository = PostgresJobRepository(pool)
    lease = await claimed(pool, owner="population-worker:i1:r1", lease_seconds=300)
    before = await pool.fetchval(
        "SELECT lease_expires_at FROM semantic_jobs.tasks WHERE id = $1", lease.task_id)
    assert await repository.checkpoint(task_id=lease.task_id, lease_owner=lease.lease_owner,
                                       lease_epoch=lease.lease_epoch, progress={"phase": "reading"},
                                       lease_seconds=300, renew=False)
    stored = await pool.fetchval(
        "SELECT checkpoint->>'phase' FROM semantic_jobs.tasks WHERE id = $1", lease.task_id)
    assert stored == "reading"
    after = await pool.fetchval(
        "SELECT lease_expires_at FROM semantic_jobs.tasks WHERE id = $1", lease.task_id)
    assert after == before  # the guard alone moves the expiry
    # Still fenced: a stale attempt cannot even report.
    assert not await repository.checkpoint(task_id=lease.task_id, lease_owner="someone-else",
                                           lease_epoch=lease.lease_epoch, progress={},
                                           lease_seconds=300, renew=False)


@pytest.mark.asyncio
async def test_periodic_and_explicit_checks_share_one_connection_operation(pool: asyncpg.Pool):
    lease = await claimed(pool, owner="guard-overlap", lease_seconds=3)
    guard = TaskLeaseGuard(ownership_of(lease), lease_seconds=3, renew_seconds=0.001, dsn=GUARD_DSN)
    original = guard._renew_once
    active = peak = calls = 0

    async def observed(connection):
        nonlocal active, peak, calls
        active += 1
        peak = max(peak, active)
        calls += 1
        try:
            # An actual asynchronous PostgreSQL operation creates an overlap
            # opportunity on every periodic/explicit pair, not just a sleep.
            await connection.execute("SELECT pg_sleep(0.002)")
            return await original(connection)
        finally:
            active -= 1

    guard._renew_once = observed
    try:
        await guard.start()
        for _ in range(100):
            await asyncio.wait_for(asyncio.gather(guard.assert_owned(), guard.assert_owned()), 5)
        assert calls >= 201
        assert peak == 1
        guard.assert_healthy()
    finally:
        guard.stop()


@pytest.mark.asyncio
async def test_unverified_assertion_times_out_and_reconnects_before_expiry(pool, monkeypatch):
    import app.jobs.task_lease_guard as module

    lease = await claimed(pool, owner="guard-unverified", lease_seconds=3)
    guard = TaskLeaseGuard(ownership_of(lease), lease_seconds=3, renew_seconds=0.1, dsn=GUARD_DSN)
    try:
        await guard.start()
        await guard.assert_owned()
        monkeypatch.setattr(module, "_RENEW_TIMEOUT_SECONDS", 0.1)
        async with pool.acquire() as blocker, blocker.transaction():
            await blocker.fetchrow("SELECT id FROM semantic_jobs.tasks WHERE id=$1 FOR UPDATE", lease.task_id)
            with pytest.raises(TaskLeaseLost):
                await guard.assert_owned()
        # A failed assertion never authorizes its caller's side effect. A later
        # assertion may succeed only with a fresh, real DB check before expiry.
        monkeypatch.setattr(module, "_RENEW_TIMEOUT_SECONDS", 2)
        await guard.assert_owned()
        assert not guard.lost_event.is_set()
    finally:
        guard.stop()


@pytest.mark.asyncio
async def test_stop_cancels_inflight_query_is_idempotent_and_never_renews_again(pool):
    lease = await claimed(pool, owner="guard-stop", lease_seconds=3)
    guard = TaskLeaseGuard(ownership_of(lease), lease_seconds=3, renew_seconds=0.1, dsn=GUARD_DSN)
    try:
        await guard.start()
        await guard.assert_owned()
        thread = guard._thread
        async with pool.acquire() as blocker, blocker.transaction():
            await blocker.fetchrow("SELECT id FROM semantic_jobs.tasks WHERE id=$1 FOR UPDATE", lease.task_id)
            check = asyncio.create_task(guard.assert_owned())
            async with asyncio.timeout(5):
                while not await pool.fetchval(
                    "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name="
                    "'semantic-task-lease-guard' AND datname=current_database() AND wait_event_type='Lock')"):
                    await asyncio.sleep(0.01)
            await asyncio.to_thread(guard.stop)
            with pytest.raises(TaskLeaseLost):
                await check
        guard.stop()
        assert not thread.is_alive()
        assert guard._connection is None
        before = await pool.fetchval("SELECT lease_expires_at FROM semantic_jobs.tasks WHERE id=$1", lease.task_id)
        await asyncio.sleep(0.2)
        assert before == await pool.fetchval("SELECT lease_expires_at FROM semantic_jobs.tasks WHERE id=$1", lease.task_id)
        with pytest.raises(TaskLeaseLost):
            await guard.assert_owned()
        with pytest.raises(TaskLeaseLost):
            await guard.start()
    finally:
        guard.stop()


def test_lease_windows_from_env_are_bounded():
    lease, renew = lease_windows_from_env({"SEMANTIC_TASK_LEASE_SECONDS": "180",
                                           "SEMANTIC_TASK_LEASE_RENEW_SECONDS": "20"})
    assert (lease, renew) == (180, 20.0)
    # A renewal window above a third of the lease is clamped, never allowed.
    lease, renew = lease_windows_from_env({"SEMANTIC_TASK_LEASE_SECONDS": "30",
                                           "SEMANTIC_TASK_LEASE_RENEW_SECONDS": "29"})
    assert renew <= lease / 3


@pytest.fixture
def slow_parser(monkeypatch: pytest.MonkeyPatch):
    """A parser child that hangs, so a mid-flight stop can be observed."""
    monkeypatch.setattr(parser_sandbox, "_parser_command",
                        lambda: [sys.executable, "-c", "import time; time.sleep(30)"])
    spawned: list = []
    original = parser_sandbox.subprocess.Popen

    def spy(*args, **kwargs):  # type: ignore[no-untyped-def]
        process = original(*args, **kwargs)
        spawned.append(process)
        return process
    monkeypatch.setattr(parser_sandbox.subprocess, "Popen", spy)
    return spawned


PARSER_SOURCE = {
    "workspaceId": "6512f0a1c9e77a001234aaa1",
    "assetId": "6512f0a1c9e77a001234bbb2",
    "mimeType": "text/csv",
    "sizeBytes": 16,
    "contentHash": "0123456789abcdef0123456789abcdef",
    "uploadedAt": "2026-09-20T12:00:00.000Z",
    "indexingStatus": "ready",
}


def test_a_stopped_parser_loses_its_whole_child_tree_and_confirms_exit(
        tmp_path: Path, slow_parser: list, monkeypatch: pytest.MonkeyPatch):
    source = dict(PARSER_SOURCE)
    stop = threading.Event()
    result: list = []

    def run() -> None:
        try:
            parser_sandbox.prepare_dataset_subprocess(source, None, b"a,b\n1,2\n", tmp_path / "out.parquet", stop_event=stop)
        except BaseException as exc:  # the stop surfaces as ParserStopped
            result.append(exc)
    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    time.sleep(0.5)  # the child is up and hanging inside its parse
    assert slow_parser and slow_parser[0].poll() is None
    stop.set()
    thread.join(timeout=15)
    assert not thread.is_alive()
    assert isinstance(result[0], parser_sandbox.ParserStopped)
    # Confirmed exit: nothing is left to publish effects after ownership loss.
    assert slow_parser[0].poll() is not None


def test_a_parse_ignores_a_stop_that_never_comes(tmp_path: Path):
    source = dict(PARSER_SOURCE)
    stop = threading.Event()
    result = parser_sandbox.prepare_dataset_subprocess(
        source, None, b"a,b\n1,2\n", tmp_path / "out.parquet", stop_event=stop)
    assert isinstance(result, dict)
