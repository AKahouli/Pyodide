from __future__ import annotations

import pytest

from app.population.compiler import PopulationError
from app.search.manifest import build_context_manifest, context_expired
from app.search.projections import build_entity_projections, match_candidates


def _entity(entity_id: str, identity: dict) -> dict:
    return {"entityId": entity_id, "conceptId": "c1", "label": entity_id,
            "identity": identity, "attributes": {}}


def test_projections_precompute_strategy_keys():
    projections = build_entity_projections(
        [_entity("e1", {"customer_id": "C-001"})], model_id="m1", revision_id="dr_1")
    assert projections[0]["searchKeys"] == {
        "exact": "c-001", "case_insensitive": "c-001", "normalized": "c 001"}
    assert projections[0]["dataRevisionId"] == "dr_1"


def test_candidates_never_auto_resolve():
    projections = build_entity_projections(
        [_entity("e1", {"name": "Acme Corp"}), _entity("e2", {"name": "Globex"})],
        model_id="m1", revision_id="dr_1")
    exact = match_candidates(projections, "Acme Corp", "exact")
    assert [c["entityId"] for c in exact["candidates"]] == ["e1"]
    assert exact["ambiguous"] is False
    # Case variants resolve identically: keys live in the normalized space.
    assert [c["entityId"] for c in
            match_candidates(projections, "ACME CORP", "exact")["candidates"]] == ["e1"]
    twins = build_entity_projections(
        [_entity("e1", {"name": "Acme Corp"}), _entity("e2", {"name": "acme corp"})],
        model_id="m1", revision_id="dr_1")
    assert match_candidates(twins, "ACME CORP", "case_insensitive")["ambiguous"] is True
    assert match_candidates(projections, "Nobody", "exact")["candidates"] == []
    with pytest.raises(PopulationError):
        match_candidates(projections, "x", "fuzzy")


def test_exact_reference_agrees_with_graph_edges():
    # A raw reference that creates a relationship edge must yield the same
    # candidate under exact search. Identities are worker-normalized here, as
    # populate_concept_rows stores them.
    from app.population.tabular import match_relationships

    targets = [{"entityId": "e1", "identity": {"customer_id": "c001"}, "attributes": {}}]
    sources = [{"entityId": "e2", "identity": {"x": "1"},
                "attributes": {"ref": " C001 "}}]
    relation = {"relationId": "r1", "matchingStrategy": "exact"}
    assert len(match_relationships(relation, sources, targets, "ref")["relationships"]) == 1
    projections = build_entity_projections(targets, model_id="m1", revision_id="dr_1")
    found = match_candidates(projections, " C001 ", "exact")
    assert [c["entityId"] for c in found["candidates"]] == ["e1"]


def test_context_manifest_is_deterministic_and_bounded():
    scope = [{"workspaceId": "ws2", "assetId": "b"}, {"workspaceId": "ws1", "assetId": "a"}]
    first = build_context_manifest(actor_user_id="u1", model_id="m1", model_version_id="v1",
                                   data_revision_id="dr_1",
                                   source_scope=scope, now=1_000_000)
    second = build_context_manifest(actor_user_id="u1", model_id="m1", model_version_id="v1",
                                    data_revision_id="dr_1", source_scope=list(reversed(scope)),
                                    now=1_000_000)
    assert first["contextId"] == second["contextId"]
    assert first["contextId"].startswith("ctx_")
    assert first["sourceScope"] == [{"workspaceId": "ws1", "assetId": "a"},
                                    {"workspaceId": "ws2", "assetId": "b"}]
    assert first["expiresAt"] == "1970-01-12T14:46:40+00:00"
    assert context_expired(first, now=1_000_000) is False
    assert context_expired(first, now=1_000_000 + 3600) is True


def test_context_manifest_rejects_bad_scope():
    base = {"actor_user_id": "u1", "model_id": "m1", "model_version_id": "v1",
            "data_revision_id": "dr_1", "now": 1_000_000}
    with pytest.raises(PopulationError):
        build_context_manifest(**base, source_scope=[])
    with pytest.raises(PopulationError):
        build_context_manifest(**base, source_scope=[{"workspaceId": "ws1", "assetId": "a"},
                                                      {"workspaceId": "ws1", "assetId": "a"}])
    with pytest.raises(PopulationError):
        build_context_manifest(**base, source_scope=[{"workspaceId": "ws1"}],
                               ttl_seconds=99999)
    with pytest.raises(PopulationError):
        context_expired({"expiresAt": "not-a-date"})
