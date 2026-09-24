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
