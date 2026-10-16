"""The model check lists every problem a preview or build would stop on (same rules, one pass)."""

from __future__ import annotations

import copy
import os

import pytest

from app.population.compiler import canonical_spec_hash
from app.population.model_check import check_model
from app.workers.population_tasks import run_population_for_payload
from test_population_compiler import base_spec

SOURCE = {"workspaceId": "6512f0a1c9e77a001234aaa1", "assetId": "6512f0a1c9e77a001234bbb1", "mimeType": "text/csv"}
DOCUMENT = {**SOURCE, "mimeType": "application/pdf"}


def sheet(concept: str = "c1", mapping: dict | None = None, **extra) -> dict:
    default = {"customer_id": "customer_id", "name": "name"} if concept == "c1" else {
        "agreement_no": "agreement_no", "status": "status", "country": "country", "parent_ref": "parent_ref"}
    return {"conceptId": concept, "source": dict(SOURCE), "options": {},
            "columnMapping": default if mapping is None else mapping, "mappingVersion": "v1", **extra}


def document(fields: list[dict], concept: str = "c1", **extra) -> dict:
    return {"conceptId": concept, "sourceKind": "document", "source": dict(DOCUMENT),
            "fieldMappings": fields, "mappingVersion": "v1", **extra}


def plan(sources: list[dict], spec: dict | None = None, bindings: list[dict] | None = None,
         derivations: list[dict] | None = None) -> dict:
    return {"specification": base_spec() if spec is None else spec, "sources": sources,
            "relationBindings": bindings or [], "derivations": derivations or []}


def as_run(request: dict) -> dict:
    """The command a build would admit for the same plan (ids a check carries are not part of it)."""
    sources = [{key: value for key, value in source.items() if key != "mappingId"} for source in request["sources"]]
    spec = request["specification"]
    payload = {"modelVersionId": "v1", "specHash": canonical_spec_hash(spec), "purpose": "build",
               "scope": {"kind": "model"}, "specification": spec, "sources": sources,
               "relationBindings": request["relationBindings"]}
    if request["derivations"]:
        payload["derivations"] = request["derivations"]
    return {"actorUserId": "u1", "modelId": "m1", "workspaceId": "6512f0a1c9e77a001234aaa1", "payload": payload}


def errors(result: dict) -> list[dict]:
    return [item for item in result["issues"] if item["severity"] == "error"]


def run_code(request: dict) -> str | None:
    outcome = run_population_for_payload(as_run(request))
    return None if outcome["ok"] else outcome["errorCode"]


def test_a_consistent_plan_has_no_issue_and_runs():
    request = plan([sheet(mappingId="map-1")])
    assert check_model(request) == {"issues": [], "errorCount": 0, "warningCount": 0}
    assert run_code(request) is None


def test_the_check_is_pure_and_fast():
    request = plan([sheet(mappingId="map-1")])
    before = copy.deepcopy(request)
    check_model(request)
    assert request == before


# Each case: a plan a run refuses, and the code both the run and the check report first.
def broken_plans() -> dict[str, tuple[dict, str]]:
    cases: dict[str, tuple[dict, str]] = {}
    cases["identity not mapped"] = (plan([sheet(mapping={"name": "name"})]), "unmapped_identity")
    cases["reserved name"] = (plan([sheet(mapping={"customer_id": "customer_id", "x": "_row"})]),
                              "reserved_attribute_name")
    cases["field read from two columns"] = (plan([sheet(mapping={"customer_id": "customer_id", "a": "name", "b": "name"})]),
                                            "duplicate_column_mapping")
    cases["fixed and read"] = (plan([sheet(mapping={"customer_id": "customer_id", "n": "name"},
                                           constantMapping={"name": "x"})]), "duplicate_column_mapping")
    cases["filter field not filled"] = (plan([sheet("c2", mapping={"agreement_no": "agreement_no"})]),
                                        "unmapped_filter_field")
    cases["sheet without field"] = (plan([sheet(mapping={})]), "invalid_column_mapping")
    cases["bad cell reading"] = (plan([sheet(fieldExtractions={"name": {"column": "", "extractionStrategy": "ai"}})]),
                                 "invalid_column_mapping")
    cases["ai limits out of range"] = (plan([sheet(
        fieldExtractions={"name": {"column": "notes", "extractionStrategy": "ai"}},
        options={"aiSettings": {"maxBlocks": 1}})]), "invalid_column_mapping")
    cases["recipe reads an unmapped field"] = (plan([sheet(fieldRecipes={"name": {
        "input": {"kind": "field", "name": "ghost"}, "method": "full"}})]), "invalid_column_mapping")
    cases["item without split"] = (plan([sheet(mapping={"customer_id": "customer_id", "@item": "name"})]),
                                   "invalid_column_mapping")
    cases["document field unknown"] = (plan([document([
        {"sourceField": "Id", "targetAttribute": "customer_id", "mode": "extract"},
        {"sourceField": "Nope", "targetAttribute": "nope", "mode": "extract"}])]), "invalid_document_mapping")
    cases["document rules unusable"] = (plan([document([
        {"sourceField": "Id", "targetAttribute": "customer_id", "mode": "extract", "rules": "x"}])]),
        "invalid_document_mapping")
    cases["document field twice"] = (plan([document([
        {"sourceField": "Id", "targetAttribute": "customer_id", "mode": "extract"},
        {"sourceField": "Id 2", "targetAttribute": "customer_id", "mode": "extract"}])]), "duplicate_document_mapping")
    cases["document identity missing"] = (plan([document([
        {"sourceField": "Name", "targetAttribute": "name", "mode": "extract"}])]), "unmapped_identity")
    cases["unknown concept"] = (plan([sheet("ghost")]), "unknown_concept")
    cases["no file"] = (plan([{**sheet(), "source": {"workspaceId": "ws"}}]), "invalid_sources")
    cases["link on an unmapped field"] = (plan([sheet("c2")], bindings=[
        {"relationId": "r1", "referenceField": "nowhere", "targetField": "agreement_no"}]), "invalid_relation_bindings")
    cases["unknown link"] = (plan([sheet("c2")], bindings=[
        {"relationId": "ghost", "referenceField": "parent_ref", "targetField": "agreement_no"}]), "unknown_relation")
    return cases


@pytest.mark.parametrize("name", list(broken_plans()))
def test_whatever_the_check_reports_as_error_a_run_refuses_with_the_same_code(name):
    request, code = broken_plans()[name]
    result = check_model(request)
    assert errors(result), name
    assert errors(result)[0]["code"] == code
    assert run_code(request) == code
    assert result["errorCount"] == len(errors(result))


def test_a_specification_a_run_refuses_is_reported_issue_by_issue():
    spec = base_spec()
    spec["concepts"][0]["identity"] = {"namespace": "crm", "keyComponents": []}
    spec["relations"][0]["cardinality"] = "nope"
    request = plan([sheet(mappingId="map-1")], spec=spec)
    codes = {item["code"] for item in errors(check_model(request))}
    assert {"empty_identity_key", "invalid_cardinality"} <= codes
    assert run_code(request) == "invalid_specification"
    relation = next(item for item in check_model(request)["issues"] if item["code"] == "invalid_cardinality")
    assert relation["relationId"] == "r1" and "conceptId" not in relation


def derived_spec() -> dict:
    return {
        "modelId": "m1", "modelVersionId": "v1", "homeWorkspaceId": "ws",
        "concepts": [
            {"conceptId": "contract", "key": "contract", "label": "Contract",
             "identity": {"namespace": "contract", "keyComponents": ["contract_no"]},
             "populationMode": "materialized", "allowedFields": ["contract_no", "customer_id", "customer_name"]},
            {"conceptId": "org", "key": "organization", "label": "Organization",
             "identity": {"namespace": "organization", "keyComponents": ["org_id"]},
             "populationMode": "materialized", "allowedFields": ["org_id", "name"]},
        ],
        "relations": [],
        "sourceScope": [{"workspaceId": "ws", "assetId": "a1"}],
    }


def derivation(**overrides) -> dict:
    return {"derivationId": "d1", "conceptId": "org", "sourceConceptId": "contract",
            "fieldMappings": [{"sourceAttribute": "customer_id", "targetAttribute": "org_id"},
                              {"sourceAttribute": "customer_name", "targetAttribute": "name"}],
            "conflictRule": "most_frequent", "mappingVersion": "v1", **overrides}


def contract_sheet() -> dict:
    return {"conceptId": "contract", "source": dict(SOURCE), "options": {}, "mappingVersion": "v1",
            "columnMapping": {"contract_no": "contract_no", "customer_id": "customer_id", "customer_name": "customer_name"}}


def derived_plan(**overrides) -> dict:
    return plan([contract_sheet()], spec=derived_spec(), derivations=[derivation(**overrides)])


def test_a_derived_source_that_holds_together_passes():
    request = derived_plan()
    assert check_model(request)["issues"] == []
    assert run_code(request) is None


@pytest.mark.parametrize("overrides, reason, field", [
    ({"fieldMappings": [{"sourceAttribute": "ghost", "targetAttribute": "org_id"}]}, "source_field_unknown", "org_id"),
    ({"fieldMappings": [{"sourceAttribute": "customer_name", "targetAttribute": "name"}]}, None, "org_id"),
    ({"fieldMappings": [{"sourceAttribute": "customer_id", "targetAttribute": "org_id"},
                        {"sourceAttribute": "customer_name", "targetAttribute": "org_id"}]}, "duplicate_target", "org_id"),
    ({"conflictRule": "latest"}, "order_by", None),
    ({"labelField": "country"}, "label_field", "country"),
    ({"aiSettings": {"maxBlocks": 1}}, "ai_settings", None),
])
def test_derived_source_rules_name_the_derivation_the_reason_and_the_field(overrides, reason, field):
    request = derived_plan(**overrides)
    result = check_model(request)
    found = errors(result)[0]
    assert found["sourceId"] == "d1" and found["conceptId"] == "org"
    assert found.get("reason") == reason
    assert found.get("fieldId") == field
    assert run_code(request) == found["code"]


def test_chained_derivations_are_reported_on_the_concept_that_feeds_another():
    spec = derived_spec()
    spec["concepts"].append({"conceptId": "city", "key": "city", "label": "City",
                             "identity": {"namespace": "city", "keyComponents": ["city_id"]},
                             "populationMode": "materialized", "allowedFields": ["city_id"]})
    second = {"derivationId": "d2", "conceptId": "city", "sourceConceptId": "org",
              "fieldMappings": [{"sourceAttribute": "org_id", "targetAttribute": "city_id"}],
              "conflictRule": "most_frequent", "mappingVersion": "v1"}
    request = plan([contract_sheet()], spec=spec, derivations=[derivation(), second])
    found = errors(check_model(request))
    assert [item["code"] for item in found] == ["chained_derivation"]
    assert found[0]["sourceId"] == "d2"
    assert run_code(request) == "chained_derivation"


def test_every_problem_is_listed_at_once_with_what_it_concerns():
    request = plan([
        sheet(mapping={"name": "name"}, mappingId="map-identity"),
        sheet("c2", mapping={"agreement_no": "agreement_no"}, mappingId="map-filter"),
        document([{"sourceField": "Id", "targetAttribute": "customer_id", "mode": "extract"},
                  {"sourceField": "X", "targetAttribute": "ghost", "mode": "extract"}], mappingId="map-doc"),
    ])
    found = errors(check_model(request))
    by_mapping = {(item["mappingId"], item["code"], item.get("fieldId")) for item in found}
    assert ("map-identity", "unmapped_identity", "customer_id") in by_mapping
    assert ("map-filter", "unmapped_filter_field", "status") in by_mapping
    assert ("map-filter", "unmapped_filter_field", "country") in by_mapping
    assert ("map-doc", "invalid_document_mapping", "ghost") in by_mapping
    assert all(item["conceptId"] in ("c1", "c2") for item in found)


def test_a_link_is_not_blamed_for_a_field_a_refused_source_does_fill():
    request = plan([sheet("c2", mapping={"agreement_no": "agreement_no", "parent_ref": "parent_ref"})],
                   bindings=[{"relationId": "r1", "referenceField": "parent_ref", "targetField": "agreement_no"}])
    codes = {item["code"] for item in check_model(request)["issues"]}
    assert "invalid_relation_bindings" not in codes
    assert "unmapped_filter_field" in codes


def test_a_link_names_its_relation_concept_and_missing_side():
    request = plan([sheet("c2")], bindings=[
        {"relationId": "r1", "referenceField": "nowhere", "targetField": "agreement_no"}])
    found = errors(check_model(request))[0]
    assert (found["relationId"], found["conceptId"], found["fieldId"], found["reason"]) == (
        "r1", "c2", "nowhere", "reference_unmapped")


def test_a_source_whose_shape_the_admission_would_refuse_is_reported_on_its_mapping():
    bad = {**document([{"sourceField": "Id", "targetAttribute": "customer_id", "mode": "extract"}]),
           "columnMapping": {"a": "b"}, "mappingId": "map-9"}
    found = errors(check_model(plan([bad])))
    assert found[0]["code"] == "invalid_document_mapping" and found[0]["reason"] == "shape"
    assert found[0]["mappingId"] == "map-9" and found[0]["conceptId"] == "c1"


def test_a_model_without_source_yet_is_not_an_error_here():
    assert check_model(plan([]))["issues"] == []


def test_the_route_needs_the_service_key_and_answers_the_check():
    pytest.importorskip("fastapi")
    from starlette.testclient import TestClient

    os.environ.setdefault("SEMANTIC_RUNTIME_SERVICE_KEY", "test-key")
    from app.main import create_app

    client = TestClient(create_app())
    request = plan([sheet(mapping={"name": "name"}, mappingId="map-1")])
    assert client.post("/v1/semantic-model-population/check", json=request).status_code == 401
    answer = client.post("/v1/semantic-model-population/check", json=request,
                         headers={"X-Semantic-Service-Key": os.environ["SEMANTIC_RUNTIME_SERVICE_KEY"]})
    assert answer.status_code == 200
    assert answer.json()["errorCount"] == 1
    assert answer.json()["issues"][0]["mappingId"] == "map-1"
