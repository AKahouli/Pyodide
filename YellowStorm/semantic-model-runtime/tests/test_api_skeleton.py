"""Phase 2A skeleton acceptance (P2.1-P2.3, P2.10)."""

import os

import pytest

fastapi = pytest.importorskip("fastapi")
TestClient = pytest.importorskip("starlette.testclient", reason="starlette TestClient required").TestClient

os.environ.setdefault("SEMANTIC_RUNTIME_SERVICE_KEY", "test-key")

from app.main import MAX_BODY_BYTES, create_app  # noqa: E402

client = TestClient(create_app())
AUTH = {"X-Semantic-Service-Key": "test-key"}


def test_live_and_ready_need_no_auth():
    live = client.get("/health/live")
    assert live.status_code == 200
    assert live.headers["X-Request-Id"]
    ready = client.get("/health/ready")
    assert ready.status_code == 200
    assert "brokerConfigured" in ready.json()


def test_openapi_has_three_groups():
    spec = client.get("/openapi.json").json()
    paths = " ".join(spec["paths"])
    assert "semantic-model-datasource" in paths
    assert "semantic-model-population" in paths
    assert "semantic-model-jobs" in paths


def test_private_routes_require_service_key():
    assert client.post("/v1/semantic-model-datasource/discoveries").status_code == 401
    assert client.post("/v1/semantic-model-population/runs").status_code == 401


def _population_body() -> dict:
    from app.population.compiler import canonical_spec_hash

    spec = {
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
    return {
        "actorUserId": "user-1", "modelId": "model-1",
        "workspaceId": "6512f0a1c9e77a001234aaa1",
        "payload": {
            "modelVersionId": "v1", "specHash": canonical_spec_hash(spec),
            "purpose": "build", "specification": spec,
            "sources": [{
                "conceptId": "c1",
                "source": {"workspaceId": "6512f0a1c9e77a001234aaa1",
                           "assetId": "6512f0a1c9e77a001234bbb1", "mimeType": "text/csv"},
                "columnMapping": {"customer_id": "customer_id"},
            }],
        },
    }


def test_no_durable_store_means_503_never_202():
    # §5.1: 202 only after a job is durably recorded. No store yet -> 503.
    body = {"actorUserId": "user-1", "payload": {}}
    discovery = {**body, "workspaceId": "6512f0a1c9e77a001234aaa1"}
    headers = {**AUTH, "Idempotency-Key": "idem-1"}
    r = client.post("/v1/semantic-model-datasource/discoveries", headers=headers, json=discovery)
    assert r.status_code == 503
    r = client.post("/v1/semantic-model-population/runs", headers=headers,
                    json=_population_body())
    assert r.status_code == 503
    r = client.get(
        "/v1/semantic-model-jobs/abc",
        headers={**AUTH, "X-Actor-User-Id": "user-1"},
    )
    assert r.status_code == 503


def test_body_limit_is_413():
    big = "x" * (MAX_BODY_BYTES + 1)
    r = client.post("/v1/semantic-model-datasource/discoveries", headers=AUTH, content=big)
    assert r.status_code == 413


def _fake_request(chunks: list[bytes]) -> object:
    from starlette.requests import Request

    messages = [
        {"type": "http.request", "body": c, "more_body": i < len(chunks) - 1}
        for i, c in enumerate(chunks)
    ]
    it = iter(messages)

    async def receive() -> dict:
        return next(it)

    # No content-length header: exercises the streaming enforcement path.
    return Request({"type": "http", "method": "POST", "headers": []}, receive)


def test_streamed_body_without_content_length_is_bounded():
    import asyncio

    from app.main import check_body_size

    oversized = _fake_request([b"x" * 100_000] * 3)
    assert asyncio.run(check_body_size(oversized)) == "too_large"

    small = _fake_request([b"hello"])
    assert asyncio.run(check_body_size(small)) == "ok"


def test_unreadable_body_is_400_not_silent_empty():
    async def failing_receive() -> dict:
        raise ConnectionError("boom")

    from starlette.requests import Request

    req = Request({"type": "http", "method": "POST", "headers": []}, failing_receive)
    import asyncio

    from app.main import check_body_size

    assert asyncio.run(check_body_size(req)) == "read_error"


def _assert_no_heavy_libs_in_fresh_process(imports: str) -> None:
    """Hermetic heavy-lib check: sibling tests may import anything, so the
    assertion runs in a fresh interpreter importing only the given modules."""
    import subprocess
    import sys as _sys
    from pathlib import Path

    code = (
        f"import sys, {imports}; "
        "heavy = [m for m in ('openpyxl', 'xlrd', 'duckdb', 'torch', "
        "'sentence_transformers') if m in sys.modules]; "
        "assert not heavy, heavy; print('lazy-ok')"
    )
    completed = subprocess.run(
        [_sys.executable, "-c", code],
        cwd=Path(__file__).resolve().parents[1],
        capture_output=True, text=True, timeout=60,
    )
    assert completed.returncode == 0, completed.stderr
    assert "lazy-ok" in completed.stdout


def test_api_import_pulls_no_heavy_libs():
    _assert_no_heavy_libs_in_fresh_process("app.main")


def test_worker_entries_import_without_heavy_libs():
    _assert_no_heavy_libs_in_fresh_process(
        "app.workers.datasource_tasks, app.workers.population_tasks")
