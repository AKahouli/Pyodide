"""Direct LiteLLM inference, migrated extraction semantics and fail-closed identities."""

from __future__ import annotations

import asyncio
import json

import httpx
import pytest

from app.datasource import attribute_extraction as module
from app.datasource.attribute_extraction import AttributeExtractionError, extract_attributes, profile_from_env
from app.datasource.extraction_prompt import normalize_text

REQUEST = {"model_id": "model-1", "concept_id": "contract", "concept_label": "Contract",
           "document_id": "doc-1", "file_name": "agreement.pdf",
           "attributes": [{"key": "contract_number"}, {"key": "title"}],
           "sections": [{"sectionPk": 7, "blockPk": 9, "content": "Contract number CNT-1"}]}


@pytest.fixture(autouse=True)
def configure(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("SEMANTIC_AI_BASE_URL", "http://litellm.test")
    monkeypatch.setenv("SEMANTIC_AI_API_KEY", "runtime-test-key")
    monkeypatch.setenv("SEMANTIC_AI_MODEL", "extractor-test")
    for key in ("SEMANTIC_AI_MAX_TOKENS", "SEMANTIC_AI_TIMEOUT_SECONDS", "SEMANTIC_AI_PARALLEL_CALLS",
                "YELLOWSTORM_INTERNAL_SERVICE_TOKEN", "YELLOWSTORM_BACKEND_URL"):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setattr(module, "BASE_DELAY_SECONDS", 0)


def content(instances=None):
    if instances is None:
        instances = [{"label": "CNT-1", "attributes": [
            {"key": "contract_number", "value": "CNT-1",
             "evidenceReferences": ["section:7/block:9", "section:999/block:999"]},
            {"key": "invented_field", "value": "bad", "evidenceReferences": ["section:7/block:9"]}]}]
    return {"extractions": [{"conceptKey": "contract", "instances": instances}]}


def response(payload=None, finish="stop"):
    return {"choices": [{"message": {"content": json.dumps(payload if payload is not None else content())},
                         "finish_reason": finish}]}


@pytest.mark.asyncio
async def test_calls_only_litellm_and_keeps_supplied_fields_and_references():
    seen = []

    def answer(request):
        seen.append(request)
        return httpx.Response(200, json=response())

    async with httpx.AsyncClient(transport=httpx.MockTransport(answer)) as client:
        result = await extract_attributes(**REQUEST, ai_extraction=profile_from_env().identity, client=client)
    assert str(seen[0].url) == "http://litellm.test/v1/chat/completions"
    assert seen[0].headers["Authorization"] == "Bearer runtime-test-key"
    assert "X-Internal-Token" not in seen[0].headers
    body = json.loads(seen[0].content)
    assert body["model"] == "extractor-test" and body["max_tokens"] == 32000
    assert "CNT-1" in body["messages"][0]["content"] and "agreement.pdf" in body["messages"][0]["content"]
    assert result["values"] == [{"key": "contract_number", "value": "CNT-1", "evidenceReferences": ["section:7/block:9"]}]
    assert result["failed"] == ["title"] and "records" not in result
    assert result["extractorVersion"] == "ai-attribute-v2"


@pytest.mark.asyncio
async def test_multiple_records_and_first_value_semantics():
    instances = [{"label": value, "attributes": [{"key": "contract_number", "value": value,
                                                  "evidenceReferences": ["section:7/block:9"]}]}
                 for value in ("CNT-1", "CNT-2")]
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(200, json=response(content(instances))))) as client:
        result = await extract_attributes(**REQUEST, ai_extraction=profile_from_env().identity, multiple=True, client=client)
    assert [record["values"][0]["value"] for record in result["records"]] == ["CNT-1", "CNT-2"]
    assert result["values"][0]["value"] == "CNT-1"


@pytest.mark.asyncio
@pytest.mark.parametrize("identity,code", [
    (None, "ai_extraction_identity_missing"),
    ({"agentSlug": "old", "model": "m", "contractVersion": "ai-attribute-v1"},
     "ai_extraction_identity_incompatible_rebuild_required"),
])
async def test_missing_and_legacy_identity_rejected_before_network(identity, code):
    with pytest.raises(AttributeExtractionError) as error:
        await extract_attributes(**REQUEST, ai_extraction=identity)
    assert error.value.code == code


@pytest.mark.asyncio
@pytest.mark.parametrize("changed", [{"model": "other"}, {"maxTokens": 1000}, {"promptVersion": "old"}])
async def test_profile_changes_rejected_before_network(changed):
    with pytest.raises(AttributeExtractionError) as error:
        await extract_attributes(**REQUEST, ai_extraction={**profile_from_env().identity, **changed})
    assert error.value.code == "ai_extraction_profile_changed_rebuild_required"


@pytest.mark.asyncio
async def test_no_evidence_never_calls_gateway():
    with pytest.raises(AttributeExtractionError, match="no_evidence"):
        await extract_attributes(**{**REQUEST, "sections": []}, ai_extraction=profile_from_env().identity)


@pytest.mark.parametrize("key,value", [("SEMANTIC_AI_API_KEY", ""), ("SEMANTIC_AI_MODEL", ""),
    ("SEMANTIC_AI_TIMEOUT_SECONDS", "nan"), ("SEMANTIC_AI_MAX_TOKENS", "0"),
    ("SEMANTIC_AI_PARALLEL_CALLS", "65"), ("SEMANTIC_AI_BASE_URL", "http://key:secret@gateway.test")])
def test_configuration_fails_closed(key, value, monkeypatch):
    monkeypatch.setenv(key, value)
    with pytest.raises(AttributeExtractionError):
        profile_from_env()


@pytest.mark.asyncio
async def test_retry_transient_failures_and_do_not_retry_auth_refusal():
    statuses = [429, 503, 200]
    seen = []

    def answer(_):
        code = statuses[len(seen)]
        seen.append(code)
        return httpx.Response(code, json=response(), headers={"Retry-After": "0"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(answer)) as client:
        await extract_attributes(**REQUEST, ai_extraction=profile_from_env().identity, client=client)
    assert seen == statuses
    seen.clear()

    def refused(_):
        seen.append(401)
        return httpx.Response(401, json={"error": "private upstream detail"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(refused)) as client:
        with pytest.raises(AttributeExtractionError) as error:
            await extract_attributes(**REQUEST, ai_extraction=profile_from_env().identity, client=client)
    assert seen == [401] and str(error.value) == "attribute_extraction_unavailable"


@pytest.mark.asyncio
async def test_lasting_throttle_has_bounded_attempts():
    seen = []

    def answer(_):
        seen.append(429)
        return httpx.Response(429, headers={"Retry-After": "0"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(answer)) as client:
        with pytest.raises(AttributeExtractionError, match="attribute_extraction_throttled"):
            await extract_attributes(**REQUEST, ai_extraction=profile_from_env().identity, client=client)
    assert len(seen) == module.MAX_ATTEMPTS


@pytest.mark.asyncio
@pytest.mark.parametrize("body", [response(finish="length"), response({"extractions": []}),
                                 response({"extractions": [{"conceptKey": "contract", "instances": None}]}),
                                 {"choices": []}])
async def test_malformed_or_truncated_response_is_not_success(body):
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(200, json=body))) as client:
        with pytest.raises(AttributeExtractionError, match="invalid_attribute_extraction_response"):
            await extract_attributes(**REQUEST, ai_extraction=profile_from_env().identity, client=client)


@pytest.mark.asyncio
async def test_no_instances_is_valid_and_placeholder_or_filename_values_are_filtered():
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(200, json=response(content([]))))) as client:
        result = await extract_attributes(**REQUEST, ai_extraction=profile_from_env().identity, client=client)
    assert result["values"] == [] and result["failed"] == ["contract_number", "title"]
    invalid = [{"label": "Contract", "attributes": [{"key": "title", "value": value}]} for value in ("unknown", "agreement.pdf", "")]
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(200, json=response(content(invalid))))) as client:
        result = await extract_attributes(**REQUEST, ai_extraction=profile_from_env().identity, client=client)
    assert result["values"] == []


@pytest.mark.asyncio
async def test_concurrency_is_bounded(monkeypatch):
    monkeypatch.setenv("SEMANTIC_AI_PARALLEL_CALLS", "1")
    active = peak = 0

    async def answer(_):
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        await asyncio.sleep(0)
        active -= 1
        return httpx.Response(200, json=response())

    async with httpx.AsyncClient(transport=httpx.MockTransport(answer)) as client:
        await asyncio.gather(*(extract_attributes(**REQUEST, ai_extraction=profile_from_env().identity, client=client) for _ in range(4)))
    assert peak == 1


def test_normalization_and_secret_free_profile():
    assert normalize_text('\u201cCNT\u20132026\u201d\tcustomer  id\u2014note\u2026\r\n\r\n\r\nnext\r') == '"CNT-2026" customer id--note...\n\nnext'
    assert "runtime-test-key" not in repr(profile_from_env())
    assert "runtime-test-key" not in json.dumps(profile_from_env().identity)


@pytest.mark.asyncio
async def test_unsupported_json_mode_fails_closed_without_retry_or_fallback():
    seen = []

    def answer(request):
        seen.append(json.loads(request.content))
        return httpx.Response(400, json={"error": {"message": "Unsupported parameter: response_format"}})

    async with httpx.AsyncClient(transport=httpx.MockTransport(answer)) as client:
        with pytest.raises(AttributeExtractionError, match="attribute_extraction_unavailable"):
            await extract_attributes(**REQUEST, ai_extraction=profile_from_env().identity, client=client)
    assert len(seen) == 1 and seen[0]["response_format"] == {"type": "json_object"}
