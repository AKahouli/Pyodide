"""Runtime API and queued-job boundaries for autonomous semantic inference."""

from __future__ import annotations

import copy
import json

import httpx
import pytest
from starlette.testclient import TestClient

from app.datasource import attribute_extraction as extraction
from app.main import create_app
from app.workers.population_tasks import run_population_for_task
from test_jobs import BODY, MemoryRepository

AUTH = {"X-Semantic-Service-Key": "runtime-test-key"}
PREFIX = "/v1/semantic-model-population"


@pytest.fixture
def configured(monkeypatch):
    for key in ("SEMANTIC_RUNTIME_DATABASE_URL", "SEMANTIC_INDEX_DATABASE_URL", "SEMANTIC_AGEGRAPH_DATABASE_URL",
                "YELLOWSTORM_INTERNAL_SERVICE_TOKEN", "YELLOWSTORM_BACKEND_URL"):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("SEMANTIC_RUNTIME_SERVICE_KEY", "runtime-test-key")
    monkeypatch.setenv("SEMANTIC_MODEL_RUNTIME_WRITES_ENABLED", "true")
    monkeypatch.setenv("SEMANTIC_AI_BASE_URL", "http://litellm.test/v1")
    monkeypatch.setenv("SEMANTIC_AI_API_KEY", "gateway-test-key")
    monkeypatch.setenv("SEMANTIC_AI_MODEL", "extractor-test")
    return monkeypatch


def test_profile_is_authenticated_and_contains_no_credentials(configured):
    with TestClient(create_app()) as client:
        assert client.get(PREFIX + "/ai-extraction/profile").status_code == 401
        response = client.get(PREFIX + "/ai-extraction/profile", headers=AUTH)
        assert response.status_code == 200
        assert response.json() == extraction.profile_from_env().identity
        assert "gateway-test-key" not in response.text
        configured.delenv("SEMANTIC_AI_API_KEY")
        assert client.get(PREFIX + "/ai-extraction/profile", headers=AUTH).status_code == 503


def test_api_inference_works_without_adk_backend_or_database(configured):
    seen = []

    def answer(request):
        seen.append(str(request.url))
        output = {"extractions": [{"conceptKey": "contract", "instances": [{"label": "CNT-1", "attributes": [
            {"key": "id", "value": "CNT-1", "evidenceReferences": ["section:7/block:9", "invented"]}]}]}]}
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(output)}, "finish_reason": "stop"}]})

    original = httpx.AsyncClient
    configured.setattr(extraction.httpx, "AsyncClient", lambda **kwargs: original(transport=httpx.MockTransport(answer), **kwargs))
    body = {"modelId": "m", "conceptId": "contract", "attributes": [{"key": "id"}],
            "sections": [{"sectionPk": 7, "blockPk": 9, "content": "Contract CNT-1"}]}
    with TestClient(create_app()) as client:
        assert client.post(PREFIX + "/ai-extraction/extract", json=body).status_code == 401
        response = client.post(PREFIX + "/ai-extraction/extract", headers=AUTH, json=body)
        assert response.status_code == 200
        assert response.json()["values"][0]["evidenceReferences"] == ["section:7/block:9"]
        assert seen == ["http://litellm.test/v1/chat/completions"]
        override = client.post(PREFIX + "/ai-extraction/extract", headers=AUTH, json={**body, "model": "override"})
        assert override.status_code == 422
        legacy = client.post(PREFIX + "/ai-extraction/extract", headers=AUTH, json={**body, "aiExtraction": {
            "agentSlug": "old", "model": "m", "contractVersion": "ai-attribute-v1"}})
        assert legacy.status_code == 409 and legacy.json()["detail"].endswith("rebuild_required")


@pytest.mark.asyncio
async def test_worker_rejects_legacy_queued_identity_before_fetch(configured):
    command = copy.deepcopy(BODY)
    command["payload"]["aiExtraction"] = {"agentSlug": "old", "model": "m", "contractVersion": "ai-attribute-v1"}

    async def forbidden(*args, **kwargs):
        pytest.fail("legacy job fetched an asset")

    result = await run_population_for_task(command, fetch=forbidden)
    assert result["ok"] is False
    assert result["errorCode"] == "ai_extraction_identity_incompatible_rebuild_required"


def test_admission_pins_runtime_identity_and_rejects_legacy_identity(configured):
    class CapturingRepository(MemoryRepository):
        async def admit(self, **kwargs):
            self.command = kwargs["command"].model_dump(by_alias=True, mode="json")
            return await super().admit(**kwargs)

    body = copy.deepcopy(BODY)
    body["payload"]["sources"][0]["columnMapping"].pop("name")
    body["payload"]["sources"][0]["fieldExtractions"] = {
        "name": {"column": "name", "extractionStrategy": "ai"}}
    repository = CapturingRepository()
    headers = {**AUTH, "Idempotency-Key": "ai-admission"}
    with TestClient(create_app(repository)) as client:
        admitted = client.post(PREFIX + "/runs", headers=headers, json=body)
        assert admitted.status_code == 202, admitted.text
        assert repository.command["payload"]["aiExtraction"] == extraction.profile_from_env().identity
        reused = client.post(PREFIX + "/runs", headers=headers, json=body)
        assert reused.json()["reused"] is True
        body["payload"]["aiExtraction"] = {"agentSlug": "old", "model": "m", "contractVersion": "ai-attribute-v1"}
        rejected = client.post(PREFIX + "/runs", headers={**AUTH, "Idempotency-Key": "legacy"}, json=body)
        assert rejected.status_code == 409 and rejected.json()["detail"].endswith("rebuild_required")


@pytest.mark.asyncio
@pytest.mark.parametrize("kind,code", [
    ("changed", "ai_extraction_profile_changed_rebuild_required"),
    ("missing", "ai_extraction_identity_missing"),
    ("legacy", "ai_extraction_identity_incompatible_rebuild_required"),
])
async def test_worker_rejects_invalid_identity_before_cache_fetch_or_metadata(configured, kind, code):
    command = copy.deepcopy(BODY)
    command["payload"]["sources"][0]["columnMapping"].pop("name")
    command["payload"]["sources"][0]["fieldExtractions"] = {
        "name": {"column": "name", "extractionStrategy": "ai"}}
    if kind == "changed":
        command["payload"]["aiExtraction"] = extraction.profile_from_env().identity
        configured.setenv("SEMANTIC_AI_MODEL", "replacement-model")
    elif kind == "legacy":
        command["payload"]["aiExtraction"] = {"agentSlug": "old", "model": "m", "contractVersion": "ai-attribute-v1"}

    class ForbiddenCache:
        async def get(self, *args, **kwargs):
            pytest.fail("invalid identity reused an extraction cache entry")

    async def forbidden(*args, **kwargs):
        pytest.fail("invalid identity fetched an asset or its metadata")

    result = await run_population_for_task(command, fetch=forbidden, metadata_fetch=forbidden,
                                           extraction_cache=ForbiddenCache())
    assert result["ok"] is False
    assert result["errorCode"] == code


def test_answer_profile_changes_invalidate_revision_and_extraction_cache(configured):
    from app.persistence.extraction_cache import extraction_cache_key
    from app.workers.population_tasks import population_execution_fingerprint
    from test_population_fingerprint import SOURCE

    identity = extraction.profile_from_env().identity
    fingerprint = population_execution_fingerprint("spec", [SOURCE], [], identity)
    cache_key = extraction_cache_key({"document": "same", "aiExtraction": identity})
    for changed in ({"model": "other-model"}, {"maxTokens": 1000}, {"promptVersion": "new-prompt"}):
        altered = {**identity, **changed}
        assert population_execution_fingerprint("spec", [SOURCE], [], altered) != fingerprint
        assert extraction_cache_key({"document": "same", "aiExtraction": altered}) != cache_key
    configured.setenv("SEMANTIC_AI_PARALLEL_CALLS", "1")
    configured.setenv("SEMANTIC_AI_TIMEOUT_SECONDS", "30")
    assert extraction.profile_from_env().identity == identity


def test_ai_free_admission_does_not_require_litellm_configuration(configured):
    configured.delenv("SEMANTIC_AI_API_KEY")
    with TestClient(create_app(MemoryRepository())) as client:
        response = client.post(PREFIX + "/runs", headers={**AUTH, "Idempotency-Key": "no-ai"}, json=BODY)
        assert response.status_code == 202


@pytest.mark.asyncio
async def test_cell_reader_accepts_generated_litellm_values_with_supplied_citations(configured):
    from app.population.cell_fields import CellReader, normalize_field_extractions

    requested = []

    def answer(request):
        requested.append(str(request.url))
        payload = {"extractions": [{"conceptKey": "c1", "instances": [{"label": "Customer", "attributes": [
            {"key": "country", "value": "France", "evidenceReferences": ["section:1/block:1"]},
            {"key": "city", "value": "Invented city", "evidenceReferences": ["section:1/block:1"]}]}]}]}
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(payload)}, "finish_reason": "stop"}]})

    original = httpx.AsyncClient
    configured.setattr(extraction.httpx, "AsyncClient", lambda **kwargs: original(transport=httpx.MockTransport(answer), **kwargs))
    specs = normalize_field_extractions({key: {"column": "notes", "extractionStrategy": "ai"} for key in ("country", "city")})
    context = {"conceptId": "c1", "conceptLabel": "Customer", "source": {"assetId": "a"},
               "assetRef": {"assetId": "a"}, "modelId": "m", "mappingVersion": "v",
               "aiExtraction": extraction.profile_from_env().identity}
    [read] = await CellReader(specs, context).read_rows([(2, {"notes": "Pays: France"})])
    assert read["values"] == {"country": "France", "city": "Invented city"}
    assert read["evidence"]["country"]["extractorVersion"] == "ai-attribute-v2"
    assert read["evidence"]["country"]["column"] == "notes"
    assert read["evidence"]["country"]["rowNumber"] == 2
    assert requested == ["http://litellm.test/v1/chat/completions"]
