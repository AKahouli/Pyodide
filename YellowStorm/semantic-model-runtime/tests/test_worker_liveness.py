from __future__ import annotations

import asyncpg
import pytest

from app.jobs import worker_liveness
from app.jobs.dispatcher import OutboxDispatcher
from app.jobs.models import OutboxItem
from app.persistence.postgres_jobs import PostgresJobRepository, _queue_position_sql


class FakePool:
    def __init__(self, *rows):
        self.rows = list(rows)
        self.statements: list[str] = []

    async def fetchrow(self, sql, *args):
        self.statements.append(sql)
        row = self.rows.pop(0)
        if isinstance(row, Exception):
            raise row
        return row


def position_row(**overrides):
    return {"queue_name": "semantic-model-population.batch", "running": 1, "queued": 2,
            "live_leases": 0, "heartbeats": 1, **overrides}


@pytest.mark.asyncio
async def test_queue_position_counts_jobs_ahead_and_reports_workers():
    repo = PostgresJobRepository(FakePool(position_row()))  # type: ignore[arg-type]
    assert await repo.queue_position("j") == {
        "queueName": "semantic-model-population.batch", "position": 4,
        "ahead": {"running": 1, "queued": 2}, "workersOnline": 1}


@pytest.mark.asyncio
async def test_no_heartbeat_and_no_live_lease_means_no_worker():
    repo = PostgresJobRepository(FakePool(position_row(running=0, queued=0, heartbeats=0)))  # type: ignore[arg-type]
    queue = await repo.queue_position("j")
    assert queue["workersOnline"] == 0 and queue["position"] == 1


@pytest.mark.asyncio
async def test_a_live_lease_proves_a_worker_that_predates_heartbeats():
    repo = PostgresJobRepository(FakePool(position_row(heartbeats=0, live_leases=1)))  # type: ignore[arg-type]
    assert (await repo.queue_position("j"))["workersOnline"] == 1


@pytest.mark.asyncio
async def test_unmigrated_heartbeat_table_leaves_workers_unknown():
    pool = FakePool(asyncpg.UndefinedTableError("worker_heartbeats"), position_row(heartbeats=None))
    queue = await PostgresJobRepository(pool).queue_position("j")  # type: ignore[arg-type]
    assert queue["workersOnline"] is None
    assert "worker_heartbeats" in pool.statements[0] and "worker_heartbeats" not in pool.statements[1]


@pytest.mark.asyncio
async def test_job_without_a_queued_task_has_no_queue_object():
    assert await PostgresJobRepository(FakePool(None)).queue_position("j") is None  # type: ignore[arg-type]


def test_position_sql_uses_the_online_window():
    assert f"make_interval(secs => {worker_liveness.ONLINE_WINDOW_SECONDS})" in _queue_position_sql(with_heartbeats=True)


class DispatchRepo:
    def __init__(self, online):
        self.online = online
        self.claimed = False

    async def claim_outbox(self, *, claim_owner, claim_seconds):
        if self.claimed:
            return None
        self.claimed = True
        return OutboxItem(1, 7, "semantic-model-population.run", "semantic-model-population.batch",
                          {"jobId": "job-1", "taskId": 7}, claim_owner)

    async def mark_outbox_published(self, outbox_id, claim_owner):
        return True

    async def count_online_workers(self, queue_name):
        if isinstance(self.online, Exception):
            raise self.online
        return self.online


class Recorder:
    def __init__(self):
        self.calls: list[tuple] = []

    def warning(self, event, **fields):
        self.calls.append((event, fields))


async def dispatch(monkeypatch, online):
    recorder = Recorder()
    monkeypatch.setattr("app.jobs.dispatcher.celery_app.send_task", lambda *a, **kw: None)
    monkeypatch.setattr("app.jobs.dispatcher.events", recorder)
    assert await OutboxDispatcher(DispatchRepo(online)).dispatch_once() is True  # type: ignore[arg-type]
    return recorder.calls


@pytest.mark.asyncio
async def test_dispatch_logs_once_when_no_worker_is_online(monkeypatch):
    calls = await dispatch(monkeypatch, 0)
    assert calls == [("semantic.job.no_worker_online", {
        "queue": "semantic-model-population.batch", "job_kind": "semantic-model-population.run",
        "count": 0, "job_id": "job-1"})]


@pytest.mark.asyncio
@pytest.mark.parametrize("online", [1, None, RuntimeError("db down")])
async def test_dispatch_stays_quiet_when_workers_exist_or_are_unknown(monkeypatch, online):
    assert await dispatch(monkeypatch, online) == []


def test_heartbeat_logs_failure_and_recovery_not_every_beat(monkeypatch, caplog):
    outcomes = iter([RuntimeError("down"), RuntimeError("down"), None, None])

    async def fake(dsn, statement, *args):
        outcome = next(outcomes)
        if outcome:
            raise outcome

    monkeypatch.setattr(worker_liveness, "_with_connection", fake)
    heartbeat = worker_liveness.WorkerHeartbeat("dsn", "semantic-population@host", ["q"])
    with caplog.at_level("INFO", logger=worker_liveness.logger.name):
        results = [heartbeat.beat_once() for _ in range(4)]
    assert results == [False, False, True, True]
    assert [r.getMessage() for r in caplog.records] == [
        "Worker heartbeat failed; the queue may look unattended", "Worker heartbeat recovered"]
