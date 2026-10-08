"""Derived fields read like sheet fields: copied, read out of a source field's text (rules, AI), by a
recipe or fixed, with the source record, field and span as evidence."""

from __future__ import annotations

from typing import Any

import pytest

from app.population import document as document_module
from app.population.compiler import canonical_spec_hash, compile_specification
from app.population.derived import (DerivationError, derive_concept, normalize_derivations,
                                    read_derived_fields)
from app.workers.population_tasks import run_population_for_payload, run_population_for_task
from test_cell_fields import MemoryCache, _fake_agent
from test_derived import SOURCE, fake_fetch, fake_prepare

# The execution fingerprint of test_derived's command([derivation()]) before the field modes existed.
OLD_FINGERPRINT = "sha256:f20c47fc272a46120610cd9055e3d81b523ae0a0d3d8feeef731d947d998fdca"

NOTES_1 = "Client: Acme\nPays: France\nSiège à Paris"
NOTES_2 = "Le client Globex est installé en Belgique."


def spec() -> dict:
    return {
        "modelId": "m1", "modelVersionId": "v1", "homeWorkspaceId": "ws",
        "concepts": [
            {"conceptId": "contract", "key": "contract", "label": "Contract",
             "identity": {"namespace": "contract", "keyComponents": ["contract_no"]},
             "populationMode": "materialized",
             "allowedFields": ["contract_no", "customer_id", "customer_name", "notes"]},
            {"conceptId": "org", "key": "organization", "label": "Organization",
             "identity": {"namespace": "organization", "keyComponents": ["org_id"]},
             "populationMode": "materialized", "allowedFields": ["org_id", "name", "country", "kind", "short"]},
        ],
        "relations": [],
        "sourceScope": [{"workspaceId": "ws", "assetId": "a1"}],
    }


COPIED = [{"sourceAttribute": "customer_id", "targetAttribute": "org_id"},
          {"sourceAttribute": "customer_name", "targetAttribute": "name"}]


def derivation(*fields: dict, **overrides: Any) -> dict:
    return {"derivationId": "d1", "conceptId": "org", "sourceConceptId": "contract",
            "fieldMappings": [*COPIED, *fields], "conflictRule": "most_frequent", "orderBy": None,
            "labelField": "name", "mappingVersion": "2026-10-01T00:00:00.000Z", **overrides}


COUNTRY_RULES = {"sourceAttribute": "notes", "targetAttribute": "country", "mode": "extract", "label": "Country",
                 "extractionStrategy": "deterministic", "rules": {"labels": ["Pays"]}}


def contract(entity_id: str, customer_id: str, name: str, notes: str | None) -> dict:
    attributes = {"customer_id": customer_id, "customer_name": name, **({"notes": notes} if notes else {})}
    return {"entityId": entity_id, "conceptId": "contract", "namespace": "contract",
            "identity": {"contract_no": entity_id}, "label": entity_id.upper(), "attributes": attributes,
            "provenance": {"sources": [{"assetRef": {"assetId": f"file-{entity_id}", "assetVersionId": f"v-{entity_id}"},
                                        "mappingVersion": "m", "rowNumbers": []}]}}


def source_evidence(entity_id: str, attribute: str) -> dict:
    return {"entityId": entity_id, "attribute": attribute, "value": "x", "origin": "source",
            "evidence": {"assetRef": {"assetId": f"file-{entity_id}"}, "pageNumber": 2, "quote": f"quote {entity_id}"}}


CONTRACTS = [contract("k1", "C-1", "Acme", NOTES_1), contract("k2", "C-2", "Globex", NOTES_2)]
ASSERTIONS = [source_evidence(entity["entityId"], "notes") for entity in CONTRACTS]
CONTEXT = {"conceptId": "org", "conceptLabel": "Organization", "source": {"assetId": "derived:d1", "originalName": "Contract"},
           "assetRef": {}, "modelId": "m1", "aiExtraction": {"agentSlug": "extractor", "model": "m", "contractVersion": "v1"}}


def concepts() -> dict:
    return compile_specification(spec())["concepts"]


async def derive(entry: dict, entities: list[dict] = CONTRACTS, **options: Any) -> tuple[dict, dict]:
    all_concepts = concepts()
    [normalized] = normalize_derivations([entry], all_concepts)
    read = await read_derived_fields(normalized, entities, CONTEXT, **options)
    output = derive_concept(all_concepts["org"], normalized, entities, ASSERTIONS, read["readings"])
    return output, read


def by_org(output: dict, attribute: str) -> dict[str, Any]:
    return {entity["identity"]["org_id"]: entity["attributes"].get(attribute) for entity in output["entities"]}


def assertion(output: dict, org_id: str, attribute: str) -> dict:
    entity = next(entity for entity in output["entities"] if entity["identity"]["org_id"] == org_id)
    return next(item for item in output["assertions"] if item["entityId"] == entity["entityId"] and item["attribute"] == attribute)


def test_copied_fields_keep_their_shape_and_fingerprint() -> None:
    from test_derived import command, derivation as old_derivation

    [normalized] = normalize_derivations([old_derivation()], compile_specification(
        __import__("test_derived").spec())["concepts"])
    assert normalized["fieldMappings"] == [{"sourceAttribute": "customer_id", "targetAttribute": "org_id"},
                                           {"sourceAttribute": "customer_name", "targetAttribute": "name"}]
    assert set(normalized) == {"derivationId", "conceptId", "sourceConceptId", "fieldMappings", "conflictRule",
                               "orderBy", "labelField", "mappingVersion"}
    assert run_population_for_payload(command([old_derivation()]))["executionFingerprint"] == OLD_FINGERPRINT


@pytest.mark.asyncio
async def test_copied_fields_read_nothing_and_derive_as_before() -> None:
    [normalized] = normalize_derivations([derivation()], concepts())
    read = await read_derived_fields(normalized, CONTRACTS, CONTEXT)
    assert read == {"readings": {}, "gaps": [], "stats": {}}
    output = derive_concept(concepts()["org"], normalized, CONTRACTS, ASSERTIONS)
    assert output == derive_concept(concepts()["org"], normalized, CONTRACTS, ASSERTIONS, read["readings"])
    assert "method" not in assertion(output, "c-1", "name")["evidence"]["derivedFrom"]


@pytest.mark.asyncio
async def test_rules_read_the_source_field_text_with_record_field_and_span_as_evidence() -> None:
    output, read = await derive(derivation(COUNTRY_RULES))
    assert by_org(output, "country") == {"c-1": "France", "c-2": None}
    evidence = assertion(output, "c-1", "country")["evidence"]
    # The source value's own evidence (its file, page and quote) is kept, so the document still opens.
    assert evidence["assetRef"] == {"assetId": "file-k1"} and evidence["quote"] == "quote k1"
    derived_from = evidence["derivedFrom"]
    assert (derived_from["entityId"], derived_from["attribute"], derived_from["method"]) == ("k1", "notes", "rules")
    assert NOTES_1[derived_from["span"]["start"]:derived_from["span"]["end"]] == "France"
    # The record the rules missed is reported once for the field, in records.
    [gap] = read["gaps"]
    assert gap["kind"] == "unresolved_document_field" and gap["field"] == "country"
    assert gap["detail"] == "field 'country' was not found in 1 of 2 records" and gap["derivationId"] == "d1"


@pytest.mark.asyncio
async def test_rules_then_ai_asks_once_per_record_the_rules_missed(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    calls: list[dict] = []
    monkeypatch.setattr(document_module, "extract_attributes", _fake_agent({"country": "Belgique"}, calls))
    output, read = await derive(derivation({**COUNTRY_RULES, "extractionStrategy": "rules_then_ai",
                                            "description": "The customer's country"}))
    assert by_org(output, "country") == {"c-1": "France", "c-2": "Belgique"}
    assert len(calls) == 1 and read["stats"]["aiCalls"] == 1
    assert calls[0]["file_name"] == "Contract · record k2" and calls[0]["concept_id"] == "org"
    evidence = assertion(output, "c-2", "country")["evidence"]
    assert evidence["origin"] == "ai" and evidence["derivedFrom"]["method"] == "ai"
    assert NOTES_2[evidence["derivedFrom"]["span"]["start"]:evidence["derivedFrom"]["span"]["end"]] == "Belgique"
    assert assertion(output, "c-1", "country")["evidence"]["derivedFrom"]["method"] == "rules"


@pytest.mark.asyncio
async def test_ai_is_bounded_per_run_and_reuses_unchanged_texts(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    calls: list[dict] = []
    monkeypatch.setattr(document_module, "extract_attributes", _fake_agent({"country": "France"}, calls))
    ai_only = {**COUNTRY_RULES, "extractionStrategy": "ai"}
    del ai_only["rules"]
    same_text = [contract("k1", "C-1", "Acme", NOTES_1), contract("k2", "C-2", "Globex", NOTES_1)]
    output, read = await derive(derivation(ai_only), same_text, ai_records=1)
    assert by_org(output, "country") == {"c-1": "France", "c-2": None}
    assert (read["stats"]["aiCalls"], read["stats"]["aiSkippedRows"]) == (1, 1)
    assert any(gap["kind"] == "budget_exhausted" and "1 records" in gap["detail"] for gap in read["gaps"])
    cache = MemoryCache()
    await derive(derivation(ai_only), same_text[:1], cache=cache)
    _again, read = await derive(derivation(ai_only), same_text[1:], cache=cache)
    assert read["stats"]["aiReused"] == 1 and len(calls) == 2


@pytest.mark.asyncio
async def test_a_recipe_takes_a_source_field_and_a_constant_is_fixed() -> None:
    recipe = {"targetAttribute": "short", "mode": "computed",
              "computed": {"input": {"kind": "column", "name": "customer_name"}, "method": "whole",
                           "transform": "upper"}}
    from_field = {"targetAttribute": "kind", "mode": "constant", "constantValue": "Customer"}
    output, _read = await derive(derivation(recipe, from_field))
    assert by_org(output, "short") == {"c-1": "ACME", "c-2": "GLOBEX"}
    assert by_org(output, "kind") == {"c-1": "Customer", "c-2": "Customer"}
    derived_from = assertion(output, "c-1", "short")["evidence"]["derivedFrom"]
    assert (derived_from["attribute"], derived_from["method"]) == ("customer_name", "recipe")
    assert assertion(output, "c-1", "kind")["evidence"]["derivedFrom"]["method"] == "constant"


@pytest.mark.asyncio
async def test_a_key_can_be_read_out_of_a_source_field() -> None:
    key_rule = {"sourceAttribute": "notes", "targetAttribute": "org_id", "mode": "extract", "label": "Client",
                "extractionStrategy": "deterministic", "rules": {"labels": ["Client"]}}
    entry = derivation(key_rule, fieldMappings=[key_rule, COPIED[1]])
    output, _read = await derive(entry)
    assert [entity["identity"] for entity in output["entities"]] == [{"org_id": "acme"}]
    gaps = [gap for gap in output["gaps"] if gap["kind"] == "missing_identity"]
    assert len(gaps) == 1 and "'notes'" in gaps[0]["detail"]


@pytest.mark.parametrize("field", [
    {**COUNTRY_RULES, "sourceAttribute": "unknown"},
    {**COUNTRY_RULES, "extractionStrategy": "magic"},
    {**COUNTRY_RULES, "rules": {"location": "table", "labels": ["Pays"]}},
    {"targetAttribute": "short", "mode": "computed", "computed": {"input": {"kind": "file", "name": "document_name"},
                                                                  "method": "whole"}},
    {"targetAttribute": "short", "mode": "computed", "computed": {"input": {"kind": "column", "name": "nope"},
                                                                  "method": "whole"}},
    {"targetAttribute": "kind", "mode": "constant", "constantValue": {"a": 1}},
    {"targetAttribute": "kind", "mode": "guess", "sourceAttribute": "notes"},
])
def test_unusable_derived_fields_are_refused_before_anything_is_read(field: dict) -> None:
    with pytest.raises(DerivationError, match="invalid_derivations"):
        normalize_derivations([derivation(field)], concepts())


def command(entry: dict) -> dict:
    return {
        "actorUserId": "u1", "modelId": "m1", "workspaceId": "6512f0a1c9e77a001234aaa1",
        "payload": {
            "modelVersionId": "v1", "specHash": canonical_spec_hash(spec()), "purpose": "build",
            "scope": {"kind": "model"}, "specification": spec(),
            "sources": [{"conceptId": "contract", "source": dict(SOURCE), "options": {},
                         "columnMapping": {"contract_no": "contract_no", "customer_id": "customer_id",
                                           "customer_name": "customer_name", "notes": "notes"},
                         "mappingVersion": "map-v1"}],
            "relationBindings": [], "derivations": [entry],
        },
    }


def fake_query(path, *, columns=None, filters=None, limit=100, offset=0) -> dict:  # type: ignore[no-untyped-def]
    rows = [{"__sheetRow": 2, "contract_no": "K-1", "customer_id": "C-1", "customer_name": "Acme", "notes": NOTES_1},
            {"__sheetRow": 3, "contract_no": "K-2", "customer_id": "C-2", "customer_name": "Globex", "notes": NOTES_2}]
    return {"columns": columns, "rows": rows[offset:offset + limit], "returnedRows": max(0, 2 - offset),
            "limit": limit, "offset": offset}


@pytest.mark.asyncio
async def test_a_run_reads_derived_fields_out_of_the_source_records() -> None:
    entry = derivation(COUNTRY_RULES)
    validated = run_population_for_payload(command(entry))
    assert validated["ok"] is True and validated["derivations"][0]["fieldMappings"][2] == COUNTRY_RULES
    plain = run_population_for_payload(command(derivation()))
    assert validated["executionFingerprint"] != plain["executionFingerprint"]
    outcome = await run_population_for_task(command(entry), fetch=fake_fetch, prepare=fake_prepare, query=fake_query)
    assert outcome["ok"] is True, outcome
    organizations = {entity["label"]: entity["attributes"] for entity in outcome["entities"] if entity["conceptId"] == "org"}
    assert organizations["Acme"].get("country") == "France" and "country" not in organizations["Globex"]
    country = next(item for item in outcome["assertions"] if item["attribute"] == "country")
    assert country["evidence"]["derivedFrom"]["attribute"] == "notes"
    assert country["evidence"]["rowNumber"] == 2  # the source row the contract came from


def test_the_admission_model_keeps_derived_field_settings() -> None:
    from app.jobs.models import PopulationPayload

    payload = command(derivation(COUNTRY_RULES, aiSettings={"maxBlocks": 50}))["payload"]
    dumped = PopulationPayload.model_validate(payload).model_dump(by_alias=True, mode="json")
    assert dumped["derivations"][0]["fieldMappings"][2] == COUNTRY_RULES
    assert dumped["derivations"][0]["aiSettings"] == {"maxBlocks": 50}
    old = PopulationPayload.model_validate(command(derivation())["payload"]).model_dump(by_alias=True, mode="json")
    assert old["derivations"][0]["fieldMappings"] == COPIED and "aiSettings" not in old["derivations"][0]
