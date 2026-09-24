from __future__ import annotations

import pytest

from app.population.compiler import (PopulationError, canonical_spec_hash, compile_specification,
                                     evaluate_filter, filter_fields, validate_specification)


def base_spec() -> dict:
    return {
        "modelId": "m1", "modelVersionId": "v1", "homeWorkspaceId": "ws",
        "concepts": [
            {"conceptId": "c1", "key": "customer", "label": "Customer",
             "identity": {"namespace": "crm", "keyComponents": ["customer_id"]},
             "populationMode": "materialized",
             "allowedFields": ["customer_id", "name", "country"]},
            {"conceptId": "c2", "key": "agreement", "label": "Agreement",
             "identity": {"namespace": "contracts", "keyComponents": ["agreement_no"]},
             "populationMode": "filtered_materialized",
             "eligibility": {"field": "status", "op": "eq", "value": "signed"},
             "materialization": {"field": "country", "op": "eq", "value": "FR"},
             "allowedFields": ["agreement_no", "customer_ref", "parent_ref", "status",
                               "country"]},
        ],
        "relations": [
            {"relationId": "r1", "key": "amends", "label": "amends",
             "sourceConceptId": "c2", "targetConceptId": "c2",
             "cardinality": "many_to_one", "matchingStrategy": "normalized"},
        ],
        "sourceScope": [{"workspaceId": "ws", "assetId": "a1"}],
    }


def codes(issues: list[dict]) -> list[str]:
    return [issue["code"] for issue in issues]


def test_valid_specification_has_no_issues():
    assert validate_specification(base_spec()) == []


def test_validation_rejects_identity_relation_and_scope_gaps():
    spec = base_spec()
    spec["concepts"][0]["identity"] = {"namespace": "crm", "keyComponents": []}
    spec["concepts"].append({**spec["concepts"][0], "key": "customer"})
    spec["concepts"][1]["materialization"] = None
    spec["concepts"][1]["eligibility"] = {"field": "nope", "op": "eq", "value": "x"}
    spec["relations"][0]["targetConceptId"] = "missing"
    spec["relations"][0]["cardinality"] = "invalid"
    spec["sourceScope"] = []
    found = codes(validate_specification(spec))
    for code in ("duplicate_concept_id", "duplicate_concept_key", "empty_identity_key",
                 "unknown_filter_field", "unknown_relation_endpoint", "invalid_cardinality",
                 "empty_source_scope"):
        assert code in found


def test_filters_evaluate_typed_operators_and_groups():
    row = {"a": "x", "b": "1", "c": None, "d": ""}
    assert evaluate_filter({"field": "a", "op": "eq", "value": "x"}, row) is True
    assert evaluate_filter({"field": "a", "op": "neq", "value": "y"}, row) is True
    assert evaluate_filter({"field": "b", "op": "in", "value": ["1", "2"]}, row) is True
    assert evaluate_filter({"field": "b", "op": "not_in", "value": ["2"]}, row) is True
    assert evaluate_filter({"field": "c", "op": "is_null"}, row) is True
    assert evaluate_filter({"field": "d", "op": "is_null"}, row) is True
    assert evaluate_filter({"field": "a", "op": "is_not_null"}, row) is True
    assert evaluate_filter({"field": "c", "op": "eq", "value": "x"}, row) is False
    assert evaluate_filter({"all": [{"field": "a", "op": "eq", "value": "x"},
                                     {"field": "b", "op": "eq", "value": "1"}]}, row) is True
    assert evaluate_filter({"any": [{"field": "a", "op": "eq", "value": "zzz"},
                                     {"field": "b", "op": "eq", "value": "1"}]}, row) is True
    assert evaluate_filter({"not": {"field": "a", "op": "eq", "value": "x"}}, row) is False
    assert evaluate_filter(None, row) is True
    with pytest.raises(PopulationError):
        evaluate_filter({"field": "a", "op": "contains", "value": "x"}, row)


def test_filter_fields_collects_every_leaf():
    assert filter_fields({"field": "a", "op": "eq", "value": "x"}) == ["a"]
    assert filter_fields({"all": [{"field": "a", "op": "eq"},
                                   {"any": [{"field": "b", "op": "is_null"}]},
                                   ], "not": {"field": "c", "op": "is_not_null"}}) == ["a", "b", "c"]
    assert filter_fields(None) == []
    assert filter_fields({"all": []}) == []


def test_compile_produces_executable_plans():
    plan = compile_specification(base_spec())
    assert plan["concepts"]["c1"]["namespace"] == "crm"
    assert plan["concepts"]["c1"]["keyComponents"] == ["customer_id"]
    assert plan["concepts"]["c2"]["materialization"] == {"field": "country", "op": "eq",
                                                         "value": "FR"}
    assert plan["relations"]["r1"]["matchingStrategy"] == "normalized"


def test_spec_hash_matches_typescript_snapshot():
    # Golden vector produced by the real ModelSpecificationService.buildSnapshot
    # (temporary __golden__.spec.ts, since removed). Locks the cross-language
    # canonical contract so the worker can verify specHash byte-for-byte.
    assert (canonical_spec_hash(base_spec())
            == "sha256:38faefc6324ba82935fcba855b784f6170192e29e83b9cd88441af487e013045")


def test_spec_hash_matches_mixed_case_ordering():
    # Golden vector from ModelSpecificationService with code-unit ordering
    # (C-10 < c-2 < c-customer). Guards the localeCompare divergence.
    spec = {
        "modelId": "model-1", "modelVersionId": "v1", "homeWorkspaceId": "ws-1",
        "concepts": [
            {"conceptId": "c-customer", "key": "customer", "label": "Customer",
             "identity": {"namespace": "customer", "keyComponents": ["customer_id"]},
             "populationMode": "filtered_materialized",
             "eligibility": {"field": "country", "op": "eq", "value": "FR"},
             "materialization": {"field": "country", "op": "eq", "value": "FR"},
             "allowedFields": ["customer_id", "country"]},
            {"conceptId": "C-10", "key": "upper", "label": "Upper",
             "identity": {"namespace": "t", "keyComponents": ["id"]},
             "populationMode": "materialized", "allowedFields": ["id"]},
            {"conceptId": "c-2", "key": "lower", "label": "Lower",
             "identity": {"namespace": "t", "keyComponents": ["id"]},
             "populationMode": "materialized", "allowedFields": ["id"]},
        ],
        "relations": [
            {"relationId": "r-1", "key": "has_contract", "label": "has contract",
             "sourceConceptId": "c-customer", "targetConceptId": "c-customer",
             "cardinality": "one_to_many", "matchingStrategy": "exact"},
        ],
        "sourceScope": [{"workspaceId": "ws-1", "assetId": "a-1"}],
    }
    assert (canonical_spec_hash(spec)
            == "sha256:939602a81345922fc6c2929eaa47f63c4b615ba492e812c4decc21d7a0bb4ed6")


def test_spec_hash_is_deterministic_and_order_independent():
    first = canonical_spec_hash(base_spec())
    assert first.startswith("sha256:") and len(first) == 71
    shuffled = base_spec()
    shuffled["concepts"] = list(reversed(shuffled["concepts"]))
    shuffled["concepts"][0]["allowedFields"] = list(
        reversed(shuffled["concepts"][0]["allowedFields"]))
    assert canonical_spec_hash(shuffled) == first
    changed = base_spec()
    changed["concepts"][0]["label"] = "Client"
    assert canonical_spec_hash(changed) != first
