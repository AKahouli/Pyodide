from __future__ import annotations

from datetime import datetime, timezone
import hashlib

import httpx
import pytest

from app.datasource.asset_delivery import (AssetFetchError, fetch_prepared_dataset, fetch_workspace_asset,
                                           fetch_workspace_asset_metadata, upload_prepared_dataset)
from app.workers.datasource_tasks import run_discovery_for_task, task_lease_seconds

WS = "6512f0a1c9e77a001234aaa1"
ASSET = "6512f0a1c9e77a001234bbb2"
BODY = b"id,name\n001,Ada\n"
HASH = hashlib.md5(BODY).hexdigest()
SOURCE = {
    "workspaceId": WS,
    "assetId": ASSET,
    "mimeType": "text/csv",
    "sizeBytes": len(BODY),
    "contentHash": HASH,
    "uploadedAt": "2026-09-20T12:00:00.000Z",
    "indexingStatus": "ready",
    "originalName": "people.csv",
}


class _AsyncBytes(httpx.AsyncByteStream):
    def __init__(self, body: bytes) -> None:
        self.body = body

    async def __aiter__(self):
        yield self.body


def _response(request: httpx.Request, *, body=BODY, status=200, **headers) -> httpx.Response:
    values = {
        "content-type": "text/csv",
        "content-length": str(len(body)),
        "x-yellowstorm-workspace-id": WS,
        "x-yellowstorm-asset-id": ASSET,
        "x-yellowstorm-source-size": str(len(body)),
        "x-yellowstorm-indexing-status": "ready",
        "x-yellowstorm-content-hash": HASH,
        "x-yellowstorm-uploaded-at": SOURCE["uploadedAt"],
        **headers,
    }
    return httpx.Response(status, headers=values, stream=_AsyncBytes(body), request=request)


@pytest.fixture(autouse=True)
def delivery_env(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("YELLOWSTORM_BACKEND_URL", "http://backend.test")
    monkeypatch.setenv("YELLOWSTORM_INTERNAL_SERVICE_TOKEN", "test-token")


def test_task_lease_covers_maximum_parser_and_fetch_window():
    assert task_lease_seconds(300) >= 300 + 35 + 25


@pytest.mark.asyncio
async def test_fetches_identity_bound_bytes_without_following_redirects():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["request"] = request
        return _response(request)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler), follow_redirects=False) as client:
        assert await fetch_workspace_asset(SOURCE, "6512f0a1c9e77a001234ccc3", client=client) == BODY
    request = seen["request"]
    assert request.headers["x-internal-token"] == "test-token"
    assert request.url.path == "/api/workspaces/internal/semantic-asset"
    assert request.url.params["workspaceId"] == WS
    assert request.url.params["documentId"] == ASSET


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("response", "code"),
    [
        (lambda request: httpx.Response(307, headers={"location": "http://elsewhere"}, request=request),
         "asset_redirected"),
        (lambda request: _response(request, **{"x-yellowstorm-content-hash": "f" * 32}),
         "asset_changed"),
        (lambda request: _response(request, status=403), "workspace_forbidden"),
    ],
)
async def test_rejects_redirect_stale_version_and_revoked_access(response, code):
    async with httpx.AsyncClient(transport=httpx.MockTransport(response), follow_redirects=False) as client:
        with pytest.raises(AssetFetchError, match=code):
            await fetch_workspace_asset(SOURCE, "6512f0a1c9e77a001234ccc3", client=client)


@pytest.mark.asyncio
async def test_rejects_same_length_storage_mutation_against_advertised_hash():
    changed = b"id,name\n001,Eve\n"

    def response(request: httpx.Request) -> httpx.Response:
        return _response(request, body=changed)

    async with httpx.AsyncClient(transport=httpx.MockTransport(response), follow_redirects=False) as client:
        with pytest.raises(AssetFetchError, match="asset_changed"):
            await fetch_workspace_asset(SOURCE, "6512f0a1c9e77a001234ccc3", client=client)


@pytest.mark.asyncio
async def test_reauthorizes_asset_metadata_without_downloading_content():
    seen = {}

    def response(request: httpx.Request) -> httpx.Response:
        seen["request"] = request
        return httpx.Response(200, json={
            **SOURCE, "uploaderUserId": "u1",
        }, request=request)

    async with httpx.AsyncClient(transport=httpx.MockTransport(response)) as client:
        current = await fetch_workspace_asset_metadata(SOURCE, "u1", client=client)
    assert current["contentHash"] == HASH
    assert seen["request"].url.path == "/api/workspaces/internal/semantic-asset-metadata"


@pytest.mark.asyncio
async def test_upload_rejects_malformed_success_as_infrastructure(tmp_path):
    artifact = tmp_path / "dataset.parquet"
    artifact.write_bytes(b"PAR1dataPAR1")
    manifest = {"datasetId": "ds_0123456789abcdef01234567", "sizeBytes": artifact.stat().st_size,
                "contentHash": f"sha256:{hashlib.sha256(artifact.read_bytes()).hexdigest()}"}

    def malformed(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"not-json", request=request)

    async with httpx.AsyncClient(transport=httpx.MockTransport(malformed)) as client:
        with pytest.raises(RuntimeError, match="invalid_dataset_response"):
            await upload_prepared_dataset(SOURCE, "6512f0a1c9e77a001234ccc3", manifest, artifact,
                                          client=client)


@pytest.mark.asyncio
async def test_downloads_identity_bound_dataset_and_verifies_hash(tmp_path):
    body = b"PAR1dataPAR1"
    dataset_id = "ds_0123456789abcdef01234567"
    content_hash = f"sha256:{hashlib.sha256(body).hexdigest()}"
    manifest = {"datasetId": dataset_id, "sizeBytes": len(body), "contentHash": content_hash}
    seen = {}

    def response(request: httpx.Request) -> httpx.Response:
        seen["request"] = request
        return httpx.Response(200, headers={
            "content-type": "application/vnd.apache.parquet",
            "content-length": str(len(body)),
            "x-yellowstorm-workspace-id": WS,
            "x-yellowstorm-asset-id": ASSET,
            "x-yellowstorm-dataset-id": dataset_id,
            "x-yellowstorm-content-hash": content_hash,
        }, stream=_AsyncBytes(body), request=request)

    target = tmp_path / "dataset.parquet"
    async with httpx.AsyncClient(transport=httpx.MockTransport(response)) as client:
        assert await fetch_prepared_dataset(
            SOURCE, "6512f0a1c9e77a001234ccc3", manifest, target, client=client) == target
    assert target.read_bytes() == body
    assert seen["request"].headers["accept-encoding"] == "identity"
    assert seen["request"].url.params["datasetId"] == dataset_id


@pytest.mark.asyncio
async def test_dataset_download_removes_partial_file_on_bad_hash(tmp_path):
    body = b"PAR1changedPAR1"
    dataset_id = "ds_0123456789abcdef01234567"
    expected_hash = f"sha256:{'a' * 64}"
    manifest = {"datasetId": dataset_id, "sizeBytes": len(body), "contentHash": expected_hash}

    def response(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, headers={
            "content-type": "application/vnd.apache.parquet",
            "content-length": str(len(body)),
            "x-yellowstorm-workspace-id": WS,
            "x-yellowstorm-asset-id": ASSET,
            "x-yellowstorm-dataset-id": dataset_id,
            "x-yellowstorm-content-hash": expected_hash,
        }, stream=_AsyncBytes(body), request=request)

    target = tmp_path / "dataset.parquet"
    async with httpx.AsyncClient(transport=httpx.MockTransport(response)) as client:
        with pytest.raises(RuntimeError, match="invalid_dataset_response"):
            await fetch_prepared_dataset(
                SOURCE, "6512f0a1c9e77a001234ccc3", manifest, target, client=client)
    assert not target.exists()


@pytest.mark.asyncio
async def test_dataset_download_rejects_manifest_length_mismatch(tmp_path):
    body = b"PAR1dataPAR1"
    dataset_id = "ds_0123456789abcdef01234567"
    content_hash = f"sha256:{hashlib.sha256(body).hexdigest()}"
    manifest = {"datasetId": dataset_id, "sizeBytes": len(body) + 1, "contentHash": content_hash}

    def response(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, headers={
            "content-type": "application/vnd.apache.parquet",
            "content-length": str(len(body)),
            "x-yellowstorm-workspace-id": WS,
            "x-yellowstorm-asset-id": ASSET,
            "x-yellowstorm-dataset-id": dataset_id,
            "x-yellowstorm-content-hash": content_hash,
        }, stream=_AsyncBytes(body), request=request)

    target = tmp_path / "dataset.parquet"
    async with httpx.AsyncClient(transport=httpx.MockTransport(response)) as client:
        with pytest.raises(RuntimeError, match="invalid_dataset_response"):
            await fetch_prepared_dataset(
                SOURCE, "6512f0a1c9e77a001234ccc3", manifest, target, client=client)
    assert not target.exists()


@pytest.mark.asyncio
async def test_worker_fetches_and_profiles_ready_tabular_source():
    calls = []

    async def fetch(source, actor):
        calls.append((source, actor))
        return BODY

    async def upload(source, actor, manifest, path):
        assert path.read_bytes().startswith(b"PAR1")
        return manifest

    command = {"actorUserId": "6512f0a1c9e77a001234ccc3", "workspaceId": WS,
               "payload": {"source": SOURCE}}
    outcome = await run_discovery_for_task(command, fetch=fetch, upload=upload)
    assert outcome["ok"] is True
    assert outcome["profile"]["coverage"]["sampled"] is True
    assert outcome["profile"]["samples"][0]["id"] == "001"
    assert outcome["fieldProfiles"][0]["name"] == "id"
    assert outcome["dataset"]["rowCount"] == 1
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_worker_does_not_fetch_terminal_or_oversized_source():
    async def unexpected(*_args):
        raise AssertionError("fetch should not run")

    command = {"actorUserId": "6512f0a1c9e77a001234ccc3", "workspaceId": WS,
               "payload": {"source": {**SOURCE, "sizeBytes": 50 * 1024 * 1024 + 1}}}
    outcome = await run_discovery_for_task(command, fetch=unexpected)
    assert outcome["ok"] is True
    assert outcome["profile"]["status"] == "partial"


@pytest.mark.asyncio
async def test_run_task_requeues_asset_infrastructure_failures(monkeypatch: pytest.MonkeyPatch):
    import asyncpg
    import app.datasource.asset_delivery as delivery
    import app.datasource.parser_sandbox as sandbox
    from app.jobs.models import Lease
    from app.persistence.postgres_jobs import PostgresJobRepository
    from app.workers.datasource_tasks import _run_task

    command = {"actorUserId": "6512f0a1c9e77a001234ccc3", "workspaceId": WS,
               "payload": {"source": SOURCE}}
    lease = Lease(task_id=7, job_id="job", task_name="discover", payload=command,
                  lease_epoch=1, lease_owner="worker",
                  lease_expires_at=datetime.now(timezone.utc))
    calls = {"requeue": 0, "complete": 0, "lease_seconds": 0}

    class Pool:
        async def close(self):
            return None

    async def create_pool(*_args, **_kwargs):
        return Pool()

    async def claim(*_args, **kwargs):
        calls["lease_seconds"] = kwargs["lease_seconds"]
        return lease

    async def requeue(*_args, **_kwargs):
        calls["requeue"] += 1

    async def complete(*_args, **_kwargs):
        calls["complete"] += 1

    async def unavailable(*_args, **_kwargs):
        raise httpx.ConnectError("backend unavailable")

    monkeypatch.setenv("SEMANTIC_RUNTIME_DATABASE_URL", "postgresql://test")
    monkeypatch.setattr(asyncpg, "create_pool", create_pool)
    monkeypatch.setattr(PostgresJobRepository, "claim_task", claim)
    monkeypatch.setattr(PostgresJobRepository, "requeue_task", requeue)
    monkeypatch.setattr(PostgresJobRepository, "complete_task", complete)
    monkeypatch.setattr(delivery, "fetch_workspace_asset", unavailable)

    with pytest.raises(httpx.ConnectError):
        await _run_task(7, "worker")
    assert calls == {"requeue": 1, "complete": 0, "lease_seconds": task_lease_seconds(30)}

    async def fetched(*_args, **_kwargs):
        return BODY

    def bootstrap_failed(*_args, **_kwargs):
        raise RuntimeError("parser_bootstrap_failed")

    monkeypatch.setattr(delivery, "fetch_workspace_asset", fetched)
    monkeypatch.setattr(sandbox, "prepare_dataset_subprocess", bootstrap_failed)
    with pytest.raises(RuntimeError, match="parser_bootstrap_failed"):
        await _run_task(7, "worker")
    assert calls["requeue"] == 2
    assert calls["complete"] == 0

    async def malformed_upload(*_args, **_kwargs):
        raise RuntimeError("invalid_dataset_response")

    monkeypatch.undo()
    monkeypatch.setenv("SEMANTIC_RUNTIME_DATABASE_URL", "postgresql://test")
    monkeypatch.setattr(asyncpg, "create_pool", create_pool)
    monkeypatch.setattr(PostgresJobRepository, "claim_task", claim)
    monkeypatch.setattr(PostgresJobRepository, "requeue_task", requeue)
    monkeypatch.setattr(PostgresJobRepository, "complete_task", complete)
    monkeypatch.setattr(delivery, "fetch_workspace_asset", fetched)
    monkeypatch.setattr(delivery, "upload_prepared_dataset", malformed_upload)
    with pytest.raises(RuntimeError, match="invalid_dataset_response"):
        await _run_task(7, "worker")
    assert calls["requeue"] == 3
    assert calls["complete"] == 0
