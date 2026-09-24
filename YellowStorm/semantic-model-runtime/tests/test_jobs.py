from __future__ import annotations

from copy import deepcopy

import pytest
from fastapi.testclient import TestClient

from app.jobs.models import Admission, IdempotencyConflict
from app.main import create_app
from app.population.compiler import canonical_spec_hash


class MemoryRepository:
    """Test double only. Production uses PostgresJobRepository."""

    def __init__(self):
        self.by_key: dict[tuple[str, str], tuple[str, str]] = {}
        self.jobs: dict[str, dict] = {}
        self.events: dict[str, list[dict]] = {}
        self.source_events: dict[str, dict] = {}

    async def admit(self, **kwargs) -> Admission:  # type: ignore[no-untyped-def]
        command = kwargs["command"]
        key = (command.actor_user_id, kwargs["idempotency_key"])
        existing = self.by_key.get(key)
        if existing:
            if existing[1] != kwargs["command_hash"]:
                raise IdempotencyConflict("idempotency key already has a different payload")
            return Admission(existing[0], "queued", True)
        job_id = f"job-{len(self.jobs) + 1}"
        self.by_key[key] = (job_id, kwargs["command_hash"])
        self.jobs[job_id] = {
            "jobId": job_id,
            "jobType": kwargs["job_type"],
            "state": "queued",
            "actorUserId": command.actor_user_id,
        }
        self.events[job_id] = [
            {"eventId": 1, "eventType": "job.queued", "payload": {}}
        ]
        return Admission(job_id, "queued", False)

    async def get_job(self, job_id: str, actor_user_id: str) -> dict | None:
        row = self.jobs.get(job_id)
        return row if row and row["actorUserId"] == actor_user_id else None

    async def list_events(self, job_id: str, actor_user_id: str, after: int, limit: int) -> list[dict]:
        if await self.get_job(job_id, actor_user_id) is None:
            return []
        return [e for e in self.events.get(job_id, []) if e["eventId"] > after][:limit]

    async def record_source_event(self, event):  # type: ignore[no-untyped-def]
        existing = self.source_events.get(event.event_id)
        if existing:
            return {"revision": existing["revision"], "reused": True}
        result = {"revision": len(self.source_events) + 1, "reused": False, "headAdvanced": True}
        self.source_events[event.event_id] = result
        return result


@pytest.fixture
def job_client(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("SEMANTIC_RUNTIME_SERVICE_KEY", "test-key")
    monkeypatch.setenv("SEMANTIC_MODEL_RUNTIME_WRITES_ENABLED", "true")
    with TestClient(create_app(MemoryRepository())) as client:
        yield client


AUTH = {"X-Semantic-Service-Key": "test-key", "Idempotency-Key": "idem-1"}
SPEC = {
    "modelId": "model-1", "modelVersionId": "v1",
    "homeWorkspaceId": "6512f0a1c9e77a001234aaa1",
    "concepts": [{
        "conceptId": "c1", "key": "customer", "label": "Customer",
        "identity": {"namespace": "crm", "keyComponents": ["customer_id"]},
        "populationMode": "materialized",
        "allowedFields": ["customer_id", "name"],
    }],
    "relations": [],
    "sourceScope": [{"workspaceId": "6512f0a1c9e77a001234aaa1",
                     "assetId": "6512f0a1c9e77a001234bbb1"}],
}
BODY = {
    "actorUserId": "user-1", "modelId": "model-1",
    "workspaceId": "6512f0a1c9e77a001234aaa1",
    "payload": {
        "modelVersionId": "v1", "specHash": canonical_spec_hash(SPEC), "purpose": "build",
        "specification": SPEC,
        "sources": [{
            "conceptId": "c1",
            "source": {"workspaceId": "6512f0a1c9e77a001234aaa1",
                       "assetId": "6512f0a1c9e77a001234bbb1", "mimeType": "text/csv"},
            "options": {},
            "columnMapping": {"customer_id": "customer_id", "name": "name"},
        }],
    },
}
# DiscoveryCommand accepts any payload dict, so the same body exercises the
# cross-operation idempotency fence.
DISCOVERY_BODY = dict(BODY)


def test_admission_commits_before_202_and_reuses_same_command(job_client: TestClient):
    first = job_client.post("/v1/semantic-model-population/runs", headers=AUTH, json=BODY)
    assert first.status_code == 202
    assert first.json() == {
        "jobId": "job-1",
        "status": "queued",
        "progressUrl": "/v1/semantic-model-jobs/job-1",
        "reused": False,
    }
    duplicate = job_client.post("/v1/semantic-model-population/runs", headers=AUTH, json=BODY)
    assert duplicate.status_code == 202
    assert duplicate.json()["reused"] is True
    assert duplicate.json()["jobId"] == "job-1"


def test_population_admission_accepts_document_mapping_and_rejects_mixed_shapes(
        job_client: TestClient):
    body = deepcopy(BODY)
    body["payload"]["sources"] = [{
        "conceptId": "c1", "sourceKind": "document",
        "source": {"workspaceId": "6512f0a1c9e77a001234aaa1",
                   "assetId": "6512f0a1c9e77a001234bbb1", "mimeType": "application/pdf"},
        "fieldMappings": [
            {"sourceField": "Customer ID", "targetAttribute": "customer_id", "mode": "extract"},
        ],
    }]
    assert job_client.post(
        "/v1/semantic-model-population/runs",
        headers={**AUTH, "Idempotency-Key": "document-1"}, json=body).status_code == 202

    body["payload"]["sources"][0]["columnMapping"] = {"id": "customer_id"}
    assert job_client.post(
        "/v1/semantic-model-population/runs",
        headers={**AUTH, "Idempotency-Key": "document-2"}, json=body).status_code == 422


def test_idempotency_key_with_different_payload_is_409(job_client: TestClient):
    assert job_client.post("/v1/semantic-model-population/runs", headers=AUTH, json=BODY).status_code == 202
    changed = {**BODY, "payload": {**BODY["payload"], "purpose": "refresh"}}
    response = job_client.post("/v1/semantic-model-population/runs", headers=AUTH, json=changed)
    assert response.status_code == 409


def test_idempotency_key_cannot_cross_operation_types(job_client: TestClient):
    # Same key, same command content: only the operation type differs.
    assert job_client.post(
        "/v1/semantic-model-population/runs", headers=AUTH, json=DISCOVERY_BODY
    ).status_code == 202
    response = job_client.post(
        "/v1/semantic-model-datasource/discoveries", headers=AUTH, json=DISCOVERY_BODY
    )
    assert response.status_code == 409


def test_job_and_event_replay_are_actor_scoped(job_client: TestClient):
    job_client.post("/v1/semantic-model-datasource/discoveries", headers=AUTH, json=DISCOVERY_BODY)
    own = {"X-Semantic-Service-Key": "test-key", "X-Actor-User-Id": "user-1"}
    other = {"X-Semantic-Service-Key": "test-key", "X-Actor-User-Id": "user-2"}
    assert job_client.get("/v1/semantic-model-jobs/job-1", headers=own).status_code == 200
    assert job_client.get("/v1/semantic-model-jobs/job-1", headers=other).status_code == 404
    replay = job_client.get(
        "/v1/semantic-model-jobs/events?jobId=job-1&after=0", headers=own
    )
    assert replay.status_code == 200
    assert replay.json()["items"][0]["eventType"] == "job.queued"


def test_missing_idempotency_key_is_rejected(job_client: TestClient):
    response = job_client.post(
        "/v1/semantic-model-population/runs",
        headers={"X-Semantic-Service-Key": "test-key"},
        json=BODY,
    )
    assert response.status_code == 422


def test_discovery_requires_canonical_workspace_at_admission(job_client: TestClient):
    """The worker authorizes against the canonical workspace, so admission must
    reject a missing or empty one instead of admitting a job it will fail."""
    for body in ({k: v for k, v in BODY.items() if k != "workspaceId"},
                 {**BODY, "workspaceId": ""}, {**BODY, "workspaceId": None}):
        response = job_client.post(
            "/v1/semantic-model-datasource/discoveries", headers=AUTH, json=body
        )
        assert response.status_code == 422, body
    accepted = job_client.post(
        "/v1/semantic-model-datasource/discoveries", headers=AUTH, json=DISCOVERY_BODY
    )
    assert accepted.status_code == 202
    # Population runs require the same canonical home workspace.
    for body in ({k: v for k, v in BODY.items() if k != "workspaceId"},
                 {**BODY, "workspaceId": ""}):
        response = job_client.post(
            "/v1/semantic-model-population/runs",
            headers={**AUTH, "Idempotency-Key": "idem-2"},
            json=body,
        )
        assert response.status_code == 422, body
    assert job_client.post(
        "/v1/semantic-model-population/runs",
        headers={**AUTH, "Idempotency-Key": "idem-3"},
        json=BODY,
    ).status_code == 202


def test_source_event_ingestion_is_authenticated_validated_and_idempotent(job_client: TestClient):
    event = {
        "eventId": "event-1",
        "eventType": "workspace.document.indexing_ready.v1",
        "occurredAt": "2026-09-20T12:00:00Z",
        "payload": {"workspaceId": "workspace-1", "documentId": "document-1",
                    "originalName": "report.pdf"},
    }
    url = "/v1/semantic-model-datasource/events"
    headers = {"X-Semantic-Service-Key": "test-key"}
    first = job_client.post(url, headers=headers, json=event)
    duplicate = job_client.post(url, headers=headers, json=event)

    assert first.status_code == 202
    assert first.json() == {"eventId": "event-1", "revision": 1,
                            "reused": False, "headAdvanced": True}
    assert duplicate.json() == {"eventId": "event-1", "revision": 1, "reused": True}
    assert job_client.post(url, json=event).status_code == 401
    assert job_client.post(url, headers=headers, json={**event, "eventType": "unknown"}).status_code == 422
