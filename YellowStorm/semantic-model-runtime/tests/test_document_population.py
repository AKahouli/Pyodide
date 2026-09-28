from __future__ import annotations

import pytest

import app.population.document as document
from app.datasource.attribute_extraction import AttributeExtractionError

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


AMENDMENT_CONCEPT = {
    "conceptId": "amendment", "namespace": "amendment",
    "keyComponents": ["contract_number", "amendment_number"],
    "allowedFields": ["contract_number", "amendment_number", "effective_date"],
    "populationMode": "materialized", "eligibility": None, "materialization": None,
}


@pytest.mark.asyncio
async def test_reads_flattened_record_row_and_ignores_prose_mentions(
        monkeypatch: pytest.MonkeyPatch, index_stubs):
    async def read(*_args, **_kwargs):
        return {"sections": [{"sectionPk": 7, "sectionKey": "s7", "blocks": [
            {"blockPk": 9, "blockKey": "b9", "origin": "native_text",
             "content": "This instrument amends the agreement identified by contract number "
                        "CNT-2026-0041 and amendment number shown below."},
            {"blockPk": 10, "blockKey": "b10", "origin": "native_text",
             "content": "Contract number CNT-2026-0041 Amendment number 3 "
                        "Effective date 2026-04-01 Document status Accepted"},
        ]}], "coverage": {"directBlocksComplete": True}}

    monkeypatch.setattr(document, "read_complete_section_set", read)
    result = await document.populate_document(object(), entry(
        {"sourceField": "contract number", "targetAttribute": "contract_number", "mode": "extract"},
        {"sourceField": "amendment number", "targetAttribute": "amendment_number", "mode": "extract"},
        {"sourceField": "effective date", "targetAttribute": "effective_date", "mode": "extract"},
    ), AMENDMENT_CONCEPT, "u1", metadata_fetch=metadata)
    assert result["coverage"]["status"] == "processed_complete"
    assert result["entities"][0]["identity"] == {
        "contract_number": "cnt-2026-0041", "amendment_number": "3"}
    assert {assertion["attribute"]: assertion["value"] for assertion in result["assertions"]} == {
        "effective_date": "2026-04-01"}
    assert result["assertions"][0]["evidence"]["blockKey"] == "b10"


AI_BLOCK = {"blockPk": 9, "blockKey": "b9", "origin": "native_text",
            "content": "Contract number CNT-2026-0041 Amendment number 3 Effective date 2026-04-01"}


def ai_stubs(monkeypatch: pytest.MonkeyPatch, extraction) -> None:
    """Outline + read for the AI evidence path, plus a stub extraction client."""
    async def outline(*_args, **_kwargs):
        return {"sections": [{"sectionPk": 7, "sectionKey": "s7"}], "truncated": False}

    async def read(*_args, **_kwargs):
        return {"sections": [{"sectionPk": 7, "sectionKey": "s7", "blocks": [AI_BLOCK]}],
                "coverage": {"directBlocksComplete": True}}

    monkeypatch.setattr(document, "get_outline", outline)
    monkeypatch.setattr(document, "read_complete_section_set", read)
    monkeypatch.setattr(document, "extract_attributes", extraction)


def ai_entry(*mappings: dict) -> dict:
    return entry(*mappings)


def ai_amendment_entry(*mappings: dict) -> dict:
    return entry(*mappings)


AI_DETERMINISTIC = [
    {"sourceField": "contract number", "targetAttribute": "contract_number", "mode": "extract"},
    {"sourceField": "amendment number", "targetAttribute": "amendment_number", "mode": "extract"},
]


@pytest.mark.asyncio
async def test_ai_extraction_grounds_a_value_on_a_real_block(
        monkeypatch: pytest.MonkeyPatch, index_stubs):
    async def extraction(**_kwargs):
        return {"model": "gpt-test", "extractorVersion": "ai-attribute-v1",
                "values": [{"key": "effective_date", "value": "2026-04-01",
                            "evidenceReferences": ["section:7/block:9"]}],
                "failed": []}

    ai_stubs(monkeypatch, extraction)
    result = await document.populate_document(object(), ai_amendment_entry(
        *AI_DETERMINISTIC,
        {"sourceField": "effective date", "targetAttribute": "effective_date", "mode": "extract",
         "extractionStrategy": "ai"},
    ), AMENDMENT_CONCEPT, "u1", metadata_fetch=metadata, model_id="model-1")

    assert result["entities"][0]["identity"] == {
        "contract_number": "cnt-2026-0041", "amendment_number": "3"}
    assertion = next(item for item in result["assertions"] if item["attribute"] == "effective_date")
    assert assertion["value"] == "2026-04-01"
    assert assertion["evidence"]["origin"] == "ai"
    assert assertion["evidence"]["extractorVersion"] == "ai-attribute-v1"
    assert assertion["evidence"]["model"] == "gpt-test"
    assert assertion["evidence"]["blockKey"] == "b9"


@pytest.mark.asyncio
async def test_ai_value_without_a_supplied_reference_is_discarded(
        monkeypatch: pytest.MonkeyPatch, index_stubs):
    async def extraction(**_kwargs):
        return {"extractorVersion": "ai-attribute-v1",
                "values": [{"key": "effective_date", "value": "1999-01-01",
                            "evidenceReferences": ["section:999/block:999"]}],
                "failed": []}

    ai_stubs(monkeypatch, extraction)
    result = await document.populate_document(object(), ai_amendment_entry(
        *AI_DETERMINISTIC,
        {"sourceField": "effective date", "targetAttribute": "effective_date", "mode": "extract",
         "extractionStrategy": "ai"},
    ), AMENDMENT_CONCEPT, "u1", metadata_fetch=metadata, model_id="model-1")

    assert all(item["attribute"] != "effective_date" for item in result["assertions"])
    assert {gap["kind"] for gap in result["gaps"]} >= {"ai_extraction_unresolved"}


@pytest.mark.asyncio
async def test_ai_value_absent_from_its_cited_block_is_discarded(
        monkeypatch: pytest.MonkeyPatch, index_stubs):
    async def extraction(**_kwargs):
        return {"extractorVersion": "ai-attribute-v1",
                "values": [{"key": "effective_date", "value": "1999-01-01",
                            "evidenceReferences": ["section:7/block:9"]}],
                "failed": []}

    ai_stubs(monkeypatch, extraction)
    result = await document.populate_document(object(), ai_amendment_entry(
        *AI_DETERMINISTIC,
        {"sourceField": "effective date", "targetAttribute": "effective_date", "mode": "extract",
         "extractionStrategy": "ai"},
    ), AMENDMENT_CONCEPT, "u1", metadata_fetch=metadata, model_id="model-1")

    # The reference is real but the value is not in that block: invented data.
    assert all(item["attribute"] != "effective_date" for item in result["assertions"])
    assert {gap["kind"] for gap in result["gaps"]} >= {"ai_extraction_unresolved"}


@pytest.mark.asyncio
async def test_ai_extraction_failure_is_an_explicit_gap_never_a_silent_fallback(
        monkeypatch: pytest.MonkeyPatch, index_stubs):
    async def extraction(**_kwargs):
        raise AttributeExtractionError("attribute_extraction_unavailable")

    ai_stubs(monkeypatch, extraction)
    result = await document.populate_document(object(), ai_entry(
        {"sourceField": "contract number", "targetAttribute": "contract_number", "mode": "extract",
         "extractionStrategy": "ai"},
        {"sourceField": "effective date", "targetAttribute": "effective_date", "mode": "extract"},
    ), AMENDMENT_CONCEPT, "u1", metadata_fetch=metadata, model_id="model-1")

    assert {gap["kind"] for gap in result["gaps"]} >= {"ai_extraction_unavailable"}
    assert result["entities"] == []
    assert result["assertions"] == []


@pytest.mark.asyncio
async def test_multi_word_colon_values_keep_line_anchored_semantics(
        monkeypatch: pytest.MonkeyPatch, index_stubs):
    async def read(*_args, **_kwargs):
        return {"sections": [{"sectionPk": 7, "sectionKey": "s7", "blocks": [{
            "blockPk": 9, "blockKey": "b9", "origin": "native_text",
            "content": "Contract Number: Master Services Agreement\nCustomer Reference: C-99",
        }]}], "coverage": {"directBlocksComplete": True}}

    monkeypatch.setattr(document, "read_complete_section_set", read)
    result = await document.populate_document(object(), entry(
        {"sourceField": "Contract Number", "targetAttribute": "contract_number", "mode": "extract"},
        {"sourceField": "Customer Reference", "targetAttribute": "customer_reference", "mode": "extract"},
    ), CONCEPT, "u1", metadata_fetch=metadata)
    assert result["entities"][0]["identity"] == {"contract_number": "master services agreement"}
    assert result["assertions"][0]["value"] == "C-99"


@pytest.mark.asyncio
async def test_multi_word_hyphen_values_keep_line_anchored_semantics(
        monkeypatch: pytest.MonkeyPatch, index_stubs):
    async def read(*_args, **_kwargs):
        return {"sections": [{"sectionPk": 7, "sectionKey": "s7", "blocks": [{
            "blockPk": 9, "blockKey": "b9", "origin": "native_text",
            "content": "Contract Number - Master Services Agreement\n"
                       "Customer Reference - C-99",
        }]}], "coverage": {"directBlocksComplete": True}}

    monkeypatch.setattr(document, "read_complete_section_set", read)
    result = await document.populate_document(object(), entry(
        {"sourceField": "Contract Number", "targetAttribute": "contract_number", "mode": "extract"},
        {"sourceField": "Customer Reference", "targetAttribute": "customer_reference", "mode": "extract"},
    ), CONCEPT, "u1", metadata_fetch=metadata)
    assert result["entities"][0]["identity"] == {"contract_number": "master services agreement"}
    assert result["assertions"][0]["value"] == "C-99"


@pytest.mark.asyncio
async def test_hyphen_separator_without_symmetric_spaces_keeps_line_anchored_semantics(
        monkeypatch: pytest.MonkeyPatch, index_stubs):
    async def read(*_args, **_kwargs):
        return {"sections": [{"sectionPk": 7, "sectionKey": "s7", "blocks": [{
            "blockPk": 9, "blockKey": "b9", "origin": "native_text",
            "content": "Contract Number- Master Services Agreement\n"
                       "Customer Reference- C-99",
        }]}], "coverage": {"directBlocksComplete": True}}

    monkeypatch.setattr(document, "read_complete_section_set", read)
    result = await document.populate_document(object(), entry(
        {"sourceField": "Contract Number", "targetAttribute": "contract_number", "mode": "extract"},
        {"sourceField": "Customer Reference", "targetAttribute": "customer_reference", "mode": "extract"},
    ), CONCEPT, "u1", metadata_fetch=metadata)
    assert result["entities"][0]["identity"] == {"contract_number": "master services agreement"}
    assert result["assertions"][0]["value"] == "C-99"


@pytest.mark.asyncio
async def test_shorter_label_inside_longer_label_counts_once(
        monkeypatch: pytest.MonkeyPatch, index_stubs):
    async def read(*_args, **_kwargs):
        return {"sections": [{"sectionPk": 7, "sectionKey": "s7", "blocks": [{
            "blockPk": 9, "blockKey": "b9", "origin": "native_text",
            "content": "Customer ID C041",
        }]}], "coverage": {"directBlocksComplete": True}}

    monkeypatch.setattr(document, "read_complete_section_set", read)
    result = await document.populate_document(object(), entry(
        {"sourceField": "customer id", "targetAttribute": "contract_number", "mode": "extract"},
        {"sourceField": "id", "targetAttribute": "amendment_number", "mode": "extract"},
    ), AMENDMENT_CONCEPT, "u1", metadata_fetch=metadata)
    assert result["entities"] == []
    assert result["coverage"]["status"] == "unresolved_identity"


@pytest.mark.asyncio
async def test_punctuation_free_prose_with_two_labels_stays_unresolved(
        monkeypatch: pytest.MonkeyPatch, index_stubs):
    async def read(*_args, **_kwargs):
        return {"sections": [{"sectionPk": 7, "sectionKey": "s7", "blocks": [{
            "blockPk": 9, "blockKey": "b9", "origin": "native_text",
            "content": "Refer to contract number CNT-2026-0041 and amendment number 3 below",
        }]}], "coverage": {"directBlocksComplete": True}}

    monkeypatch.setattr(document, "read_complete_section_set", read)
    result = await document.populate_document(object(), entry(
        {"sourceField": "contract number", "targetAttribute": "contract_number", "mode": "extract"},
        {"sourceField": "amendment number", "targetAttribute": "amendment_number", "mode": "extract"},
        {"sourceField": "effective date", "targetAttribute": "effective_date", "mode": "extract"},
    ), AMENDMENT_CONCEPT, "u1", metadata_fetch=metadata)
    assert result["entities"] == []
    assert result["coverage"]["status"] == "unresolved_identity"


@pytest.mark.asyncio
async def test_missing_value_before_another_label_stays_unresolved(
        monkeypatch: pytest.MonkeyPatch, index_stubs):
    async def read(*_args, **_kwargs):
        return {"sections": [{"sectionPk": 7, "sectionKey": "s7", "blocks": [{
            "blockPk": 9, "blockKey": "b9", "origin": "native_text",
            "content": "Contract number Amendment number 3 Effective date 2026-04-01",
        }]}], "coverage": {"directBlocksComplete": True}}

    monkeypatch.setattr(document, "read_complete_section_set", read)
    result = await document.populate_document(object(), entry(
        {"sourceField": "contract number", "targetAttribute": "contract_number", "mode": "extract"},
        {"sourceField": "amendment number", "targetAttribute": "amendment_number", "mode": "extract"},
        {"sourceField": "effective date", "targetAttribute": "effective_date", "mode": "extract"},
    ), AMENDMENT_CONCEPT, "u1", metadata_fetch=metadata)
    assert result["entities"] == []
    assert result["coverage"]["status"] == "unresolved_identity"


@pytest.mark.asyncio
async def test_conflicting_row_and_line_candidates_stay_unresolved(
        monkeypatch: pytest.MonkeyPatch, index_stubs):
    async def read(*_args, **_kwargs):
        return {"sections": [{"sectionPk": 7, "sectionKey": "s7", "blocks": [
            {"blockPk": 9, "blockKey": "b9", "origin": "native_text",
             "content": "Contract number CNT-2026-0041 Effective date 2026-04-01"},
            {"blockPk": 10, "blockKey": "b10", "origin": "native_text",
             "content": "Contract number: CNT-9999-0001\nEffective date: 2026-09-09"},
        ]}], "coverage": {"directBlocksComplete": True}}

    monkeypatch.setattr(document, "read_complete_section_set", read)
    result = await document.populate_document(object(), entry(
        {"sourceField": "contract number", "targetAttribute": "contract_number", "mode": "extract"},
        {"sourceField": "effective date", "targetAttribute": "effective_date", "mode": "extract"},
    ), AMENDMENT_CONCEPT, "u1", metadata_fetch=metadata)
    assert result["entities"] == []
    assert result["coverage"]["status"] == "unresolved_identity"


@pytest.mark.asyncio
async def test_record_row_token_is_bounded_by_the_field_limit(
        monkeypatch: pytest.MonkeyPatch, index_stubs):
    long_value = "V" * (document.MAX_FIELD_VALUE_CHARS + 50)

    async def read(*_args, **_kwargs):
        return {"sections": [{"sectionPk": 7, "sectionKey": "s7", "blocks": [{
            "blockPk": 9, "blockKey": "b9", "origin": "native_text",
            "content": f"Contract number {long_value} Amendment number 7 "
                       "Effective date 2026-04-01",
        }]}], "coverage": {"directBlocksComplete": True}}

    monkeypatch.setattr(document, "read_complete_section_set", read)
    result = await document.populate_document(object(), entry(
        {"sourceField": "contract number", "targetAttribute": "contract_number", "mode": "extract"},
        {"sourceField": "amendment number", "targetAttribute": "amendment_number", "mode": "extract"},
        {"sourceField": "effective date", "targetAttribute": "effective_date", "mode": "extract"},
    ), AMENDMENT_CONCEPT, "u1", metadata_fetch=metadata)
    assert result["entities"][0]["identity"]["contract_number"] == \
        long_value[:document.MAX_FIELD_VALUE_CHARS].lower()


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


class MemoryCache:
    def __init__(self):
        self.rows: dict[str, dict] = {}

    async def get(self, key):
        return self.rows.get(key)

    async def put(self, key, *, concept_id, asset_id, output):
        import json
        self.rows[key] = json.loads(json.dumps(output))


@pytest.mark.asyncio
async def test_an_unchanged_document_reuses_its_result_and_a_changed_one_is_read_again(
        monkeypatch: pytest.MonkeyPatch, index_stubs):
    reads = []

    async def read(*_args, **_kwargs):
        reads.append(1)
        return {"sections": [{"sectionPk": 7, "sectionKey": "s7", "blocks": [{
            "blockPk": 9, "blockKey": "b9", "pageNumber": 2, "origin": "text",
            "content": "Contract Number: CNT-0041\nCustomer Reference: C-99"}]}],
            "coverage": {"directBlocksComplete": True}}

    monkeypatch.setattr(document, "read_complete_section_set", read)
    cache = MemoryCache()
    mapped = entry({"sourceField": "Contract Number", "targetAttribute": "contract_number", "mode": "extract"})
    first = await document.populate_document(object(), mapped, CONCEPT, "u1", metadata_fetch=metadata, cache=cache)
    second = await document.populate_document(object(), mapped, CONCEPT, "u1", metadata_fetch=metadata, cache=cache)
    assert len(reads) == 1
    assert "reused" not in first and second.pop("reused") is True
    assert second["entities"] == first["entities"]

    async def edited(source: dict, actor: str) -> dict:
        return {**SOURCE, "contentHash": "sha256:" + "b" * 64}

    third = await document.populate_document(object(), mapped, CONCEPT, "u1", metadata_fetch=edited, cache=cache)
    assert len(reads) == 2 and "reused" not in third


@pytest.mark.asyncio
async def test_a_failed_extraction_call_is_not_kept_for_the_next_run(monkeypatch: pytest.MonkeyPatch, index_stubs):
    async def extraction(**_kwargs):
        raise AttributeExtractionError("attribute_extraction_unavailable")

    ai_stubs(monkeypatch, extraction)
    cache = MemoryCache()
    await document.populate_document(object(), ai_entry(
        {"sourceField": "contract number", "targetAttribute": "contract_number", "mode": "extract",
         "extractionStrategy": "ai"},
    ), AMENDMENT_CONCEPT, "u1", metadata_fetch=metadata, model_id="model-1", cache=cache)
    assert cache.rows == {}
