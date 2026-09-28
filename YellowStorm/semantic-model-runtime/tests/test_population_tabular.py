from __future__ import annotations

import pytest

from app.population.compiler import compile_specification
from app.population.tabular import (entity_key, match_relationships, match_value,
                                    merge_concept_results, normalize_identity_value,
                                    populate_concept_rows)
from test_population_compiler import base_spec

SOURCE = {"assetRef": {"workspaceId": "ws", "assetId": "a1", "assetVersionId": "sha256:abc"},
          "mappingVersion": "map-v3", "labelField": "name"}


@pytest.fixture
def plan() -> dict:
    return compile_specification(base_spec())


def test_rows_become_entities_with_provenance(plan: dict):
    result = populate_concept_rows(plan["concepts"]["c1"], [
        {"_row": 2, "customer_id": "C-1", "name": "Acme", "country": "FR"},
        {"_row": 3, "customer_id": "C-2", "name": "Globex", "country": "DE"},
    ], SOURCE)
    assert result["counts"] == {"scanned": 2, "excluded": 0, "queryable": 0,
                                "materialized": 2, "gaps": 0}
    first = result["entities"][0]
    assert first["identity"] == {"customer_id": "c-1"}
    assert first["label"] == "Acme"
    assert first["provenance"]["sources"][0]["rowNumbers"] == [2]
    assert first["provenance"]["sources"][0]["mappingVersion"] == "map-v3"
    assert {a["attribute"] for a in result["assertions"]} == {"name", "country"}


def test_namespaces_keep_identical_ids_apart(plan: dict):
    left = populate_concept_rows(plan["concepts"]["c1"],
                                 [{"_row": 2, "customer_id": "X-1", "name": "A"}], SOURCE)
    other = dict(plan["concepts"]["c1"], namespace="billing")
    right = populate_concept_rows(other, [{"_row": 2, "customer_id": "X-1", "name": "A"}],
                                  SOURCE)
    assert left["entities"][0]["entityId"] != right["entities"][0]["entityId"]


def test_missing_identity_is_a_gap_not_a_partial_merge(plan: dict):
    result = populate_concept_rows(plan["concepts"]["c1"], [
        {"_row": 2, "customer_id": "", "name": "No key"},
        {"_row": 3, "name": "No column"},
    ], SOURCE)
    assert result["entities"] == [] and result["assertions"] == []
    assert [g["kind"] for g in result["gaps"]] == ["missing_identity", "missing_identity"]
    assert result["counts"]["gaps"] == 2


def test_eligibility_excludes_and_materialization_marks_queryable(plan: dict):
    result = populate_concept_rows(plan["concepts"]["c2"], [
        {"_row": 2, "agreement_no": "A-1", "status": "signed", "country": "FR"},
        {"_row": 3, "agreement_no": "A-2", "status": "signed", "country": "DE"},
        {"_row": 4, "agreement_no": "A-3", "status": "draft", "country": "FR"},
    ], SOURCE)
    assert result["counts"] == {"scanned": 3, "excluded": 1, "queryable": 1,
                                "materialized": 1, "gaps": 0}
    assert [e["identity"] for e in result["entities"]] == [{"agreement_no": "a-1"}]
    assert all("A-3" not in str(item) for item in (result["entities"], result["assertions"]))


def test_duplicate_identity_merges_and_conflicts_stay_visible(plan: dict):
    result = populate_concept_rows(plan["concepts"]["c1"], [
        {"_row": 2, "customer_id": "C-1", "name": "Acme", "country": "FR"},
        {"_row": 3, "customer_id": " c-1 ", "name": "Acme", "country": "DE"},
    ], SOURCE)
    assert len(result["entities"]) == 1
    assert result["entities"][0]["provenance"]["sources"][0]["rowNumbers"] == [2, 3]
    assert result["entities"][0]["attributes"]["country"] == "FR"
    assert [g["kind"] for g in result["gaps"]] == ["conflicting_values"]


def test_query_backed_keeps_identity_handles_only(plan: dict):
    concept = dict(plan["concepts"]["c1"], populationMode="query_backed")
    result = populate_concept_rows(concept, [
        {"_row": 2, "customer_id": "C-1", "name": "Acme", "country": "FR"},
    ], SOURCE)
    assert result["counts"]["materialized"] == 1
    assert result["entities"][0]["attributes"] == {}
    assert result["assertions"] == []


def test_relationship_matching_requires_approved_role(plan: dict):
    relation = plan["relations"]["r1"]
    targets = [{"entityId": "e1", "identity": {"agreement_no": "agr-2026-014"},
                "attributes": {}}]
    sources = [{"entityId": "e2", "identity": {"agreement_no": "amd-1"},
                "attributes": {"parent_ref": "AGR 2026-014"}}]
    matched = match_relationships(relation, sources, targets,
                                  reference_field="parent_ref", target_field="agreement_no")
    assert matched["relationships"] == [{"relationId": "r1", "sourceEntityId": "e2",
                                         "targetEntityId": "e1",
                                         "matchingStrategy": "normalized"}]
    assert matched["gaps"] == []

    example = match_relationships(relation,
                                  [{"entityId": "e3",
                                    "identity": {"agreement_no": "amd-2"},
                                    "attributes": {"parent_ref": "mentions AGR-2026-014"}}],
                                  targets, reference_field="parent_ref",
                                  target_field="agreement_no")
    assert example["relationships"] == []
    assert [g["kind"] for g in example["gaps"]] == ["unresolved_reference"]

    twins = match_relationships(relation, sources,
                                targets + [{"entityId": "e4",
                                            "identity": {"agreement_no": "AGR-2026-014"},
                                            "attributes": {}}],
                                reference_field="parent_ref", target_field="agreement_no")
    assert twins["relationships"] == []
    assert [g["kind"] for g in twins["gaps"]] == ["ambiguous_reference"]


def test_merge_keeps_first_value_and_both_provenances(plan: dict):
    first = populate_concept_rows(plan["concepts"]["c1"], [
        {"_row": 2, "customer_id": "C-1", "name": "Acme", "country": "FR"},
    ], SOURCE)
    second_source = {**SOURCE, "mappingVersion": "map-v4",
                     "assetRef": {**SOURCE["assetRef"], "assetVersionId": "sha256:def"}}
    second = populate_concept_rows(plan["concepts"]["c1"], [
        {"_row": 5, "customer_id": "C-1", "name": "Acme", "country": "DE"},
    ], second_source)
    merged = merge_concept_results([first, second])
    assert len(merged["entities"]) == 1
    assert merged["entities"][0]["attributes"]["country"] == "FR"
    assert len(merged["entities"][0]["provenance"]["sources"]) == 2
    assert [g["kind"] for g in merged["gaps"]] == ["conflicting_values"]
    assert merged["counts"]["materialized"] == 1


def test_identity_helpers_are_deterministic():
    assert normalize_identity_value("  ACME-1 ") == "acme-1"
    assert normalize_identity_value("") is None
    assert normalize_identity_value(None) is None
    assert entity_key("crm", {"a": "1"}) == entity_key("crm", {"a": "1"})
    assert entity_key("crm", {"a": "1"}) != entity_key("crm", {"a": "2"})
    # Parity vectors with normalizeRelationValue (Slice 3).
    assert match_value("  Société A & B, S.A. ", "normalized") == "societe a and b s a"
    assert match_value(" C001 ", "exact") == "C001"
    assert match_value(" C001 ", "case_insensitive") == "c001"
    assert match_value("   ", "exact") is None


def test_exact_and_case_insensitive_strategies_match_symmetrically(plan: dict):
    targets = [{"entityId": "e1", "identity": {"customer_id": "c001"}, "attributes": {}}]
    exact = dict(plan["relations"]["r1"], matchingStrategy="exact")
    sources = [{"entityId": "e2", "identity": {"customer_id": "x"},
                "attributes": {"customer_ref": " C001 "}}]
    matched = match_relationships(exact, sources, targets,
                                  reference_field="customer_ref", target_field="customer_id")
    assert [r["targetEntityId"] for r in matched["relationships"]] == ["e1"]

    folded = dict(plan["relations"]["r1"], matchingStrategy="case_insensitive")
    mixed = [{"entityId": "e3", "identity": {"customer_id": "x"},
              "attributes": {"customer_ref": "c001"}}]
    targets_upper = [{"entityId": "e4", "identity": {"customer_id": "c001"},
                      "attributes": {}}]
    matched_folded = match_relationships(folded, mixed, targets_upper,
                                          reference_field="customer_ref",
                                          target_field="customer_id")
    assert [r["targetEntityId"] for r in matched_folded["relationships"]] == ["e4"]


def test_identity_reference_matches_a_plain_attribute_whatever_its_case(plan: dict):
    """A typed customer's key (stored folded) must find the contract that quotes it as written."""
    exact = dict(plan["relations"]["r1"], matchingStrategy="exact", cardinality="one_to_many")
    customers = [{"entityId": "acme", "identity": {"customer_id": "c041"}, "attributes": {}}]
    contracts = [{"entityId": "cnt-41", "identity": {"contract_number": "cnt-41"},
                  "attributes": {"customer_id": "C041"}},
                 {"entityId": "cnt-99", "identity": {"contract_number": "cnt-99"},
                  "attributes": {"customer_id": "C002"}}]
    matched = match_relationships(exact, customers, contracts,
                                  reference_field="customer_id", target_field="customer_id")
    assert [r["targetEntityId"] for r in matched["relationships"]] == ["cnt-41"]
    assert matched["gaps"] == []


def test_exact_between_plain_attributes_keeps_case(plan: dict):
    exact = dict(plan["relations"]["r1"], matchingStrategy="exact")
    sources = [{"entityId": "s1", "identity": {"k": "1"}, "attributes": {"ref": "AB-1"}},
               {"entityId": "s2", "identity": {"k": "2"}, "attributes": {"ref": "ab-1"}}]
    targets = [{"entityId": "t1", "identity": {"k": "t"}, "attributes": {"code": "AB-1"}}]
    matched = match_relationships(exact, sources, targets, reference_field="ref", target_field="code")
    assert [(r["sourceEntityId"], r["targetEntityId"]) for r in matched["relationships"]] == [("s1", "t1")]


def test_one_to_many_matches_one_field_of_composite_target_identity(plan: dict):
    relation = dict(plan["relations"]["r1"], cardinality="one_to_many")
    sources = [{"entityId": "contract", "identity": {"contract_number": "c-1"},
                "attributes": {}}]
    targets = [
        {"entityId": "amendment-1",
         "identity": {"contract_number": "c-1", "amendment_number": "1"},
         "attributes": {}},
        {"entityId": "amendment-2",
         "identity": {"contract_number": "c-1", "amendment_number": "2"},
         "attributes": {}},
    ]

    matched = match_relationships(relation, sources, targets,
                                  reference_field="contract_number",
                                  target_field="contract_number")

    assert [item["targetEntityId"] for item in matched["relationships"]] == [
        "amendment-1", "amendment-2"]
    assert matched["gaps"] == []
