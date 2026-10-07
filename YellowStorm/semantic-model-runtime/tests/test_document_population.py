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


LINES_BLOCK = {"blockPk": 9, "blockKey": "b9", "origin": "native_text",
               "content": "Contract number CNT-7 | Amendment 1 on 2026-01-01 | Amendment 2 on 2026-02-01"}


@pytest.mark.asyncio
async def test_many_records_gives_one_entity_per_item_found(monkeypatch: pytest.MonkeyPatch, index_stubs):
    asked = {}

    async def extraction(**kwargs):
        asked.update(kwargs)
        return {"extractorVersion": "ai-attribute-v1", "failed": [],
                "values": [{"key": "amendment_number", "value": "1", "evidenceReferences": ["section:7/block:9"]}],
                "records": [
                    {"label": "1", "values": [
                        {"key": "amendment_number", "value": "1", "evidenceReferences": ["section:7/block:9"]},
                        {"key": "effective_date", "value": "2026-01-01", "evidenceReferences": ["section:7/block:9"]}]},
                    {"label": "2", "values": [
                        {"key": "amendment_number", "value": "2", "evidenceReferences": ["section:7/block:9"]},
                        {"key": "effective_date", "value": "2026-02-01", "evidenceReferences": ["section:7/block:9"]}]},
                    # Not in the block it cites: dropped, as for a single record.
                    {"label": "9", "values": [
                        {"key": "amendment_number", "value": "9", "evidenceReferences": ["section:7/block:9"]}]},
                ]}

    ai_stubs(monkeypatch, extraction)

    async def read(*_args, **_kwargs):
        return {"sections": [{"sectionPk": 7, "sectionKey": "s7", "blocks": [LINES_BLOCK]}],
                "coverage": {"directBlocksComplete": True}}

    monkeypatch.setattr(document, "read_complete_section_set", read)
    mapping = entry(
        {"sourceField": None, "targetAttribute": "contract_number", "mode": "constant", "constantValue": "CNT-7"},
        {"sourceField": "amendment", "targetAttribute": "amendment_number", "mode": "extract", "extractionStrategy": "ai"},
        {"sourceField": "date", "targetAttribute": "effective_date", "mode": "extract", "extractionStrategy": "ai"},
    )
    mapping["options"] = {"aiSettings": {"manyRecords": True}}
    result = await document.populate_document(object(), mapping, AMENDMENT_CONCEPT, "u1",
                                              metadata_fetch=metadata, model_id="model-1")

    assert asked["multiple"] is True
    assert sorted(e["identity"]["amendment_number"] for e in result["entities"]) == ["1", "2"]
    dates = {a["entityId"]: (a["value"], a["evidence"]["rowNumber"]) for a in result["assertions"]
             if a["attribute"] == "effective_date"}
    assert sorted(dates.values()) == [("2026-01-01", 1), ("2026-02-01", 2)]
    assert result["coverage"]["records"] == 2
    assert result["coverage"]["status"] == "processed_complete"


def test_an_item_may_be_summed_up_and_classified_when_it_is_quoted():
    reference = "section:7/block:9"
    by_reference = {reference: (LINES_BLOCK, {"sectionPk": 7, "sectionKey": "s7"})}
    keys = {"quote", "summary", "kind"}
    entry_ = {"mappingVersion": "v1"}

    def ground_with(summaries: set[str], items: list[dict]) -> tuple[dict, dict]:
        values: dict = {}
        evidence: dict = {}
        document._ground_values(items, keys, by_reference, {}, entry_, {"assetId": "a"}, "v", None,
                                values, evidence, None, {"kind": ["Amendment", "Renewal"]}, summaries)
        return values, evidence

    def ground(items: list[dict]) -> tuple[dict, dict]:
        return ground_with({"summary"}, items)

    def item(key: str, value: str) -> dict:
        return {"key": key, "value": value, "evidenceReferences": [reference]}

    # The summary comes before its quote; the picked kind is written as the allowed value.
    values, evidence = ground([item("summary", "The contract was amended twice"), item("kind", "amendment"),
                               item("quote", "Amendment 1 on 2026-01-01")])
    assert values == {"summary": "The contract was amended twice", "kind": "Amendment",
                      "quote": "Amendment 1 on 2026-01-01"}
    assert evidence["summary"]["rephrased"] is True
    # A date the text does not write that way is a rewrite too: kept only for a field allowed to rewrite.
    keys.add("when")
    values, _ = ground([item("quote", "Amendment 2 on 2026-02-01"), item("when", "2026-02-01T00:00")])
    assert values == {"quote": "Amendment 2 on 2026-02-01"}
    values, _ = ground_with({"summary", "when"}, [item("quote", "Amendment 2 on 2026-02-01"), item("when", "2026-02-01T00:00")])
    assert values["when"] == "2026-02-01T00:00"
    # With nothing quoted from the block, a summary is not proof the item is there; an unknown kind is dropped.
    values, _ = ground([item("summary", "The contract was amended twice"), item("kind", "Termination")])
    assert values == {}


@pytest.mark.asyncio
async def test_one_record_per_document_does_not_ask_for_several(monkeypatch: pytest.MonkeyPatch, index_stubs):
    asked = {}

    async def extraction(**kwargs):
        asked.update(kwargs)
        return {"extractorVersion": "ai-attribute-v1", "failed": [], "values": []}

    ai_stubs(monkeypatch, extraction)
    await document.populate_document(object(), entry(
        *AI_DETERMINISTIC,
        {"sourceField": "effective date", "targetAttribute": "effective_date", "mode": "extract",
         "extractionStrategy": "ai"}), AMENDMENT_CONCEPT, "u1", metadata_fetch=metadata, model_id="model-1")
    assert asked["multiple"] is False


@pytest.mark.asyncio
async def test_ai_is_told_what_each_field_means(monkeypatch: pytest.MonkeyPatch, index_stubs):
    asked = {}

    async def extraction(**kwargs):
        asked.update(kwargs)
        return {"extractorVersion": "ai-attribute-v1", "failed": [], "values": []}

    ai_stubs(monkeypatch, extraction)
    await document.populate_document(object(), entry(
        *AI_DETERMINISTIC,
        {"sourceField": "Statut", "targetAttribute": "effective_date", "mode": "extract", "extractionStrategy": "ai",
         "description": "Where the fact stands.", "valueType": "enum", "allowedValues": ["planned", "done"]},
    ), AMENDMENT_CONCEPT, "u1", metadata_fetch=metadata, model_id="model-1")
    assert asked["attributes"] == [{"key": "effective_date", "label": "Statut", "type": "string",
                                    "description": "Where the fact stands. One of: planned, done."}]


@pytest.mark.asyncio
async def test_a_field_definition_wins_over_the_attribute_description(monkeypatch: pytest.MonkeyPatch, index_stubs):
    asked = {}

    async def extraction(**kwargs):
        asked.update(kwargs)
        return {"extractorVersion": "ai-attribute-v1", "failed": [], "values": []}

    ai_stubs(monkeypatch, extraction)
    await document.populate_document(object(), entry(
        *AI_DETERMINISTIC,
        {"sourceField": "Date", "targetAttribute": "effective_date", "mode": "extract", "extractionStrategy": "ai",
         "description": "Attribute description.", "semanticDefinition": "  The day the amendment takes effect.  "},
    ), AMENDMENT_CONCEPT, "u1", metadata_fetch=metadata, model_id="model-1")
    assert asked["attributes"][0]["description"] == "The day the amendment takes effect."


@pytest.mark.asyncio
async def test_the_agent_chosen_for_a_field_is_recorded_with_its_evidence(
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
         "extractionStrategy": "ai", "agentId": "agent-7"},
    ), AMENDMENT_CONCEPT, "u1", metadata_fetch=metadata, model_id="model-1")
    assertion = next(item for item in result["assertions"] if item["attribute"] == "effective_date")
    assert assertion["evidence"]["requestedAgentId"] == "agent-7"


# --- Several records per document by rules: every match of a rule is a record ---------------------------

def _amendment_blocks(*amendments: tuple[str, str | None]) -> list[dict]:
    blocks = [{"blockPk": 8, "blockKey": "b8", "pageNumber": 1, "origin": "native_text", "content": "Contract number: CNT-7"}]
    for index, (number, date) in enumerate(amendments, start=10):
        text = f"Amendment number: {number}" + (f"\nEffective date: {date}" if date else "")
        blocks.append({"blockPk": index, "blockKey": f"b{index}", "pageNumber": 2, "origin": "native_text", "content": text})
    return blocks


def _rules_entry(many: bool) -> dict:
    mapping = entry(
        {"sourceField": "Contract number", "targetAttribute": "contract_number", "mode": "extract"},
        {"sourceField": "Amendment number", "targetAttribute": "amendment_number", "mode": "extract"},
        {"sourceField": "Effective date", "targetAttribute": "effective_date", "mode": "extract"},
    )
    mapping["options"] = {"manyRecords": True} if many else {}
    return mapping


@pytest.mark.asyncio
async def test_rules_make_one_record_per_match_and_share_what_the_document_says_once(
        monkeypatch: pytest.MonkeyPatch, index_stubs):
    blocks = _amendment_blocks(("1", "2026-01-01"), ("2", "2026-02-01"))

    async def read(*_args, **_kwargs):
        return {"sections": [{"sectionPk": 7, "sectionKey": "s7", "blocks": blocks}], "coverage": {"directBlocksComplete": True}}

    monkeypatch.setattr(document, "read_complete_section_set", read)
    result = await document.populate_document(object(), _rules_entry(True), AMENDMENT_CONCEPT, "u1", metadata_fetch=metadata)
    assert sorted((e["identity"]["contract_number"], e["identity"]["amendment_number"]) for e in result["entities"]) == [
        ("cnt-7", "1"), ("cnt-7", "2")]
    dates = sorted((a["value"], a["evidence"]["rowNumber"], a["evidence"]["blockKey"]) for a in result["assertions"]
                   if a["attribute"] == "effective_date")
    # Each value keeps the block it was found in, and its record's number.
    assert dates == [("2026-01-01", 1, "b10"), ("2026-02-01", 2, "b11")]
    assert not [gap for gap in result["gaps"] if gap["kind"] == "uneven_matches"]

    # One record per document: the same rules find several values and keep none.
    single = await document.populate_document(object(), _rules_entry(False), AMENDMENT_CONCEPT, "u1", metadata_fetch=metadata)
    assert single["entities"] == []


@pytest.mark.asyncio
async def test_a_field_matching_fewer_times_than_there_are_records_is_reported(
        monkeypatch: pytest.MonkeyPatch, index_stubs):
    blocks = _amendment_blocks(("1", "2026-01-01"), ("2", "2026-02-01"), ("3", None))

    async def read(*_args, **_kwargs):
        return {"sections": [{"sectionPk": 7, "sectionKey": "s7", "blocks": blocks}], "coverage": {"directBlocksComplete": True}}

    monkeypatch.setattr(document, "read_complete_section_set", read)
    result = await document.populate_document(object(), _rules_entry(True), AMENDMENT_CONCEPT, "u1", metadata_fetch=metadata)
    assert sorted(e["identity"]["amendment_number"] for e in result["entities"]) == ["1", "2", "3"]
    uneven = [gap for gap in result["gaps"] if gap["kind"] == "uneven_matches"]
    assert [gap["field"] for gap in uneven] == ["effective_date"]


def test_rule_matches_are_paired_with_the_ai_records_by_their_order():
    evidence = lambda key: {"blockKey": key}  # noqa: E731
    records, uneven = document.pair_rule_matches(
        [{"values": {"label": "first"}, "evidence": {"label": evidence("a")}}],
        {"amount": [("10", evidence("b1"), "q"), ("20", evidence("b2"), "q")]})
    assert [record["values"] for record in records] == [{"label": "first", "amount": "10"}, {"amount": "20"}]
    assert uneven == []
    # A value the AI found for a record wins over a rule match.
    records, _ = document.pair_rule_matches([{"values": {"amount": "99"}, "evidence": {"amount": evidence("ai")}}],
                                            {"amount": [("10", evidence("b1"), "q")]})
    assert records[0]["values"] == {"amount": "99"}
    assert document.pair_rule_matches([], {}) == ([], [])


def test_the_same_match_found_twice_in_one_block_is_one_match():
    block, other = {"blockPk": 1}, {"blockPk": 2}
    matches = document.rule_matches([("A", block, {}, "A"), ("A", block, {}, "A"), ("A", other, {}, "A"), ("B", block, {}, "B")])
    assert [(value, item["blockPk"]) for value, item, *_ in matches] == [("A", 1), ("A", 2), ("B", 1)]


def test_several_records_may_be_set_without_ai_or_with_its_limits():
    assert document.many_records({"options": {"manyRecords": True}})
    assert document.many_records({"options": {"aiSettings": {"manyRecords": True}}})
    assert not document.many_records({"options": {}}) and not document.many_records({})
