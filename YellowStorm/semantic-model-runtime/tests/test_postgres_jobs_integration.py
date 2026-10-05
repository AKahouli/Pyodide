from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path

import asyncpg
import pytest
import pytest_asyncio

from app.jobs.models import IdempotencyConflict, JobCommand, SourceEvent, StaleLease
from app.jobs.service import JobService
from app.persistence.postgres_jobs import PostgresJobRepository
from app.persistence.ui_signal_outbox import UiSignalOutboxRepository, enqueue_ui_signal

DSN = os.environ.get("SEMANTIC_RUNTIME_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DSN, reason="SEMANTIC_RUNTIME_TEST_DATABASE_URL not set")
MIGRATIONS = sorted((Path(__file__).resolve().parents[1] / "migrations").glob("*.sql"))


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
        await connection.execute("""
            CREATE SCHEMA IF NOT EXISTS semantic_model;
            CREATE TABLE IF NOT EXISTS semantic_model.workspace_links (
              model_id UUID NOT NULL, workspace_id TEXT NOT NULL, enabled BOOLEAN NOT NULL DEFAULT true,
              PRIMARY KEY (model_id, workspace_id)
            );
            CREATE TABLE IF NOT EXISTS semantic_model.source_mappings (
              id UUID PRIMARY KEY DEFAULT gen_random_uuid(), model_id UUID NOT NULL,
              concept_id UUID NOT NULL DEFAULT gen_random_uuid(), workspace_id TEXT NOT NULL,
              document_id TEXT NOT NULL, sheet_name TEXT NOT NULL DEFAULT '',
              asset_kind TEXT NOT NULL DEFAULT 'excel_sheet', field_mappings JSONB NOT NULL DEFAULT '[]',
              status TEXT NOT NULL DEFAULT 'ready', created_by TEXT NOT NULL DEFAULT 'test-user',
              validated_source_version TEXT, validated_at TIMESTAMPTZ,
              created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            );
        """)
    finally:
        await connection.close()
    value = await asyncpg.create_pool(DSN, min_size=1, max_size=6)
    yield value
    await value.close()


def command(purpose: str = "build") -> JobCommand:
    return JobCommand.model_validate(
        {"actorUserId": "user-1", "modelId": "11111111-1111-1111-1111-111111111111",
         "payload": {"purpose": purpose}}
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
async def test_failed_population_can_be_retried_without_duplicate_concurrent_jobs(pool: asyncpg.Pool):
    repository = PostgresJobRepository(pool)
    first = await admit(repository)
    await pool.execute("UPDATE semantic_jobs.jobs SET state = 'failed' WHERE id = $1::uuid", first.job_id)

    retry, concurrent = await asyncio.gather(admit(repository), admit(repository))
    assert retry.job_id == concurrent.job_id
    assert retry.job_id != first.job_id
    assert {retry.reused, concurrent.reused} == {False, True}

    await pool.execute("UPDATE semantic_jobs.jobs SET state = 'failed' WHERE id = $1::uuid", retry.job_id)
    later = await admit(repository)
    assert later.job_id not in {first.job_id, retry.job_id}


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
async def test_source_event_enqueues_one_discovery_per_mapped_sheet(pool: asyncpg.Pool):
    model_id = "11111111-1111-1111-1111-111111111111"
    workspace_id = "6512f0a1c9e77a001234aaa1"
    document_id = "6512f0a1c9e77a001234bbb2"
    await pool.execute(
        "INSERT INTO semantic_model.workspace_links (model_id, workspace_id) VALUES ($1, $2)",
        model_id, workspace_id,
    )
    for sheet in ("Customers", "Orders"):
        await pool.execute(
            "INSERT INTO semantic_model.source_mappings "
            "(model_id, workspace_id, document_id, sheet_name) VALUES ($1, $2, $3, $4)",
            model_id, workspace_id, document_id, sheet,
        )
    event = SourceEvent.model_validate({
        "eventId": "event-profile", "eventType": "workspace.document.artifact_ready.v1",
        "occurredAt": "2026-09-22T12:00:00Z",
        "payload": {"workspaceId": workspace_id, "documentId": document_id,
                    "createdBy": "user-1", "originalName": "data.xlsx",
                    "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    "sizeBytes": 1024, "uploadedAt": "2026-09-22T11:00:00Z",
                    "updatedAt": "2026-09-22T11:30:00Z"},
    })

    await PostgresJobRepository(pool).record_source_event(event)

    commands = await pool.fetch("SELECT command FROM semantic_jobs.jobs ORDER BY command->'payload'->'options'->>'sheetName'")
    payloads = [json.loads(row["command"]) if isinstance(row["command"], str) else row["command"]
                for row in commands]
    assert [command["payload"]["options"]["sheetName"] for command in payloads] == [
        "Customers", "Orders"]
    assert await pool.fetchval(
        "SELECT count(*) FROM semantic_datasource.mapping_health WHERE state='checking'"
    ) == 2


@pytest.mark.asyncio
async def test_discovery_completion_persists_profile_health_and_cache(
    pool: asyncpg.Pool, monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setenv("SEMANTIC_MODEL_REALTIME_ENABLED", "true")
    repository = PostgresJobRepository(pool)
    model_id = "11111111-1111-1111-1111-111111111111"
    workspace_id = "6512f0a1c9e77a001234aaa1"
    document_id = "6512f0a1c9e77a001234bbb2"
    content_hash = "9f2a1c0e5b6d7a8b9c0d1e2f3a4b5c6d"
    await pool.execute(
        "INSERT INTO semantic_model.workspace_links (model_id, workspace_id) VALUES ($1, $2)",
        model_id, workspace_id,
    )
    await pool.execute(
        "INSERT INTO semantic_model.source_mappings "
        "(model_id, workspace_id, document_id, sheet_name, field_mappings, "
        "validated_source_version) VALUES ($1, $2, $3, 'Customers', $4::jsonb, $5)",
        model_id, workspace_id, document_id,
        json.dumps([{"mode": "direct", "sourceField": "customer_id",
                     "targetAttribute": "id"}]), content_hash,
    )
    source = {"workspaceId": workspace_id, "assetId": document_id,
              "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              "sizeBytes": 1024, "contentHash": content_hash,
              "sourceVersion": content_hash}
    job_command = JobCommand.model_validate({
        "actorUserId": "user-1", "modelId": model_id, "workspaceId": workspace_id,
        "payload": {"source": source, "options": {"sheetName": "Customers"}},
    })
    admitted = await JobService(repository).admit(
        job_type="datasource.discovery", command=job_command, idempotency_key="profile-1",
        task_name="semantic-model-datasource.discover",
        queue_name="semantic-model-datasource.batch",
    )
    task_id = await pool.fetchval("SELECT id FROM semantic_jobs.tasks")
    lease = await repository.claim_task(
        task_id=task_id, queue_name="semantic-model-datasource.batch",
        lease_owner="worker", lease_seconds=30,
    )
    assert lease
    profile = {
        "profileId": "prof_test", "assetRef": {"workspaceId": workspace_id,
        "assetId": document_id, "assetVersionId": f"md5:{content_hash}"},
        "parserFingerprint": "sha256:parser", "status": "ready",
        "structure": {"kind": "xlsx", "selectedSheet": "Customers"},
        "samples": [{"customer_id": "C1"}], "warnings": [],
        "coverage": {"sampled": True, "completeProfileDone": True},
    }
    await repository.complete_task(
        task_id=task_id, lease_owner="worker", lease_epoch=lease.lease_epoch,
        job_state="completed", result={"profile": profile,
        "fieldProfiles": [{"name": "customer_id"}], "scannedRows": 1},
    )

    assert await pool.fetchval("SELECT count(*) FROM semantic_datasource.discovery_profiles") == 1
    assert await pool.fetchval("SELECT state FROM semantic_datasource.mapping_health") == "healthy"
    cached = await repository.get_cached_discovery_profile(
        job_command.model_dump(by_alias=True, mode="json"), f"md5:{content_hash}",
        "sha256:parser")
    assert cached and cached["samples"] == [{"customer_id": "C1"}]
    assert await repository.get_cached_discovery_profile(
        job_command.model_dump(by_alias=True, mode="json"), f"md5:{content_hash}",
        "sha256:new-parser") is None
    refreshed = await JobService(repository).admit(
        job_type="datasource.discovery", command=job_command,
        idempotency_key="profile-1",
        task_name="semantic-model-datasource.discover",
        queue_name="semantic-model-datasource.batch",
    )
    assert refreshed.reused is False
    assert refreshed.job_id != admitted.job_id
    assert await pool.fetchval(
        "SELECT count(*) FROM semantic_jobs.ui_signal_outbox WHERE event_type='datasource-status-changed'"
    ) == 1


@pytest.mark.asyncio
async def test_stale_discovery_completions_cannot_overwrite_current_health(
    pool: asyncpg.Pool,
):
    repository = PostgresJobRepository(pool)
    model_id = "11111111-1111-1111-1111-111111111111"
    workspace_id = "6512f0a1c9e77a001234aaa1"
    document_id = "6512f0a1c9e77a001234bbb2"
    await pool.execute(
        "INSERT INTO semantic_model.workspace_links (model_id, workspace_id) VALUES ($1, $2)",
        model_id, workspace_id,
    )
    await pool.execute(
        "INSERT INTO semantic_model.source_mappings "
        "(model_id, workspace_id, document_id, sheet_name) "
        "VALUES ($1, $2, $3, 'Customers')",
        model_id, workspace_id, document_id,
    )
    current = SourceEvent.model_validate({
        "eventId": "current-event",
        "eventType": "workspace.document.artifact_ready.v1",
        "occurredAt": "2026-09-22T12:00:00Z",
        "payload": {"workspaceId": workspace_id, "documentId": document_id,
                    "createdBy": "user-1", "originalName": "data.xlsx",
                    "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    "sizeBytes": 2048, "updatedAt": "2026-09-22T12:00:00Z"},
    })
    await repository.record_source_event(current)
    await pool.execute(
        "UPDATE semantic_datasource.mapping_health SET state='healthy'"
    )
    stale_source = {
        "workspaceId": workspace_id, "assetId": document_id,
        "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "sourceVersion": "2026-09-22T11:00:00Z:1024",
        "sourceEventId": "older-event",
    }
    stale_command = JobCommand.model_validate({
        "actorUserId": "user-1", "modelId": model_id, "workspaceId": workspace_id,
        "payload": {"source": stale_source, "options": {"sheetName": "Customers"}},
    })

    for key, state in (("stale-success", "completed"), ("stale-failure", "failed")):
        admitted = await JobService(repository).admit(
            job_type="datasource.discovery", command=stale_command,
            idempotency_key=key, task_name="semantic-model-datasource.discover",
            queue_name="semantic-model-datasource.batch",
        )
        task_id = await pool.fetchval(
            "SELECT id FROM semantic_jobs.tasks WHERE job_id=$1::uuid", admitted.job_id)
        lease = await repository.claim_task(
            task_id=task_id, queue_name="semantic-model-datasource.batch",
            lease_owner=key, lease_seconds=30,
        )
        assert lease
        result = None
        if state == "completed":
            result = {"profile": {
                "profileId": "prof_stale",
                "assetRef": {"workspaceId": workspace_id, "assetId": document_id,
                             "assetVersionId": "md5:stale"},
                "parserFingerprint": "sha256:stale", "status": "ready",
                "structure": {"kind": "xlsx", "selectedSheet": "Customers"},
                "warnings": [],
            }, "fieldProfiles": []}
        await repository.complete_task(
            task_id=task_id, lease_owner=key, lease_epoch=lease.lease_epoch,
            job_state=state, result=result,
            error_code="stale_failure" if state == "failed" else None,
        )
        assert await pool.fetchval(
            "SELECT state FROM semantic_datasource.mapping_health"
        ) == "healthy"

    admitted = await JobService(repository).admit(
        job_type="datasource.discovery", command=stale_command,
        idempotency_key="stale-after-delete",
        task_name="semantic-model-datasource.discover",
        queue_name="semantic-model-datasource.batch",
    )
    task_id = await pool.fetchval(
        "SELECT id FROM semantic_jobs.tasks WHERE job_id=$1::uuid", admitted.job_id)
    lease = await repository.claim_task(
        task_id=task_id, queue_name="semantic-model-datasource.batch",
        lease_owner="stale-after-delete", lease_seconds=30,
    )
    assert lease
    deleted = SourceEvent.model_validate({
        "eventId": "deleted-event",
        "eventType": "workspace.document.deleted.v1",
        "occurredAt": "2026-09-22T13:00:00Z",
        "payload": {"workspaceId": workspace_id, "documentId": document_id},
    })
    async with pool.acquire() as connection:
        async with connection.transaction():
            await connection.execute(
                "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
                f"{workspace_id}:{document_id}",
            )
            completion = asyncio.create_task(repository.complete_task(
                task_id=task_id, lease_owner="stale-after-delete",
                lease_epoch=lease.lease_epoch, job_state="completed",
                result={"profile": {
                    "profileId": "prof_deleted_stale",
                    "assetRef": {"workspaceId": workspace_id, "assetId": document_id,
                                 "assetVersionId": "md5:stale"},
                    "parserFingerprint": "sha256:stale", "status": "ready",
                    "structure": {"kind": "xlsx", "selectedSheet": "Customers"},
                    "warnings": [],
                }, "fieldProfiles": []},
            ))
            await asyncio.sleep(0.05)
            assert completion.done() is False
            await connection.execute(
                "INSERT INTO semantic_jobs.source_revisions "
                "(event_id, workspace_id, asset_id, revision, event_type, occurred_at, payload) "
                "VALUES ($1, $2, $3, 2, $4, $5, $6::jsonb)",
                deleted.event_id, workspace_id, document_id, deleted.event_type,
                deleted.occurred_at,
                json.dumps(deleted.payload.model_dump(by_alias=True, mode="json")),
            )
            await connection.execute(
                "UPDATE semantic_jobs.source_heads SET revision=2, event_id=$3, event_type=$4, "
                "occurred_at=$5, payload=$6::jsonb, deleted=true "
                "WHERE workspace_id=$1 AND asset_id=$2",
                workspace_id, document_id, deleted.event_id, deleted.event_type,
                deleted.occurred_at,
                json.dumps(deleted.payload.model_dump(by_alias=True, mode="json")),
            )
            await connection.execute(
                "UPDATE semantic_datasource.mapping_health SET state='unavailable'"
            )
    await completion
    assert await pool.fetchval(
        "SELECT state FROM semantic_datasource.mapping_health"
    ) == "unavailable"


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
async def test_terminal_job_commit_enqueues_signal_when_realtime_is_enabled(
    pool: asyncpg.Pool, monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setenv("SEMANTIC_MODEL_REALTIME_ENABLED", "true")
    repository = PostgresJobRepository(pool)
    await admit(repository, key="signal-job")
    task_id = await pool.fetchval("SELECT id FROM semantic_jobs.tasks")
    lease = await repository.claim_task(
        task_id=task_id, queue_name="semantic-model-population.batch",
        lease_owner="worker", lease_seconds=30,
    )
    assert lease
    await repository.complete_task(
        task_id=task_id, lease_owner="worker", lease_epoch=lease.lease_epoch,
        job_state="completed", result={"ok": True},
    )
    signal = await pool.fetchrow(
        "SELECT event_type, payload FROM semantic_jobs.ui_signal_outbox")
    assert signal["event_type"] == "population-status-changed"
    payload = json.loads(signal["payload"]) if isinstance(signal["payload"], str) else signal["payload"]
    assert set(payload) <= {"modelId", "resource", "status", "reason"}


@pytest.mark.asyncio
async def test_released_signal_is_coalesced_by_matching_enqueue(pool: asyncpg.Pool):
    model_id = "11111111-1111-1111-1111-111111111111"
    async with pool.acquire() as connection, connection.transaction():
        signal_id = await enqueue_ui_signal(
            connection, model_id=model_id, event_type="model-read-state-changed",
            payload={"status": "old"},
        )
    repository = UiSignalOutboxRepository(pool)
    claimed = await repository.claim(claim_owner="worker", claim_seconds=30, batch_size=1)
    assert claimed[0].id == signal_id
    assert await repository.release(
        signal_id, "worker", error="down", retry_seconds=60, max_attempts=8,
    ) is True

    async with pool.acquire() as connection, connection.transaction():
        coalesced_id = await enqueue_ui_signal(
            connection, model_id=model_id, event_type="model-read-state-changed",
            payload={"status": "new"},
        )

    row = await pool.fetchrow(
        "SELECT id, status, payload FROM semantic_jobs.ui_signal_outbox")
    assert row["id"] == coalesced_id == signal_id
    assert row["status"] == "pending"
    payload = json.loads(row["payload"]) if isinstance(row["payload"], str) else row["payload"]
    assert payload["status"] == "new"


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


QUEUE = "semantic-model-population.batch"


@pytest.mark.asyncio
async def test_stopping_a_queued_run_ends_it_at_once_and_a_new_request_starts_fresh(pool: asyncpg.Pool):
    repository = PostgresJobRepository(pool)
    admitted = await admit(repository)
    task_id = await pool.fetchval("SELECT id FROM semantic_jobs.tasks")
    model_id = "11111111-1111-1111-1111-111111111111"
    assert (await repository.find_active_job(actor_user_id="user-1", model_id=model_id,
                                             job_type="population.run"))["jobId"] == admitted.job_id

    # Only the actor who started it can stop it.
    assert await repository.request_cancel(admitted.job_id, "someone-else") is None
    stopped = await repository.request_cancel(admitted.job_id, "user-1")
    assert stopped["state"] == "cancelled" and stopped["errorCode"] == "cancelled"
    assert await pool.fetchval("SELECT state FROM semantic_jobs.tasks WHERE id = $1", task_id) == "cancelled"
    assert await repository.claim_task(task_id=task_id, queue_name=QUEUE, lease_owner="w", lease_seconds=30) is None
    assert await repository.find_active_job(actor_user_id="user-1", model_id=model_id,
                                            job_type="population.run") is None
    # Stopping again changes nothing.
    assert (await repository.request_cancel(admitted.job_id, "user-1"))["state"] == "cancelled"
    assert await pool.fetchval("SELECT count(*) FROM semantic_jobs.events WHERE event_type = 'job.cancelled'") == 1

    again = await admit(repository)
    assert again.job_id != admitted.job_id and again.reused is False


@pytest.mark.asyncio
async def test_stopping_a_running_run_asks_its_worker_which_ends_it_without_a_result(pool: asyncpg.Pool):
    repository = PostgresJobRepository(pool)
    admitted = await admit(repository)
    task_id = await pool.fetchval("SELECT id FROM semantic_jobs.tasks")
    lease = await repository.claim_task(task_id=task_id, queue_name=QUEUE, lease_owner="w", lease_seconds=30)
    assert lease and await repository.cancel_requested(admitted.job_id) is False

    asked = await repository.request_cancel(admitted.job_id, "user-1")
    assert asked["state"] == "cancel_requested"
    assert await repository.cancel_requested(admitted.job_id) is True
    # Still followed as the model's run until the worker ends it.
    assert (await repository.find_active_job(actor_user_id="user-1", model_id=asked["modelId"],
                                             job_type="population.run"))["jobId"] == admitted.job_id

    assert await repository.cancel_task(task_id=task_id, lease_owner="w", lease_epoch=lease.lease_epoch) == {
        "jobId": admitted.job_id, "state": "cancelled"}
    job = await repository.get_job(admitted.job_id, "user-1")
    assert job["state"] == "cancelled" and job["result"] is None and job["completedAt"] is not None
    assert await pool.fetchval("SELECT state FROM semantic_jobs.tasks WHERE id = $1", task_id) == "cancelled"
    with pytest.raises(StaleLease):
        await repository.cancel_task(task_id=task_id, lease_owner="w", lease_epoch=lease.lease_epoch)


@pytest.mark.asyncio
async def test_recovery_ends_a_dead_workers_run_that_was_asked_to_stop(pool: asyncpg.Pool):
    repository = PostgresJobRepository(pool)
    admitted = await admit(repository)
    task_id = await pool.fetchval("SELECT id FROM semantic_jobs.tasks")
    assert await repository.claim_task(task_id=task_id, queue_name=QUEUE, lease_owner="dead", lease_seconds=30)
    await repository.request_cancel(admitted.job_id, "user-1")
    await _expire_lease(pool, task_id)

    # Never claimed again, never requeued: it ends as stopped.
    assert await repository.claim_task(task_id=task_id, queue_name=QUEUE, lease_owner="w2", lease_seconds=30) is None
    assert await _recover(repository) == {"exhausted": 0, "requeued": 0}
    assert await pool.fetchval("SELECT state FROM semantic_jobs.tasks WHERE id = $1", task_id) == "cancelled"
    assert (await repository.get_job(admitted.job_id, "user-1"))["state"] == "cancelled"
