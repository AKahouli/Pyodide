"""A sheet field read out of a cell's text with the document reading rules and AI, row by row."""

from __future__ import annotations

from typing import Any

import pytest

from app.population import document as document_module
from app.population.cell_fields import (CellReader, cell_sections, normalize_field_extractions,
                                        read_row_rules)
from app.population.document_rules import RuleError
from app.workers.datasource_tasks import build_mapping_preview
from app.workers.population_tasks import (population_execution_fingerprint, run_population_for_payload,
                                          run_population_for_task)
from test_population_task import SOURCE, command, fake_fetch, fake_prepare

NOTES = "Bonjour,\n\nPays: France\nMerci de votre retour.\n\nCordialement"
RULES = {"country": {"column": "notes", "label": "Country", "rules": {"labels": ["Pays"]}}}
CONTEXT = {"conceptId": "c1", "conceptLabel": "Customer", "source": {"assetId": "a1", "originalName": "crm.csv"},
           "assetRef": {"assetId": "a1"}, "mappingVersion": "map-v1", "modelId": "m1",
           "aiExtraction": {"agentSlug": "extractor", "model": "m", "contractVersion": "v1"}}


def sheet_source(extractions: dict | None = None, recipes: dict | None = None,
                 options: dict | None = None) -> dict:
    source = {"conceptId": "c1", "source": dict(SOURCE), "options": options or {},
              "columnMapping": {"customer_id": "customer_id", "name": "name"}, "mappingVersion": "map-v1"}
    if extractions is not None:
        source["fieldExtractions"] = extractions
    if recipes is not None:
        source["fieldRecipes"] = recipes
    return source


def query(path, *, columns=None, filters=None, limit=100, offset=0):  # type: ignore[no-untyped-def]
    rows = [{"__sheetRow": 2, "customer_id": "C-1", "name": "Acme", "notes": NOTES},
            {"__sheetRow": 3, "customer_id": "C-2", "name": "Globex", "notes": "No country written here"}]
    rows = [{key: value for key, value in row.items() if key in (columns or [])} for row in rows][offset:]
    return {"columns": columns, "rows": rows, "returnedRows": len(rows), "limit": limit, "offset": offset}


def test_a_cell_is_a_one_section_document_with_a_block_per_paragraph() -> None:
    [section] = cell_sections(NOTES, "notes")
    assert [block["content"] for block in section["blocks"]] == ["Bonjour,", "Pays: France\nMerci de votre retour.",
                                                               "Cordialement"]
    assert NOTES[section["blocks"][1]["start"]:].startswith("Pays")
    assert cell_sections("  ", "notes") == []


def test_rules_read_the_cell_text_with_the_row_column_and_span_as_evidence() -> None:
    specs = normalize_field_extractions(RULES)
    read = read_row_rules(specs, {"notes": NOTES}, row_number=7, context=CONTEXT)
    assert read["values"] == {"country": "France"}
    evidence = read["evidence"]["country"]
    assert (evidence["rowNumber"], evidence["column"], evidence["origin"]) == (7, "notes", "cell_rules")
    assert NOTES[evidence["span"]["start"]:evidence["span"]["end"]] == "France"
    assert read["fields"]["country"]["reason"] == "found"


def test_the_field_label_is_the_default_label_and_an_empty_cell_has_no_input() -> None:
    specs = normalize_field_extractions({"country": {"column": "notes", "label": "Pays"}})
    assert read_row_rules(specs, {"notes": NOTES})["values"] == {"country": "France"}
    assert read_row_rules(specs, {"notes": ""})["fields"]["country"]["reason"] == "no_input"
    assert read_row_rules(specs, {"notes": "Rien"})["fields"]["country"]["reason"] == "label_not_found"


def test_after_a_label_reads_the_passage_to_the_end_of_the_cell() -> None:
    specs = normalize_field_extractions({"country": {"column": "notes", "rules": {
        "labels": ["Pays:"], "location": "after_label", "boundaryLabels": ["Cordialement"]}}})
    value = read_row_rules(specs, {"notes": NOTES})["values"]["country"]
    assert value.startswith("France") and "Cordialement" not in value


@pytest.mark.parametrize("raw", [
    {"country": {"label": "x"}},
    {"country": {"column": "notes", "extractionStrategy": "magic"}},
    {"country": {"column": "notes", "rules": {"location": "pages", "pages": {"from": 1}}}},
    {"country": {"column": "notes", "rules": {"location": "heading"}}},
    {"country": {"column": "notes", "rules": {"pattern": "("}}},
])
def test_unusable_cell_extractions_are_refused(raw: dict) -> None:
    with pytest.raises(RuleError):
        normalize_field_extractions(raw)


def _fake_agent(answers: dict[str, Any], calls: list[dict]):  # type: ignore[no-untyped-def]
    async def extract_attributes(**kwargs: Any) -> dict:
        calls.append(kwargs)
        values = [{"key": key, "value": value,
                   "evidenceReferences": [f"section:{block['sectionPk']}/block:{block['blockPk']}"]}
                  for key, value in answers.items() for block in kwargs["sections"] if value in block["content"]]
        return {"values": values, "extractorVersion": "ai-test-v1", "model": "fake"}
    return extract_attributes


@pytest.mark.asyncio
async def test_rules_then_ai_asks_the_ai_only_for_the_rows_the_rules_missed(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    calls: list[dict] = []
    monkeypatch.setattr(document_module, "extract_attributes", _fake_agent({"country": "Belgique"}, calls))
    specs = normalize_field_extractions({"country": {**RULES["country"], "extractionStrategy": "rules_then_ai",
                                                     "semanticDefinition": "The customer's country"}})
    reader = CellReader(specs, CONTEXT)
    found, guessed, invented = await reader.read_rows([
        (2, {"notes": NOTES}), (3, {"notes": "Le client est en Belgique."}), (4, {"notes": "Rien ici"})])
    assert found["values"] == {"country": "France"} and found["fields"]["country"]["method"] == "rules"
    assert guessed["values"] == {"country": "Belgique"}
    assert guessed["evidence"]["country"]["origin"] == "ai" and guessed["evidence"]["country"]["rowNumber"] == 3
    assert guessed["fields"]["country"]["span"] == {"start": 17, "end": 25}
    # The AI's answer must be in the cell it cites: nothing is invented.
    assert invented["values"] == {} and invented["fields"]["country"]["reason"] == "ai_not_found"
    assert invented["fields"]["country"]["rules"]["reason"] == "label_not_found"
    assert len(calls) == 2 and calls[0]["attributes"][0]["description"] == "The customer's country"
    assert reader.stats["aiCalls"] == 2


@pytest.mark.asyncio
async def test_ai_reads_at_most_the_allowed_rows_and_says_so(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    calls: list[dict] = []
    monkeypatch.setattr(document_module, "extract_attributes", _fake_agent({"country": "France"}, calls))
    specs = normalize_field_extractions({"country": {**RULES["country"], "extractionStrategy": "ai"}})
    reader = CellReader(specs, CONTEXT, ai_rows=1)
    first, second = await reader.read_rows([(2, {"notes": NOTES}), (3, {"notes": NOTES})])
    assert first["values"] == {"country": "France"}
    assert second["fields"]["country"] == {"method": "ai", "reason": "ai_failed", "column": "notes", "detail": "ai_row_limit"}
    assert (reader.stats["aiCalls"], reader.stats["aiSkippedRows"]) == (1, 1)


class MemoryCache:
    def __init__(self) -> None:
        self.items: dict[str, dict] = {}

    async def get(self, key: str) -> dict | None:
        return self.items.get(key)

    async def put(self, key: str, *, concept_id: str, asset_id: str, output: dict) -> None:
        self.items[key] = output


@pytest.mark.asyncio
async def test_an_unchanged_row_reuses_its_ai_answer(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    calls: list[dict] = []
    monkeypatch.setattr(document_module, "extract_attributes", _fake_agent({"country": "France"}, calls))
    specs = normalize_field_extractions({"country": {**RULES["country"], "extractionStrategy": "ai"}})
    cache = MemoryCache()
    await CellReader(specs, CONTEXT, cache=cache).read_rows([(2, {"notes": NOTES})])
    again = CellReader(specs, CONTEXT, cache=cache)
    [result] = await again.read_rows([(9, {"notes": NOTES})])
    assert len(calls) == 1 and again.stats["aiReused"] == 1
    assert result["values"] == {"country": "France"} and result["evidence"]["country"]["rowNumber"] == 9


def test_old_sheet_mappings_compile_and_fingerprint_as_before() -> None:
    validated = run_population_for_payload(command())
    assert validated["ok"] is True and "fieldExtractions" not in validated["sources"][0]
    source = {**sheet_source(), "sourceKind": "tabular"}
    plain = population_execution_fingerprint("h", [source], [])
    assert population_execution_fingerprint("h", [{**source, "fieldExtractions": None}], []) == plain
    assert population_execution_fingerprint("h", [{**source, "fieldExtractions": RULES}], []) != plain


def test_a_cell_extraction_counts_as_mapped_and_a_bad_one_fails_the_run() -> None:
    validated = run_population_for_payload(command(sources=[sheet_source(RULES)]))
    assert validated["ok"] is True
    assert validated["sources"][0]["fieldExtractions"]["country"]["column"] == "notes"
    bad = {"country": {"column": "notes", "rules": {"location": "pages", "pages": {"from": 1}}}}
    assert run_population_for_payload(command(sources=[sheet_source(bad)]))["errorCode"] == "invalid_column_mapping"
    twice = {"name": {"column": "notes"}}
    assert run_population_for_payload(command(sources=[sheet_source(twice)]))["errorCode"] == "duplicate_column_mapping"


def test_a_field_taken_from_an_extracted_field_is_allowed() -> None:
    extractions = {"name": {"column": "notes", "rules": {"labels": ["Pays"]}}}
    source = {**sheet_source(extractions, {"country": {"input": {"kind": "field", "name": "name"}, "method": "whole"}}),
              "columnMapping": {"customer_id": "customer_id"}}
    assert run_population_for_payload(command(sources=[source]))["ok"] is True


@pytest.mark.asyncio
async def test_a_run_reads_the_cells_and_keeps_row_and_column_evidence() -> None:
    outcome = await run_population_for_task(command(sources=[sheet_source(RULES)]),
                                            fetch=fake_fetch, prepare=fake_prepare, query=query)
    assert outcome["ok"] is True
    [country] = [item for item in outcome["assertions"] if item["attribute"] == "country"]
    assert country["value"] == "France"
    assert (country["evidence"]["rowNumber"], country["evidence"]["column"]) == (2, "notes")
    assert NOTES[country["evidence"]["span"]["start"]:country["evidence"]["span"]["end"]] == "France"
    # The row the rules found nothing in is one gap for the field, not one per row.
    [gap] = [gap for gap in outcome["gaps"] if gap.get("field") == "country"]
    assert gap["detail"] == "field 'country' was not found in 1 of 2 rows"


@pytest.mark.asyncio
async def test_old_sheet_mappings_read_rows_unchanged() -> None:
    outcome = await run_population_for_task(command(), fetch=fake_fetch, prepare=fake_prepare, query=query)
    assert {a["value"] for a in outcome["assertions"]} == {"Acme", "Globex"}
    assert all(set(a["evidence"]) == {"assetRef", "rowNumber", "column", "mappingVersion"} for a in outcome["assertions"])
    assert outcome["gaps"] == []


def test_the_mapping_preview_reads_cells_with_rules_and_leaves_ai_to_the_field_preview() -> None:
    profile = {"samples": [{"__sheetRow": 2, "customer_id": "C-1", "notes": NOTES}], "fieldProfiles": []}
    preview = build_mapping_preview(profile, {"fieldMappings": [
        {"sourceField": "customer_id", "targetAttribute": "customer_id", "mode": "direct"},
        {"sourceField": "notes", "targetAttribute": "country", "mode": "extract", "label": "Country",
         "rules": {"labels": ["Pays"]}},
        {"sourceField": "notes", "targetAttribute": "name", "mode": "extract", "extractionStrategy": "ai"},
    ], "identityFields": ["customer_id"]})
    assert preview is not None
    assert preview["entities"][0]["values"] == {"customer_id": "C-1", "country": "France", "name": None}
    assert any("AI" in warning for warning in preview["warnings"])


@pytest.mark.asyncio
async def test_the_cell_preview_route_reads_picked_rows_like_a_run() -> None:
    from app.api.population_routes import preview_cell_fields

    result = await preview_cell_fields({"modelId": "m1", "entry": {
        "conceptId": "c1", "source": {"assetId": "a1", "originalName": "crm.csv"},
        "fieldMappings": [
            {"sourceField": "customer_id", "targetAttribute": "customer_id", "mode": "direct"},
            {"sourceField": "notes", "targetAttribute": "country", "mode": "extract", "rules": {"labels": ["Pays"]}},
            {"sourceField": None, "targetAttribute": "name", "mode": "computed",
             "computed": {"input": {"kind": "field", "name": "country"}, "method": "whole", "transform": "upper"}},
        ]}, "rows": [{"rowNumber": 2, "values": {"customer_id": "C-1", "notes": NOTES}},
                     {"rowNumber": 3, "values": {"customer_id": "", "notes": None}}]})
    first, second = result["rows"]
    assert first["fields"]["country"]["value"] == "France" and first["fields"]["country"]["column"] == "notes"
    assert first["fields"]["name"] == {"method": "computed", "reason": "found", "input": "France", "value": "FRANCE"}
    assert first["fields"]["customer_id"]["value"] == "C-1"
    assert second["fields"]["country"]["reason"] == "no_input"
    assert second["fields"]["customer_id"]["reason"] == "no_input"
    assert result["ai"]["aiCalls"] == 0
