from __future__ import annotations

import asyncio
import os
from pathlib import Path

import asyncpg
import pytest
import pytest_asyncio

from app.jobs.models import StaleLease
from app.jobs.service import JobService
from app.persistence import population_store as store
from app.persistence.postgres_jobs import PostgresJobRepository

DSN = os.environ.get("SEMANTIC_RUNTIME_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DSN, reason="SEMANTIC_RUNTIME_TEST_DATABASE_URL not set")
MIGRATIONS = sorted((Path(__file__).resolve().parents[1] / "migrations").glob("*.sql"))

# P0-00 (plan section 1): deterministic races for findings F01-F03 and the
# claim/cancel lock-order question. Each test states the safety contract the
# P0 patches must establish on real PostgreSQL semantics, not the incidental
# behaviour of the audited baseline (a3c4362f).

QUEUE = "semantic-model-population.batch"


@pytest_asyncio.fixture
async def pool():
    assert DSN
    connection = await asyncpg.connect(DSN)
    try:
        for schema in ("semantic_jobs", "semantic_datasource", "semantic_runtime",
                       "semantic_population", "semantic_graph_search", "semantic_model"):
            await connection.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
        for migration in MIGRATIONS:
            await connection.execute(migration.read_text(encoding="utf-8"))
    finally:
        await connection.close()
    value = await asyncpg.create_pool(DSN, min_size=1, max_size=6)
    yield value
    await value.close()


async def admit_job(pool: asyncpg.Pool, key: str = "p0") -> str:
    from app.jobs.models import JobCommand

    command = JobCommand.model_validate(
        {"actorUserId": "user-1", "modelId": "11111111-1111-1111-1111-111111111111",
         "payload": {"purpose": "build"}})
    admission = await JobService(PostgresJobRepository(pool)).admit(
        job_type="population.run", command=command, idempotency_key=key,
        task_name="semantic-model-population.run", queue_name=QUEUE)
    return admission.job_id


async def task_id_of(pool: asyncpg.Pool, job_id: str) -> int:
    return await pool.fetchval("SELECT id FROM semantic_jobs.tasks WHERE job_id = $1::uuid", job_id)


async def lease_row(pool: asyncpg.Pool, task_id: int) -> asyncpg.Record:
    return await pool.fetchrow(
        "SELECT state, lease_owner, lease_epoch, lease_expires_at FROM semantic_jobs.tasks WHERE id = $1",
        task_id)


# --- F01: two live workers sharing a host name must not evict each other (I2) ---

def test_f01_no_code_path_expires_leases_by_a_host_name_prefix():
    """The audited baseline expired every live lease under a Celery host-name
    prefix at boot, so two instances sharing the name evicted each other. P0-01
    removes that path: ownership is keyed by per-process identities and ended
    only by real lease expiry."""
    from app.persistence.postgres_jobs import PostgresJobRepository

    assert not hasattr(PostgresJobRepository, "release_abandoned_leases")
    import app.workers.graph_search_tasks as search_tasks
    import app.workers.population_tasks as population_tasks

    for module in (population_tasks, search_tasks):
        source_names = {name for name in dir(module) if "abandoned" in name or "boot_prefix" in name}
        assert source_names == set(), source_names


@pytest.mark.asyncio
async def test_f01_second_instance_boot_leaves_first_instance_lease_intact(pool: asyncpg.Pool):
    """Worker A holds a live claim under instance identity IA. Worker B boots on
    the same host with instance identity IB and registers its heartbeat. A's
    lease (owner, epoch, expiry) must be untouched: a boot identity is not
    evidence that another live instance is dead."""
    from app.jobs.worker_liveness import UPSERT_HEARTBEAT_SQL

    job_id = await admit_job(pool)
    task_id = await task_id_of(pool, job_id)
    repository = PostgresJobRepository(pool)
    owner_a = "population-worker:instance-aaaa:run-1"
    claim = await repository.claim_task(task_id=task_id, queue_name=QUEUE,
                                        lease_owner=owner_a, lease_seconds=300)
    assert claim is not None
    await pool.execute(UPSERT_HEARTBEAT_SQL, owner_a, [QUEUE], 4241)
    before = await lease_row(pool, task_id)

    # B's whole boot: its own heartbeat row. Nothing else is written at boot.
    await pool.execute(UPSERT_HEARTBEAT_SQL, "population-worker:instance-bbbb", [QUEUE], 4242)

    after = await lease_row(pool, task_id)
    assert dict(after) == dict(before)
    online = await pool.fetchval(
        "SELECT count(*) FROM semantic_jobs.worker_heartbeats "
        "WHERE $1 = ANY(queues) AND last_seen > now() - make_interval(secs => 45)", QUEUE)
    assert online == 2


# --- F02: a silent long stage must not lose a healthy lease it could have kept (I3) ---
# Repository-level contract used by the P0-02 guard: past the lease window with
# no renewal, ownership is gone for the attempt even though its operation still
# runs. The guard's own tests (test_task_lease_guard.py) assert that a healthy
# silent stage stays owned once the independent renewal loop exists.

@pytest.mark.asyncio
async def test_f02_lease_past_its_window_is_gone_to_its_owner_while_work_continues(pool: asyncpg.Pool):
    job_id = await admit_job(pool)
    task_id = await task_id_of(pool, job_id)
    repository = PostgresJobRepository(pool)
    claim = await repository.claim_task(task_id=task_id, queue_name=QUEUE,
                                        lease_owner="population-worker:i1:r1", lease_seconds=2)
    assert claim is not None
    # The stage keeps "running" (this await is the stage); it reports no progress.
    await asyncio.sleep(2.4)
    renewed = await repository.checkpoint(
        task_id=task_id, lease_owner="population-worker:i1:r1", lease_epoch=claim.lease_epoch,
        progress={"phase": "reading"}, lease_seconds=900)
    assert renewed is False
    with pytest.raises(StaleLease):
        await repository.complete_task(task_id=task_id, lease_owner="population-worker:i1:r1",
                                       lease_epoch=claim.lease_epoch, job_state="completed", result={})


# --- F03: a stale attempt must not reach serving side effects (I4, I5) ---

@pytest.mark.asyncio
async def test_f03_stale_attempt_cannot_activate_the_draft_binding(pool: asyncpg.Pool):
    """A claims, loses its lease, B reclaims with a higher epoch. A then reaches
    the finalization path. The atomic finalization must refuse A (its lease is
    gone), leave the draft binding untouched, and let B alone cut over."""
    from app.persistence.postgres_jobs import CandidateRejected

    job_id = await admit_job(pool)
    task_id = await task_id_of(pool, job_id)
    repository = PostgresJobRepository(pool)
    owner_a, owner_b = "population-worker:i-a:r1", "population-worker:i-b:r2"
    claim_a = await repository.claim_task(task_id=task_id, queue_name=QUEUE,
                                          lease_owner=owner_a, lease_seconds=300)
    assert claim_a is not None
    # A goes silent past its lease; recovery lets B take over with a higher epoch.
    await pool.execute("UPDATE semantic_jobs.tasks SET lease_expires_at = now() - interval '1 second' WHERE id = $1", task_id)
    claim_b = await repository.claim_task(task_id=task_id, queue_name=QUEUE,
                                          lease_owner=owner_b, lease_seconds=300)
    assert claim_b is not None and claim_b.lease_epoch > claim_a.lease_epoch

    model_id = "11111111-1111-1111-1111-111111111111"
    revision_id = await store.create_data_revision(
        pool, revision_id="dr_p0f03stale00000000000001", model_id=model_id,
        model_version_id="v1", spec_hash="sha256:" + "0" * 64,
        execution_fingerprint="sha256:" + "1" * 64, source_observations=[],
        correction_sequence=0, coverage={})
    await store.set_revision_validation(pool, revision_id, "valid")
    await store.set_revision_projection(pool, revision_id, "age:v2:pop_p0f03")
    # The binding CAS also checks the mirrored specification for the version.
    await store.mirror_specification(pool, home_workspace_id="w1", model_id=model_id,
                                     model_version_id="v1", spec_hash="sha256:" + "0" * 64,
                                     specification={})
    activation = {"environment": "draft", "revisionId": revision_id, "jobId": job_id,
                  "projectionRef": "age:v2:pop_p0f03", "modelId": model_id,
                  "modelVersionId": "v1", "specHash": "sha256:" + "0" * 64,
                  "correctionSequence": 0, "expectedVersion": None}

    # A's finalization: refused on its stale lease, in one rolled-back transaction.
    with pytest.raises(StaleLease):
        await repository.finalize_population_task(
            task_id=task_id, lease_owner=owner_a, lease_epoch=claim_a.lease_epoch,
            job_state="completed", result={"n": 1}, activate=activation)
    assert await store.get_active_binding(pool, model_id, "draft") is None
    assert await pool.fetchval("SELECT state FROM semantic_jobs.jobs WHERE id = $1::uuid", job_id) == "running"

    # B, the current owner, cuts over and terminals the job in the same commit.
    outcome = await repository.finalize_population_task(
        task_id=task_id, lease_owner=owner_b, lease_epoch=claim_b.lease_epoch,
        job_state="completed", result={"n": 1}, activate=activation)
    assert outcome["activated"] is True
    binding = await store.get_active_binding(pool, model_id, "draft")
    assert binding is not None and binding["data_revision_id"] == revision_id
    assert await pool.fetchval("SELECT state FROM semantic_jobs.jobs WHERE id = $1::uuid", job_id) == "completed"
    events = await pool.fetchval(
        "SELECT count(*) FROM semantic_jobs.events WHERE job_id = $1::uuid AND event_type = 'job.completed'",
        job_id)
    assert events == 1


@pytest.mark.asyncio
async def test_f03_a_candidate_stale_against_newer_state_rolls_the_cutover_back(pool: asyncpg.Pool):
    """A correction or a newer definition that arrived while the candidate was
    built must not be overwritten: the finalization rolls back completely and
    the job stays open for a fresh attempt."""
    from app.persistence.postgres_jobs import CandidateRejected

    job_id = await admit_job(pool)
    task_id = await task_id_of(pool, job_id)
    repository = PostgresJobRepository(pool)
    owner = "population-worker:i-a:r1"
    claim = await repository.claim_task(task_id=task_id, queue_name=QUEUE,
                                        lease_owner=owner, lease_seconds=300)
    assert claim is not None
    model_id = "11111111-1111-1111-1111-111111111111"
    revision_id = await store.create_data_revision(
        pool, revision_id="dr_p0f03older0000000000001", model_id=model_id,
        model_version_id="v1", spec_hash="sha256:" + "0" * 64,
        execution_fingerprint="sha256:" + "1" * 64, source_observations=[],
        correction_sequence=0, coverage={})
    await store.set_revision_validation(pool, revision_id, "valid")
    await store.set_revision_projection(pool, revision_id, "age:v2:pop_p0f03b")
    # A correction arrived after the run read the model: the watermark moved.
    stale_activation = {"environment": "draft", "revisionId": revision_id, "jobId": job_id,
                        "projectionRef": "age:v2:pop_p0f03b", "modelId": model_id,
                        "modelVersionId": "v1", "specHash": "sha256:" + "0" * 64,
                        "correctionSequence": 0, "expectedVersion": None}
    with pytest.raises(CandidateRejected):
        await repository.finalize_population_task(
            task_id=task_id, lease_owner=owner, lease_epoch=claim.lease_epoch,
            job_state="completed", result={}, activate=stale_activation)
    assert await store.get_active_binding(pool, model_id, "draft") is None
    assert await pool.fetchval("SELECT state FROM semantic_jobs.jobs WHERE id = $1::uuid", job_id) == "running"
    assert await pool.fetchval("SELECT state FROM semantic_jobs.tasks WHERE id = $1", task_id) == "running"

# --- P0-05: default request_cancel versus claim_task must not deadlock ---

class _GateConnection:
    """Claims the task row, then pauses before the job update so a concurrent
    cancel can take the job lock: the exact interleaving of the suspected
    claim/cancel deadlock."""


    def __init__(self, connection: asyncpg.Connection, entered: asyncio.Event,
                 proceed: asyncio.Event):
        self._connection = connection
        self._entered = entered
        self._proceed = proceed

    async def execute(self, sql, *args):
        if sql.lstrip().upper().startswith("UPDATE SEMANTIC_JOBS.JOBS"):
            self._entered.set()
            await asyncio.wait_for(self._proceed.wait(), 20)
        return await self._connection.execute(sql, *args)

    async def fetchrow(self, sql, *args):
        return await self._connection.fetchrow(sql, *args)

    async def fetchval(self, sql, *args):
        return await self._connection.fetchval(sql, *args)

    async def fetch(self, sql, *args):
        return await self._connection.fetch(sql, *args)

    def transaction(self):
        return self._connection.transaction()

    def __getattr__(self, name):
        return getattr(self._connection, name)


class _GatePool:
    def __init__(self, pool: asyncpg.Pool, entered: asyncio.Event, proceed: asyncio.Event):
        self._pool = pool
        self._entered = entered
        self._proceed = proceed

    def acquire(self):
        outer = self

        class _Ctx:
            async def __aenter__(self):
                self._connection_cm = outer._pool.acquire()
                connection = await self._connection_cm.__aenter__()
                return _GateConnection(connection, outer._entered, outer._proceed)

            async def __aexit__(self, *exc):
                return await self._connection_cm.__aexit__(*exc)

        return _Ctx()

    def __getattr__(self, name):
        return getattr(self._pool, name)


@pytest.mark.asyncio
@pytest.mark.parametrize("only_queued", [False, True])
@pytest.mark.parametrize("initially_running", [False, True])
async def test_p05_cancel_racing_a_claim_does_not_deadlock(pool: asyncpg.Pool, only_queued, initially_running):
    job_id = await admit_job(pool)
    task_id = await task_id_of(pool, job_id)
    repository = PostgresJobRepository(pool)
    if initially_running:
        claim = await repository.claim_task(task_id=task_id, queue_name=QUEUE,
                                            lease_owner="population-worker:i-dead:r1", lease_seconds=300)
        assert claim is not None
        # Race both a fresh queued claim and reclaiming an expired attempt.
        await pool.execute("UPDATE semantic_jobs.tasks SET lease_expires_at = now() - interval '1 second' WHERE id = $1", task_id)

    entered, proceed = asyncio.Event(), asyncio.Event()
    gated = PostgresJobRepository(_GatePool(pool, entered, proceed))

    async def claim_again():
        try:
            lease = await asyncio.wait_for(
                gated.claim_task(task_id=task_id, queue_name=QUEUE,
                                 lease_owner="population-worker:i-new:r2", lease_seconds=300), 20)
            return ("claim", None, lease)
        except Exception as exc:
            return ("claim", exc, None)

    async def cancel():
        try:
            job = await asyncio.wait_for(repository.request_cancel(job_id, "user-1", only_queued=only_queued), 20)
            return ("cancel", None, job)
        except Exception as exc:
            return ("cancel", exc, None)

    claim_task = asyncio.ensure_future(claim_again())
    await asyncio.wait_for(entered.wait(), 10)
    cancel_task = asyncio.ensure_future(cancel())
    try:
        # Cancellation must commit without waiting for the locked task, before
        # the claimant may continue to its job update: deterministic ordering.
        await asyncio.wait_for(asyncio.shield(cancel_task), 5)
    finally:
        proceed.set()
    (who_c, error_c, lease), (who_x, error_x, job) = await asyncio.gather(claim_task, cancel_task)

    deadlock = [error for error in (error_c, error_x)
                if error is not None and error.__class__.__name__ == "DeadlockDetectedError"]
    assert deadlock == [], f"claim/cancel interleaving deadlocked: {error_c!r} / {error_x!r}"
    assert error_c is None and error_x is None, (error_c, error_x)
    state = await pool.fetchval("SELECT state FROM semantic_jobs.jobs WHERE id = $1::uuid", job_id)
    task_state = await pool.fetchval("SELECT state FROM semantic_jobs.tasks WHERE id = $1", task_id)
    # Consistent outcome: the job is terminal or still running behind a live claim,
    # never resurrected and never half-ended.
    assert state in ("running", "cancel_requested", "cancelled")
    assert task_state in ("running", "cancelled")
    if state == "cancelled":
        assert task_state == "cancelled"

@pytest.mark.asyncio
@pytest.mark.parametrize("only_queued", [False, True])
async def test_p05_randomized_claim_cancel_interleavings_never_deadlock(pool: asyncpg.Pool, only_queued):
    """Randomized repetitions on top of the deterministic barrier test: claim
    and cancel race with arbitrary relative timing, on fresh and expired
    leases; nothing deadlocks and the job never resurrects."""
    import random

    seed = 20260314
    rng = random.Random(seed)
    repository = PostgresJobRepository(pool)
    for round_index in range(100):
        job_id = await admit_job(pool, key=f"p0rand{round_index}")
        task_id = await task_id_of(pool, job_id)
        owner = f"population-worker:i{round_index}:r1"
        expired = round_index % 3 == 1
        if round_index % 3:
            claim = await repository.claim_task(task_id=task_id, queue_name=QUEUE,
                                                lease_owner=owner, lease_seconds=300)
            assert claim is not None
        if expired:
            await pool.execute(
                "UPDATE semantic_jobs.tasks SET lease_expires_at = now() - interval '1 second' WHERE id = $1",
                task_id)

        async def claim_again():
            try:
                return await asyncio.wait_for(
                    repository.claim_task(task_id=task_id, queue_name=QUEUE,
                                          lease_owner=f"population-worker:i{round_index}:r2",
                                          lease_seconds=300), 15)
            except Exception as exc:
                return exc

        async def cancel():
            try:
                return await asyncio.wait_for(repository.request_cancel(job_id, "user-1", only_queued=only_queued), 15)
            except Exception as exc:
                return exc

        first = asyncio.ensure_future(claim_again())
        await asyncio.sleep(rng.uniform(0.0, 0.02))
        second = asyncio.ensure_future(cancel())
        lease, job = await asyncio.gather(first, second)
        for outcome in (lease, job):
            assert not isinstance(outcome, BaseException), \
                f"seed={seed}, round={round_index}, only_queued={only_queued}: {outcome!r}"
        job_state = await pool.fetchval("SELECT state FROM semantic_jobs.jobs WHERE id = $1::uuid", job_id)
        task_state = await pool.fetchval("SELECT state FROM semantic_jobs.tasks WHERE id = $1", task_id)
        assert job_state in ("running", "cancel_requested", "cancelled"), (round_index, job_state)
        assert task_state in ("running", "cancelled"), (round_index, task_state)
        if job_state == "cancelled":
            # A cancelled job never comes back for another attempt.
            assert task_state == "cancelled"


@pytest.mark.asyncio
@pytest.mark.parametrize("only_queued", [False, True])
@pytest.mark.parametrize("expired", [False, True])
async def test_p05_three_actors_checkpoint_complete_cancel_and_recover(pool, only_queued, expired):
    """A owns/checkpoints/completes, B cancels, C recovers/reclaims through
    an independently pooled connection. Stale outcomes are legal; deadlocks,
    duplicate terminals and resurrection are not."""
    async with asyncpg.create_pool(DSN, min_size=2, max_size=4) as independent:
        a = PostgresJobRepository(pool)
        b = PostgresJobRepository(independent)
        c = PostgresJobRepository(independent)
        job_id = await admit_job(pool, key=f"three-{only_queued}-{expired}")
        task_id = await task_id_of(pool, job_id)
        lease = await a.claim_task(task_id=task_id, queue_name=QUEUE, lease_owner="actor-A", lease_seconds=300)
        assert lease is not None
        if expired:
            await pool.execute("UPDATE semantic_jobs.tasks SET lease_expires_at=now()-interval '1 second' WHERE id=$1", task_id)
        start = asyncio.Event()

        async def owner():
            await start.wait()
            await a.checkpoint(task_id=task_id, lease_owner="actor-A", lease_epoch=lease.lease_epoch,
                               progress={"phase": "race"}, lease_seconds=300, renew=False)
            try:
                return await a.complete_task(task_id=task_id, lease_owner="actor-A", lease_epoch=lease.lease_epoch,
                                             job_state="completed", result={})
            except StaleLease:
                return None

        async def cancel():
            await start.wait()
            return await b.request_cancel(job_id, "user-1", only_queued=only_queued)

        async def recover():
            await start.wait()
            await c.recover_stalled_tasks(max_attempts=3, retry_seconds=0, grace_seconds=0)
            return await c.claim_task(task_id=task_id, queue_name=QUEUE, lease_owner="actor-C", lease_seconds=300)

        actors = [asyncio.create_task(fn()) for fn in (owner, cancel, recover)]
        start.set()
        outcomes = await asyncio.wait_for(asyncio.gather(*actors), 15)
        # Reconcile a legal remaining live attempt, then prove no old attempt
        # can change that terminal result or emit a second completion.
        current = await pool.fetchrow("SELECT state,lease_owner,lease_epoch FROM semantic_jobs.tasks WHERE id=$1", task_id)
        if current["state"] == "running":
            await a.complete_task(task_id=task_id, lease_owner=current["lease_owner"],
                                  lease_epoch=current["lease_epoch"], job_state="completed", result={})
        elif current["state"] == "queued":
            final = await c.claim_task(task_id=task_id, queue_name=QUEUE, lease_owner="actor-C-final", lease_seconds=300)
            assert final is not None
            await c.complete_task(task_id=task_id, lease_owner=final.lease_owner,
                                  lease_epoch=final.lease_epoch, job_state="completed", result={})
        states = await pool.fetchrow(
            "SELECT j.state AS job,t.state AS task FROM semantic_jobs.jobs j JOIN semantic_jobs.tasks t ON t.job_id=j.id WHERE t.id=$1", task_id)
        assert (states["job"], states["task"]) in (("completed", "completed"), ("cancelled", "cancelled"))
        assert await pool.fetchval(
            "SELECT count(*) FROM semantic_jobs.events WHERE job_id=$1::uuid AND event_type=ANY($2::text[])",
            job_id, ["job.completed", "job.failed", "job.cancelled"]) == 1
        for stale in [lease, outcomes[2]]:
            if stale is not None:
                with pytest.raises(StaleLease):
                    await a.complete_task(task_id=task_id, lease_owner=stale.lease_owner,
                                          lease_epoch=stale.lease_epoch, job_state="completed", result={})
        assert await c.claim_task(task_id=task_id, queue_name=QUEUE, lease_owner="resurrection", lease_seconds=300) is None
        assert dict(states) == dict(await pool.fetchrow(
            "SELECT j.state AS job,t.state AS task FROM semantic_jobs.jobs j JOIN semantic_jobs.tasks t ON t.job_id=j.id WHERE t.id=$1", task_id))
