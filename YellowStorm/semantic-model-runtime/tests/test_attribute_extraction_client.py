"""The AI extraction client must refuse to call without a bound extractor identity."""

from __future__ import annotations

import pytest

from app.datasource.attribute_extraction import AttributeExtractionError, extract_attributes

REQUEST = {
    "model_id": "model-1",
    "concept_id": "contract",
    "concept_label": "Contract",
    "document_id": "doc-1",
    "file_name": "agreement.pdf",
    "attributes": [{"key": "contract_number"}],
    "sections": [{"sectionPk": 7, "blockPk": 9, "content": "Contract number CNT-1"}],
}


@pytest.mark.asyncio
async def test_missing_internal_token_is_rejected_before_any_call(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("YELLOWSTORM_INTERNAL_SERVICE_TOKEN", raising=False)
    with pytest.raises(AttributeExtractionError) as error:
        await extract_attributes(**REQUEST, ai_extraction={"agentSlug": "a", "model": "m", "contractVersion": "v"})
    assert error.value.code == "internal_service_token_missing"


@pytest.mark.asyncio
async def test_missing_bound_identity_is_rejected_before_any_call(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("YELLOWSTORM_INTERNAL_SERVICE_TOKEN", "test-token")
    with pytest.raises(AttributeExtractionError) as error:
        await extract_attributes(**REQUEST, ai_extraction=None)
    assert error.value.code == "ai_extraction_identity_missing"


@pytest.mark.asyncio
async def test_missing_evidence_is_rejected_before_any_call(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("YELLOWSTORM_INTERNAL_SERVICE_TOKEN", "test-token")
    with pytest.raises(AttributeExtractionError) as error:
        await extract_attributes(**{**REQUEST, "sections": []},
                                 ai_extraction={"agentSlug": "a", "model": "m", "contractVersion": "v"})
    assert error.value.code == "no_evidence"


IDENTITY = {"agentSlug": "a", "model": "m", "contractVersion": "v"}


def _client(statuses: list[int], seen: list[int]):  # type: ignore[no-untyped-def]
    import httpx

    def answer(request: httpx.Request) -> httpx.Response:
        status = statuses[min(len(seen), len(statuses) - 1)]
        seen.append(status)
        body = {"data": {"values": [], "extractorVersion": "v"}} if status == 200 else {"message": "busy"}
        return httpx.Response(status, json=body, headers={"Retry-After": "0"} if status == 429 else {})
    return httpx.AsyncClient(transport=httpx.MockTransport(answer))


@pytest.mark.asyncio
async def test_a_throttled_or_briefly_down_ai_is_tried_again(monkeypatch: pytest.MonkeyPatch):
    import app.datasource.attribute_extraction as module

    monkeypatch.setenv("YELLOWSTORM_INTERNAL_SERVICE_TOKEN", "test-token")
    monkeypatch.setattr(module, "BASE_DELAY_SECONDS", 0.0)
    monkeypatch.setenv("YELLOWSTORM_BACKEND_URL", "http://backend.test")
    seen: list[int] = []
    result = await extract_attributes(**REQUEST, ai_extraction=IDENTITY, client=_client([429, 502, 200], seen))
    assert seen == [429, 502, 200] and result["values"] == []


@pytest.mark.asyncio
async def test_a_lasting_throttle_says_so_and_a_refusal_is_not_retried(monkeypatch: pytest.MonkeyPatch):
    import app.datasource.attribute_extraction as module

    monkeypatch.setenv("YELLOWSTORM_INTERNAL_SERVICE_TOKEN", "test-token")
    monkeypatch.setattr(module, "BASE_DELAY_SECONDS", 0.0)
    monkeypatch.setenv("YELLOWSTORM_BACKEND_URL", "http://backend.test")
    seen: list[int] = []
    with pytest.raises(AttributeExtractionError) as error:
        await extract_attributes(**REQUEST, ai_extraction=IDENTITY, client=_client([429], seen))
    assert error.value.code == "attribute_extraction_throttled" and len(seen) == module.MAX_ATTEMPTS
    refused: list[int] = []
    with pytest.raises(AttributeExtractionError):
        await extract_attributes(**REQUEST, ai_extraction=IDENTITY, client=_client([503], refused))
    assert refused == [503]
