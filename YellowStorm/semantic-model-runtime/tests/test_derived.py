from __future__ import annotations

import pytest

from app.population.compiler import canonical_spec_hash, compile_specification
from app.population.derived import DerivationError, derive_concept, merge_derived, normalize_derivations
from app.workers.population_tasks import run_population_for_payload, run_population_for_task

SOURCE = {"workspaceId": "6512f0a1c9e77a001234aaa1", "assetId": "6512f0a1c9e77a001234bbb1", "mimeType": "text/csv"}


def spec() -> dict:
    return {
        "modelId": "m1", "modelVersionId": "v1", "homeWorkspaceId": "ws",
        "concepts": [
            {"conceptId": "contract", "key": "contract", "label": "Contract",
             "identity": {"namespace": "contract", "keyComponents": ["contract_no"]},
             "populationMode": "materialized",
             "allowedFields": ["contract_no", "customer_id", "customer_name", "signed_on"]},
            {"conceptId": "org", "key": "organization", "label": "Organization",
             "identity": {"namespace": "organization", "keyComponents": ["org_id"]},
             "populationMode": "materialized", "allowedFields": ["org_id", "name", "country"]},
        ],
        "relations": [
            {"relationId": "r1", "key": "belongs_to", "label": "belongs to",
             "sourceConceptId": "contract", "targetConceptId": "org",
             "cardinality": "many_to_one", "matchingStrategy": "normalized"},
        ],
        "sourceScope": [{"workspaceId": "ws", "assetId": "a1"}],
    }


def derivation(**overrides) -> dict:
    return {"derivationId": "d1", "conceptId": "org", "sourceConceptId": "contract",
            "fieldMappings": [{"sourceAttribute": "customer_id", "targetAttribute": "org_id"},
                              {"sourceAttribute": "customer_name", "targetAttribute": "name"}],
            "conflictRule": "most_frequent", "orderBy": None, "labelField": "name",
            "mappingVersion": "2026-09-30T00:00:00.000Z", **overrides}


def contract(entity_id: str, customer_id: str | None, name: str | None, signed_on: str | None = None) -> dict:
    attributes = {key: value for key, value in (("customer_id", customer_id), ("customer_name", name),
                                                ("signed_on", signed_on)) if value is not None}
    return {"entityId": entity_id, "conceptId": "contract", "namespace": "contract",
            "identity": {"contract_no": entity_id}, "label": entity_id.upper(), "attributes": attributes,
            "provenance": {"sources": [{"assetRef": {"assetId": f"file-{entity_id}", "assetVersionId": f"v-{entity_id}"},
                                        "mappingVersion": "m", "rowNumbers": []}]}}


def evidence(entity_id: str, attribute: str) -> dict:
    return {"entityId": entity_id, "attribute": attribute, "value": "x", "origin": "source",
            "evidence": {"assetRef": {"assetId": f"file-{entity_id}"}, "pageNumber": 1, "quote": f"quote {entity_id}",
                         "origin": "ai"}}


def compiled_concepts() -> dict:
    return compile_specification(spec())["concepts"]


def derive(entities: list[dict], **overrides) -> dict:
    concepts = compiled_concepts()
    [normalized] = normalize_derivations([derivation(**overrides)], concepts)
    return derive_concept(concepts["org"], normalized, entities,
                          [evidence(entity["entityId"], "customer_name") for entity in entities])


def names(output: dict) -> dict[str, str]:
    return {entity["identity"]["org_id"]: entity["attributes"].get("name") for entity in output["entities"]}


def test_one_record_per_distinct_key_with_the_evidence_of_the_value_kept():
    output = derive([contract("k1", "C-1", "Acme"), contract("k2", "c-1 ", "Acme"), contract("k3", "C-2", "Globex")])
    assert names(output) == {"c-1": "Acme", "c-2": "Globex"}
    acme = next(entity for entity in output["entities"] if entity["identity"]["org_id"] == "c-1")
    assert acme["label"] == "Acme"
    assert acme["provenance"]["derivedFrom"] == {"derivationId": "d1", "conceptId": "contract", "count": 2,
                                                 "entityIds": ["k1", "k2"]}
    # The files the contracts came from, so opening the record leads to them.
    assert {source["assetRef"]["assetId"] for source in acme["provenance"]["sources"]} == {"file-k1", "file-k2"}
    kept = next(assertion for assertion in output["assertions"] if assertion["entityId"] == acme["entityId"])
    assert kept["evidence"]["quote"] == "quote k1"
    assert kept["evidence"]["derivedFrom"]["records"] == 2


@pytest.mark.parametrize(("rule", "expected"), [
    ("most_frequent", "Acme"),
    ("longest", "Acme Corporation"),
    ("latest", "ACME SAS"),
    ("leave_empty", None),
])
def test_the_conflict_rule_picks_the_value_kept(rule: str, expected: str | None):
    records = [contract("k1", "C-1", "Acme", "2024-01-01"), contract("k2", "C-1", "Acme Corporation", "2025-06-01"),
               contract("k3", "C-1", "Acme", "2023-03-01"), contract("k4", "C-1", "ACME SAS", "01/02/2026")]
    output = derive(records, conflictRule=rule, orderBy="signed_on" if rule == "latest" else None)
    assert names(output) == {"c-1": expected}
    conflicts = [gap for gap in output["gaps"] if gap["kind"] == "conflicting_values"]
    assert len(conflicts) == (1 if rule == "leave_empty" else 0)


def test_records_without_a_key_value_are_reported():
    output = derive([contract("k1", None, "Nameless"), contract("k2", "C-2", "Globex")])
    assert names(output) == {"c-2": "Globex"}
    [gap] = output["gaps"]
    assert gap["kind"] == "missing_identity" and gap["conceptId"] == "org" and gap["values"] == {"record": "K1"}


def test_a_direct_value_wins_and_the_derived_one_fills_the_gaps():
    derived = derive([contract("k1", "C-1", "Acme")])
    direct_entity = {**derived["entities"][0], "attributes": {"country": "FR"},
                     "provenance": {"sources": [{"assetRef": {"assetVersionId": "crm"}, "mappingVersion": "x"}]}}
    direct = {"entities": [{**direct_entity, "attributes": {"country": "FR", "name": "ACME (CRM)"}}],
              "assertions": [], "gaps": [], "counts": {"materialized": 1}}
    merged = merge_derived(direct, derived)
    [entity] = merged["entities"]
    assert entity["attributes"] == {"country": "FR", "name": "ACME (CRM)"}
    # The derived name was not kept, so neither is its evidence.
    assert merged["assertions"] == []
    assert len(entity["provenance"]["sources"]) == 2
    assert merged["gaps"] == []


def test_derivations_are_checked_before_anything_is_read():
    concepts = compiled_concepts()
    with pytest.raises(DerivationError, match="unmapped_identity"):
        normalize_derivations([derivation(fieldMappings=[{"sourceAttribute": "customer_name", "targetAttribute": "name"}])], concepts)
    with pytest.raises(DerivationError, match="invalid_derivations"):
        normalize_derivations([derivation(conflictRule="latest")], concepts)
    with pytest.raises(DerivationError, match="invalid_derivations"):
        normalize_derivations([derivation(sourceConceptId="org")], concepts)
    with pytest.raises(DerivationError, match="chained_derivation"):
        normalize_derivations([derivation(), derivation(derivationId="d2", conceptId="contract", sourceConceptId="org",
                                                        fieldMappings=[{"sourceAttribute": "org_id", "targetAttribute": "contract_no"}],
                                                        labelField=None)], concepts)
    # A date to order by is only kept for the "most recent" rule.
    [normalized] = normalize_derivations([derivation(orderBy="signed_on")], concepts)
    assert normalized["orderBy"] is None


def command(derivations: list[dict], bindings: list[dict] | None = None) -> dict:
    return {
        "actorUserId": "u1", "modelId": "m1", "workspaceId": "6512f0a1c9e77a001234aaa1",
        "payload": {
            "modelVersionId": "v1", "specHash": canonical_spec_hash(spec()), "purpose": "build",
            "scope": {"kind": "model"}, "specification": spec(),
            "sources": [{"conceptId": "contract", "source": dict(SOURCE), "options": {},
                         "columnMapping": {"contract_no": "contract_no", "customer_id": "customer_id",
                                           "customer_name": "customer_name"},
                         "mappingVersion": "map-v1"}],
            "relationBindings": bindings or [], "derivations": derivations,
        },
    }


async def fake_fetch(source: dict, actor: str) -> bytes:
    return b"csv"


def fake_prepare(source: dict, options: dict | None, data: bytes, output) -> dict:  # type: ignore[no-untyped-def]
    output.write_bytes(b"parquet-bytes")
    return {"datasetId": "ds_0123456789abcdef01234567", "rowCount": 3}


def fake_query(path, *, columns=None, filters=None, limit=100, offset=0) -> dict:  # type: ignore[no-untyped-def]
    rows = [{"__sheetRow": 2, "contract_no": "K-1", "customer_id": "C-1", "customer_name": "Acme"},
            {"__sheetRow": 3, "contract_no": "K-2", "customer_id": "C-1", "customer_name": "Acme"},
            {"__sheetRow": 4, "contract_no": "K-3", "customer_id": "C-2", "customer_name": "Globex"}]
    return {"columns": columns, "rows": rows[offset:offset + limit], "returnedRows": max(0, 3 - offset),
            "limit": limit, "offset": offset}


def test_a_run_without_derivations_keeps_its_fingerprint():
    with_none = run_population_for_payload(command([]))
    payload = command([])
    del payload["payload"]["derivations"]
    assert run_population_for_payload(payload)["executionFingerprint"] == with_none["executionFingerprint"]
    assert run_population_for_payload(command([derivation()]))["executionFingerprint"] != with_none["executionFingerprint"]


def test_a_relationship_can_use_a_derived_field():
    validated = run_population_for_payload(command([derivation()], [
        {"relationId": "r1", "referenceField": "customer_id", "targetField": "org_id"}]))
    assert validated["ok"] is True
    without = run_population_for_payload(command([], [
        {"relationId": "r1", "referenceField": "customer_id", "targetField": "org_id"}]))
    assert without["errorCode"] == "invalid_relation_bindings"


@pytest.mark.asyncio
async def test_a_run_makes_the_derived_records_and_links_them():
    outcome = await run_population_for_task(
        command([derivation()], [{"relationId": "r1", "referenceField": "customer_id", "targetField": "org_id"}]),
        fetch=fake_fetch, prepare=fake_prepare, query=fake_query)
    assert outcome["ok"] is True, outcome
    organizations = [entity for entity in outcome["entities"] if entity["conceptId"] == "org"]
    assert sorted(entity["label"] for entity in organizations) == ["Acme", "Globex"]
    assert len(outcome["relationships"]) == 3
    assert not [gap for gap in outcome["gaps"] if gap["kind"] != "missing_value"]


def test_a_command_without_derivations_keeps_its_admission_shape():
    from app.jobs.models import PopulationPayload

    payload = command([])["payload"]
    del payload["derivations"]
    assert "derivations" not in PopulationPayload.model_validate(payload).model_dump(by_alias=True, mode="json")
    dumped = PopulationPayload.model_validate({**payload, "derivations": [derivation()]}).model_dump(by_alias=True, mode="json")
    assert dumped["derivations"] == [derivation()]
