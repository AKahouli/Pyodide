from __future__ import annotations

import asyncio
from dataclasses import asdict

import pytest

from app.jobs.dispatcher import OutboxDispatcher
from app.jobs.models import OutboxItem


class OutboxRepo:
    def __init__(self):
        self.item = OutboxItem(
            1, 7, "semantic-model-datasource.discover",
            "semantic-model-datasource.batch", {"taskId": 7}, "",
        )
        self.published = False
        self.released: tuple | None = None
        self.recovered: list[dict] = []

    async def claim_outbox(self, *, claim_owner: str, claim_seconds: int):
        if self.published or self.released:
            return None
        return OutboxItem(**{**asdict(self.item), "claim_owner": claim_owner})

    async def mark_outbox_published(self, outbox_id: int, claim_owner: str) -> bool:
        self.published = True
        return True

    async def release_outbox(self, outbox_id: int, claim_owner: str, error_code: str, retry_seconds: int) -> bool:
        self.released = (outbox_id, error_code, retry_seconds)
        return True

    async def recover_stalled_tasks(self, *, max_attempts: int, retry_seconds: int,
                                    grace_seconds: int, batch: int):
        self.recovered.append({"max_attempts": max_attempts, "retry_seconds": retry_seconds,
                               "grace_seconds": grace_seconds, "batch": batch})
        return {"exhausted": 0, "requeued": 1}


@pytest.mark.asyncio
async def test_dispatches_only_task_reference_then_marks_published(monkeypatch: pytest.MonkeyPatch):
    repo = OutboxRepo()
    calls: list[dict] = []
    monkeypatch.setattr("app.jobs.dispatcher.celery_app.send_task", lambda *a, **kw: calls.append({"args": a, **kw}))
    assert await OutboxDispatcher(repo).dispatch_once() is True
    assert calls[0]["args"] == [7]
    assert calls[0]["queue"] == "semantic-model-datasource.batch"
    assert repo.published is True


@pytest.mark.asyncio
async def test_broker_failure_releases_outbox_without_losing_intent(monkeypatch: pytest.MonkeyPatch):
    repo = OutboxRepo()

    def fail(*args, **kwargs):  # type: ignore[no-untyped-def]
        raise ConnectionError("secret broker details must not be persisted")

    monkeypatch.setattr("app.jobs.dispatcher.celery_app.send_task", fail)
    assert await OutboxDispatcher(repo).dispatch_once() is False
    assert repo.released == (1, "ConnectionError", 5)
    assert repo.published is False


@pytest.mark.asyncio
async def test_dispatcher_survives_repository_failure():
    class FlakyRepo(OutboxRepo):
        def __init__(self):
            super().__init__()
            self.claims = 0

        async def claim_outbox(self, *, claim_owner: str, claim_seconds: int):
            self.claims += 1
            if self.claims == 1:
                raise ConnectionError("database unavailable")
            return None

    repo = FlakyRepo()
    dispatcher = OutboxDispatcher(repo, interval_seconds=0.001)
    await dispatcher.start()
    for _ in range(20):
        if repo.claims >= 2:
            break
        await asyncio.sleep(0.002)
    await dispatcher.stop()
    assert repo.claims >= 2


@pytest.mark.asyncio
async def test_recovery_republishes_expired_leases_each_iteration(monkeypatch: pytest.MonkeyPatch):
    repo = OutboxRepo()
    monkeypatch.setattr("app.jobs.dispatcher.celery_app.send_task", lambda *a, **kw: None)
    dispatcher = OutboxDispatcher(repo, interval_seconds=0.001, max_attempts=4,
                                  retry_seconds=15, grace_seconds=90)
    assert await dispatcher.recover_once() == {"exhausted": 0, "requeued": 1}
    assert repo.recovered == [{"max_attempts": 4, "retry_seconds": 15,
                               "grace_seconds": 90, "batch": 50}]
    await dispatcher.start()
    for _ in range(20):
        if len(repo.recovered) >= 2:
            break
        await asyncio.sleep(0.002)
    await dispatcher.stop()
    # Recovery runs even when the outbox had nothing new to dispatch.
    assert len(repo.recovered) >= 2


@pytest.mark.asyncio
async def test_recovery_is_optional_for_repositories_without_it(monkeypatch: pytest.MonkeyPatch):
    class NoRecoveryRepo(OutboxRepo):
        recover_stalled_tasks = None

    repo = NoRecoveryRepo()
    monkeypatch.setattr("app.jobs.dispatcher.celery_app.send_task", lambda *a, **kw: None)
    assert await OutboxDispatcher(repo).recover_once() == {"exhausted": 0, "requeued": 0}
