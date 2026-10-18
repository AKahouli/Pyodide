"""Candidate persistence regressions using a PK/idempotency fake, not a real DB.

Tokens here are deliberately unsigned candidates: backend signature verification
is tested by the backend grant suite and is always required for actual access.
"""
import base64
from contextlib import asynccontextmanager
import copy
import json
import time
from uuid import uuid4

import pytest

from app.jobs.asset_admission import admission_candidate
from app.jobs.models import DiscoveryCommand, IdempotencyConflict, SourceEvent
from app.jobs.service import JobService
from app.persistence.postgres_jobs import PostgresJobRepository


RAW = {"actorUserId": "actor", "modelId": None, "workspaceId": "workspace",
       "payload": {"source": {"workspaceId": "workspace", "assetId": "document", "contentHash": "version-1"},
                   "options": {"sheetName": "allowed"}}}


def command(key="key", *, nonce=None, iat=None, exp=None, purpose="discovery", original=None):
    original = original or RAW
    now = int(time.time())
    nonce = nonce or str(uuid4())
    body = {"nonce": nonce, "key": key, "iat": now if iat is None else iat,
            "exp": now + 300 if exp is None else exp, "command": json.dumps(original),
            "purpose": purpose, "actor": original["actorUserId"], "model": None}
    encoded = base64.urlsafe_b64encode(json.dumps({"body": body}).encode()).decode().rstrip("=")
    raw = copy.deepcopy(original)
    raw["payload"].update(assetAdmission=f"header.{encoded}.candidate-not-a-signature", assetCommand=body["command"])
    return DiscoveryCommand.model_validate(raw), nonce


@pytest.mark.parametrize("change", ["options", "source", "purpose", "actor", "snapshot"])
def test_rejects_changed_execution_scope_before_persistence(change):
    cmd, _ = command(purpose="population" if change == "purpose" else "discovery")
    if change == "options":
        cmd.payload["options"] = {"sheetName": "not-signed"}
    elif change == "source":
        cmd.payload["source"]["contentHash"] = "not-signed"
    elif change == "actor":
        cmd.actor_user_id = "not-signed"
    elif change == "snapshot":
        cmd.payload["assetCommand"] = "{}"
    with pytest.raises(IdempotencyConflict, match="canonical asset admission"):
        admission_candidate(cmd, "key")


@pytest.mark.parametrize("iat,exp", [(0, 300), (int(time.time()) + 30, int(time.time()) + 300),
                                    (int(time.time()), int(time.time()) + 301)])
def test_rejects_expired_future_or_overlong_creation_window(iat, exp):
    cmd, _ = command(iat=iat, exp=exp)
    with pytest.raises(IdempotencyConflict):
        admission_candidate(cmd, "key")


def test_binds_original_idempotency_key():
    cmd, _ = command()
    with pytest.raises(IdempotencyConflict):
        admission_candidate(cmd, "different-key")


class Connection:
    def __init__(self):
        self.jobs = {}
        self.keys = {}
        self.tasks = []

    @asynccontextmanager
    async def transaction(self):
        yield

    async def fetchrow(self, sql, *args):
        if "INSERT INTO semantic_jobs.jobs" in sql:
            assert "id)" in sql and "COALESCE($8::uuid" in sql
            assert "ON CONFLICT DO NOTHING" in sql
            nonce, key = args[7], args[4]
            if nonce in self.jobs or key in self.keys:
                return None
            row = {"id": nonce, "state": "queued", "command_hash": args[5], "result": {},
                   "command": args[6], "key": key}
            self.jobs[nonce] = row
            self.keys[key] = row
            return row
        if "SELECT id::text, state, command_hash, result" in sql:
            return self.keys.get(args[1])
        if "INSERT INTO semantic_jobs.tasks" in sql:
            self.tasks.append(args)
            return {"id": len(self.tasks)}
        raise AssertionError(sql)

    async def execute(self, *args):
        pass


class Pool:
    def __init__(self):
        self.connection = Connection()

    @asynccontextmanager
    async def acquire(self):
        yield self.connection


async def admit(service, cmd, key="key"):
    return await service.admit(job_type="datasource.discovery", command=cmd, idempotency_key=key,
                               task_name="semantic-model-datasource.discover", queue_name="queue")


@pytest.mark.asyncio
async def test_uuid_pk_prevents_replay_after_cancel_and_fresh_backend_candidate_allows_retry():
    pool = Pool()
    service = JobService(PostgresJobRepository(pool))
    original, nonce = command()
    first = await admit(service, original)
    assert first.job_id == nonce
    with pytest.raises(IdempotencyConflict):
        await admit(service, original, "another-key")
    # Also exercise persistence-level UUID collision when a caller bypasses the
    # service key check and knows the auto-derived retry key.
    pool.connection.jobs[nonce]["state"] = "cancelled"
    with pytest.raises(IdempotencyConflict):
        await admit(service, original)
    assert len(pool.connection.tasks) == 1
    fresh, fresh_nonce = command()
    retried = await admit(service, fresh)
    assert retried.job_id == fresh_nonce != nonce
    assert len(pool.connection.tasks) == 2


@pytest.mark.asyncio
async def test_repeat_request_deduplicates_without_overwriting_running_job_admission():
    pool = Pool()
    service = JobService(PostgresJobRepository(pool))
    first, nonce = command()
    await admit(service, first)
    pool.connection.jobs[nonce]["state"] = "running"
    original_snapshot = pool.connection.jobs[nonce]["command"]
    fresh, _ = command()
    repeat = await admit(service, fresh)
    assert repeat.job_id == nonce and repeat.reused
    assert pool.connection.jobs[nonce]["command"] == original_snapshot
    assert len(pool.connection.tasks) == 1


@pytest.mark.asyncio
async def test_source_events_require_separate_exact_sheet_candidates_and_do_not_trust_created_by():
    payload = {"workspaceId": "workspace", "documentId": "document", "createdBy": "actor",
               "mimeType": "text/csv", "originalName": "source.csv", "sizeBytes": 4,
               "contentHash": "version", "uploadedAt": "2026-10-18T12:00:00.000Z", "indexingStatus": "ready"}
    event = SourceEvent.model_validate({"eventId": "event", "eventType": "workspace.document.indexing_ready.v1",
                                       "occurredAt": "2026-10-18T12:00:00Z", "payload": payload})
    source = {"workspaceId": "workspace", "assetId": "document", "originalName": "source.csv",
              "mimeType": "text/csv", "sizeBytes": 4, "contentHash": "version",
              "uploadedAt": payload["uploadedAt"], "indexingStatus": "ready", "sourceEventId": "event", "sourceVersion": "version"}

    class EventConnection:
        def __init__(self):
            self.jobs = []

        async def fetch(self, *args):
            return [{"sheet_name": "one"}, {"sheet_name": "two"}, {"sheet_name": "unsigned"}]

        async def fetchrow(self, sql, *args):
            if "INSERT INTO semantic_jobs.jobs" in sql:
                assert "ON CONFLICT DO NOTHING" in sql
                self.jobs.append((args[5], json.loads(args[4])))
                return {"id": args[5]}
            return {"id": len(self.jobs)}

        async def execute(self, *args):
            pass

    connection = EventConnection()
    repository = PostgresJobRepository(Pool())
    await repository._enqueue_event_discovery(connection, event, payload)
    assert connection.jobs == []
    tokens = {}
    for sheet in ["one", "two"]:
        original = {"actorUserId": "actor", "modelId": None, "workspaceId": "workspace",
                    "payload": {"source": source, "options": {"sheetName": sheet}}}
        cmd, nonce = command(f"event:{sheet}", original=original)
        tokens[sheet] = cmd.payload["assetAdmission"]
    await repository._enqueue_event_discovery(connection, event, {**payload, "assetAdmissions": tokens})
    assert len(connection.jobs) == 2
    assert connection.jobs[0][0] != connection.jobs[1][0]
    assert [job[1]["payload"]["options"]["sheetName"] for job in connection.jobs] == ["one", "two"]
    connection.jobs.clear()
    await repository._enqueue_event_discovery(connection, event, {**payload, "assetAdmissions": {"two": tokens["one"]}})
    assert connection.jobs == []
