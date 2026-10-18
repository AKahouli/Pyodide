"""Isolated transport/claim regressions. No connection to a PostgreSQL database.

The claim fake checks SQL bindings/rotation, not PostgreSQL concurrency or fencing.
The actual schema-dropping DB harness requires an explicitly disposable database.
"""
from contextlib import asynccontextmanager
from datetime import datetime, timezone
import hashlib
import json

import httpx
import pytest

from app.datasource import asset_delivery as delivery
from app.jobs.models import Lease
from app.persistence.postgres_jobs import PostgresJobRepository


SOURCE = {"workspaceId": "6512f0a1c9e77a001234aaa1", "assetId": "6512f0a1c9e77a001234bbb2"}


def lease(capability="a" * 64, epoch=1, admission="backend-signed-admission"):
    return Lease(12, "11111111-1111-1111-1111-111111111111", "semantic-model-datasource.discover",
                 {"payload": {"assetAdmission": admission, "source": SOURCE, "options": {}}}, epoch, "worker-1",
                 datetime.now(timezone.utc), 1, capability)


@pytest.fixture
def env(monkeypatch):
    monkeypatch.setenv("YELLOWSTORM_BACKEND_URL", "http://backend.test")
    monkeypatch.setenv("SEMANTIC_RUNTIME_BACKEND_SERVICE_TOKEN", "runtime-only-token")


@pytest.mark.asyncio
async def test_naked_actor_and_legacy_service_key_cannot_request_a_grant(monkeypatch):
    monkeypatch.setenv("YELLOWSTORM_INTERNAL_SERVICE_TOKEN", "legacy-token")
    requests = []
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: requests.append(request))) as http:
        with pytest.raises(RuntimeError, match="asset_execution_authority_missing"):
            await delivery._asset_headers(http, SOURCE, "read")
    assert requests == []


@pytest.mark.parametrize("admission,capability", [(None, "a" * 64), ("", "a" * 64), ("signed", "")])
def test_binding_requires_both_persisted_admission_and_claim_secret(admission, capability):
    with pytest.raises(RuntimeError, match="asset_execution_authority_missing"):
        delivery.bind_asset_execution(lease(capability=capability, admission=admission))


@pytest.mark.asyncio
async def test_no_principal_configuration_fallback(env, monkeypatch):
    monkeypatch.delenv("SEMANTIC_RUNTIME_BACKEND_SERVICE_TOKEN")
    monkeypatch.setenv("YELLOWSTORM_INTERNAL_SERVICE_TOKEN", "legacy-token")
    context = delivery.bind_asset_execution(lease())
    try:
        async with httpx.AsyncClient() as http:
            with pytest.raises(RuntimeError, match="semantic_runtime_backend_service_token_missing"):
                await delivery._asset_headers(http, SOURCE, "read")
    finally:
        delivery.reset_asset_execution(context)


@pytest.mark.asyncio
@pytest.mark.parametrize("operation", ["metadata", "read", "derived-put", "dataset-put", "dataset-get"])
async def test_each_operation_refreshes_grant_from_claim_proof_only(env, operation):
    requests = []

    def handle(request):
        requests.append(request)
        return httpx.Response(200, json={"token": f"grant-{len(requests)}"})

    context = delivery.bind_asset_execution(lease())
    target = ({"fileName": "derived.txt"} if operation == "derived-put" else
              {"datasetId": "ds_" + "a" * 24} if operation.startswith("dataset-") else None)
    try:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as http:
            first = await delivery._asset_headers(http, SOURCE, operation, target)
            second = await delivery._asset_headers(http, SOURCE, operation, target)
        assert first["X-Semantic-Asset-Grant"] == "grant-1"
        assert second["X-Semantic-Asset-Grant"] == "grant-2"
        body = json.loads(requests[0].content)
        assert body == {"jobId": lease().job_id, "taskId": 12, "leaseEpoch": 1,
                        "leaseOwner": "worker-1", "capability": "a" * 64,
                        **SOURCE, "operation": operation, **({"target": {**target, "options": {}}} if target is not None else {})}
        assert "actorUserId" not in body
        assert requests[0].headers["x-yellowstorm-service-principal"] == "semantic-runtime"
        assert requests[0].headers["x-yellowstorm-service-token"] == "runtime-only-token"
        assert "x-internal-token" not in requests[0].headers
    finally:
        delivery.reset_asset_execution(context)
    assert delivery._execution.get() is None


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [401, 403, 307])
async def test_failed_grant_never_falls_back_to_asset_request(env, status):
    requests = []

    def handle(request):
        requests.append(request)
        return httpx.Response(status, headers={"location": "http://elsewhere.test"})

    context = delivery.bind_asset_execution(lease())
    try:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handle), follow_redirects=True) as http:
            with pytest.raises(delivery.AssetFetchError):
                await delivery.fetch_workspace_asset_metadata(SOURCE, "untrusted-selector", client=http)
        assert len(requests) == 1
        assert requests[0].url.path.endswith("/semantic-asset-grant")
    finally:
        delivery.reset_asset_execution(context)


@pytest.mark.asyncio
async def test_context_reset_restores_previous_task_authority(env):
    outer = delivery.bind_asset_execution(lease())
    inner = delivery.bind_asset_execution(lease(capability="b" * 64, epoch=2))
    assert delivery._execution.get()["leaseEpoch"] == 2
    delivery.reset_asset_execution(inner)
    assert delivery._execution.get()["capability"] == "a" * 64
    delivery.reset_asset_execution(outer)
    assert delivery._execution.get() is None


@pytest.mark.asyncio
async def test_dataset_requires_unambiguous_admitted_options_and_transmits_selected_scope(env):
    claimed = lease()
    claimed.payload["payload"].pop("source")
    claimed.payload["payload"]["sources"] = [
        {"source": SOURCE, "options": {"sheetName": "one"}},
        {"source": SOURCE, "options": {"sheetName": "two"}},
    ]
    seen = []

    def handle(request):
        seen.append(json.loads(request.content))
        return httpx.Response(200, json={"token": "scoped"})

    context = delivery.bind_asset_execution(claimed)
    try:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as http:
            with pytest.raises(RuntimeError, match="asset_options_scope_required"):
                await delivery._asset_headers(http, SOURCE, "dataset-put", {"datasetId": "ds_" + "a" * 24})
            assert seen == []
            await delivery._asset_headers(http, SOURCE, "dataset-put",
                                          {"datasetId": "ds_" + "a" * 24, "options": {"sheetName": "two"}})
        assert seen[0]["target"] == {"datasetId": "ds_" + "a" * 24, "options": {"sheetName": "two"}}
        assert "sourceScopes" not in seen[0]
    finally:
        delivery.reset_asset_execution(context)


class ClaimConnection:
    def __init__(self):
        self.epoch = 0
        self.checkpoint = {"restoredProgress": 7}
        self.calls = []

    @asynccontextmanager
    async def transaction(self):
        yield

    async def fetchrow(self, sql, *args):
        self.calls.append((sql, args))
        assert "lease_epoch = lease_epoch + 1" in sql
        assert "checkpoint = checkpoint || jsonb_build_object('assetCapabilityDigest', $5::text)" in sql
        assert "FOR UPDATE SKIP LOCKED" in sql
        self.epoch += 1
        self.checkpoint["assetCapabilityDigest"] = args[4]
        return {"id": 12, "job_id": lease().job_id, "task_name": lease().task_name,
                "payload": lease().payload, "lease_epoch": self.epoch, "lease_owner": args[1],
                "lease_expires_at": datetime.now(timezone.utc), "attempt_count": self.epoch}

    async def execute(self, *args):
        pass


class ClaimPool:
    def __init__(self):
        self.connection = ClaimConnection()

    @asynccontextmanager
    async def acquire(self):
        yield self.connection


@pytest.mark.asyncio
async def test_claim_rotates_secret_and_replaces_only_digest_preserving_checkpoint():
    pool = ClaimPool()
    repository = PostgresJobRepository(pool)
    first = await repository.claim_task(task_id=12, queue_name="queue", lease_owner="worker-1", lease_seconds=60)
    first_digest = hashlib.sha256(first.asset_capability.encode()).hexdigest()
    assert pool.connection.checkpoint["assetCapabilityDigest"] == first_digest
    second = await repository.claim_task(task_id=12, queue_name="queue", lease_owner="worker-2", lease_seconds=60)
    assert first.asset_capability != second.asset_capability
    assert second.lease_epoch == first.lease_epoch + 1
    assert pool.connection.checkpoint["assetCapabilityDigest"] != first_digest
    assert pool.connection.checkpoint["assetCapabilityDigest"] == hashlib.sha256(second.asset_capability.encode()).hexdigest()
    assert pool.connection.checkpoint["restoredProgress"] == 7
    assert first.asset_capability not in repr(pool.connection.calls)
    assert second.asset_capability not in repr(pool.connection.calls)
