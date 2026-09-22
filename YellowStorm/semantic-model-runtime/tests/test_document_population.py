from __future__ import annotations

import pytest

import app.population.document as document

SOURCE = {
    "workspaceId": "6512f0a1c9e77a001234aaa1",
    "assetId": "6512f0a1c9e77a001234bbb1",
    "mimeType": "application/pdf", "sizeBytes": 100,
    "contentHash": "sha256:" + "a" * 64, "uploadedAt": "2026-01-01T00:00:00Z",
    "indexingStatus": "ready", "originalName": "agreement.pdf", "uploaderUserId": "u1",
}
CONCEPT = {
    "conceptId": "contract", "namespace": "contract", "keyComponents": ["contract_number"],
    "allowedFields": ["contract_number", "customer_reference"], "populationMode": "materialized",
    "eligibility": None, "materialization": None,
}


async def metadata(source: dict, actor: str) -> dict:
    assert actor == "u1"
    return dict(SOURCE)


def entry(*mappings: dict) -> dict:
    return {"conceptId": "contract", "sourceKind": "document", "source": dict(SOURCE),
            "fieldMappings": list(mappings), "mappingVersion": "map-v1", "options": {}}


@pytest.fixture
def index_stubs(monkeypatch: pytest.MonkeyPatch):
    async def capabilities(_connection):
        return {"capabilities": {"structure": True, "hierarchy": True, "lexical": True,
                                  "vectors": False, "visuals": True}}

    async def resolved(*_args, **_kwargs):
        return {"resolution": "resolved", "candidates": [{"documentPk": 42}]}

    async def exact(*_args, **_kwargs):
        return {"hits": [], "truncated": False}

    async def lexical(*_args, **_kwargs):
        return {"hits": [{"sectionPk": 7, "rank": 1.0}], "truncated": False}

    monkeypatch.setattr(document, "detect_capabilities", capabilities)
    monkeypatch.setattr(document, "resolve_document_candidates", resolved)
    monkeypatch.setattr(document, "search_exact", exact)
    monkeypatch.setattr(document, "search_lexical", lexical)


@pytest.mark.asyncio
async def test_extracts_mapped_fields_with_ocr_provenance(monkeypatch: pytest.MonkeyPatch, index_stubs):
    async def read(*_args, **_kwargs):
        return {"sections": [{"sectionPk": 7, "sectionKey": "s7", "blocks": [{
            "blockPk": 9, "blockKey": "b9", "pageNumber": 2, "origin": "ocr",
            "content": "Contract Number: CNT-0041\nCustomer Reference: C-99",
        }]}], "coverage": {"directBlocksComplete": True}}

    monkeypatch.setattr(document, "read_complete_section_set", read)
    result = await document.populate_document(object(), entry(
        {"sourceField": "Contract Number", "targetAttribute": "contract_number", "mode": "extract"},
        {"sourceField": "Customer Reference", "targetAttribute": "customer_reference", "mode": "extract"},
    ), CONCEPT, "u1", metadata_fetch=metadata)
    assert result["coverage"]["status"] == "processed_complete"
    assert result["entities"][0]["identity"] == {"contract_number": "cnt-0041"}
    assertion = result["assertions"][0]
    assert assertion["value"] == "C-99"
    assert assertion["origin"] == "source"
    assert assertion["evidence"]["origin"] == "ocr"
    assert assertion["evidence"]["blockKey"] == "b9"
    assert assertion["evidence"]["rawEvidenceHash"].startswith("sha256:")


@pytest.mark.asyncio
async def test_ignores_unlabelled_mentions_and_generated_descriptions(
        monkeypatch: pytest.MonkeyPatch, index_stubs):
    async def read(*_args, **_kwargs):
        return {"sections": [{"sectionPk": 7, "sectionKey": "s7", "blocks": [
            {"blockPk": 9, "blockKey": "b9", "origin": "native_text",
             "content": "This file merely mentions CNT-0041."},
            {"blockPk": 10, "blockKey": "b10", "origin": "generated_visual_description",
             "content": "Contract Number: CNT-0041"},
        ]}], "coverage": {"directBlocksComplete": True}}

    monkeypatch.setattr(document, "read_complete_section_set", read)
    result = await document.populate_document(object(), entry(
        {"sourceField": "Contract Number", "targetAttribute": "contract_number", "mode": "extract"},
    ), CONCEPT, "u1", metadata_fetch=metadata)
    assert result["entities"] == []
    assert result["coverage"]["status"] == "unresolved_identity"
    assert {gap["kind"] for gap in result["gaps"]} == {"missing_identity", "unresolved_document_field"}


@pytest.mark.asyncio
async def test_ambiguous_filename_never_selects_a_candidate(monkeypatch: pytest.MonkeyPatch, index_stubs):
    async def ambiguous(*_args, **_kwargs):
        return {"resolution": "ambiguous", "candidates": [{"documentPk": 1}, {"documentPk": 2}]}

    monkeypatch.setattr(document, "resolve_document_candidates", ambiguous)
    result = await document.populate_document(object(), entry(
        {"sourceField": "Contract Number", "targetAttribute": "contract_number", "mode": "extract"},
    ), CONCEPT, "u1", metadata_fetch=metadata)
    assert result["coverage"]["status"] == "index_ambiguous"
    assert result["entities"] == []


@pytest.mark.asyncio
async def test_missing_structural_index_is_an_explicit_outcome(
        monkeypatch: pytest.MonkeyPatch, index_stubs):
    async def unavailable(_connection):
        return {"capabilities": {"structure": False}}

    monkeypatch.setattr(document, "detect_capabilities", unavailable)
    result = await document.populate_document(object(), entry(
        {"sourceField": "Contract Number", "targetAttribute": "contract_number", "mode": "extract"},
    ), CONCEPT, "u1", metadata_fetch=metadata)
    assert result["coverage"]["status"] == "index_unavailable"
    assert result["indexObservation"]["readiness"]["structure"] is False


@pytest.mark.asyncio
async def test_document_assertion_uses_persistable_origin(monkeypatch: pytest.MonkeyPatch, index_stubs):
    from app.persistence.population_store import store_assertions

    async def read(*_args, **_kwargs):
        return {"sections": [{"sectionPk": 7, "sectionKey": "s7", "blocks": [{
            "blockPk": 9, "blockKey": "b9", "pageNumber": 2, "origin": "ocr",
            "content": "Contract Number: CNT-0041\nCustomer Reference: C-99",
        }]}], "coverage": {"directBlocksComplete": True}}

    class Pool:
        rows = []

        async def executemany(self, _sql, rows):
            self.rows = list(rows)

    monkeypatch.setattr(document, "read_complete_section_set", read)
    result = await document.populate_document(object(), entry(
        {"sourceField": "Contract Number", "targetAttribute": "contract_number", "mode": "extract"},
        {"sourceField": "Customer Reference", "targetAttribute": "customer_reference", "mode": "extract"},
    ), CONCEPT, "u1", metadata_fetch=metadata)
    pool = Pool()
    await store_assertions(pool, model_id="m1", revision_id="r1", assertions=result["assertions"])
    assert pool.rows[0][5] == "source"
    assert '"origin":"ocr"' in pool.rows[0][6]
