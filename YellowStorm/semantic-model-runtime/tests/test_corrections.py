from __future__ import annotations

import pytest

from app.population.corrections import apply_corrections, corrections_in_force


def outcome() -> dict:
    return {
        "entities": [
            {"entityId": "e1", "conceptId": "c1", "attributes": {"name": "Acme", "city": "Lyon"}},
            {"entityId": "e2", "conceptId": "c1", "attributes": {"name": "Beta"}},
            {"entityId": "e3", "conceptId": "c2", "attributes": {"no": "A-1"}},
        ],
        "assertions": [
            {"entityId": "e1", "attribute": "city", "value": "Lyon", "origin": "source",
             "evidence": {"rowNumber": 2}},
            {"entityId": "e2", "attribute": "name", "value": "Beta", "origin": "source",
             "evidence": {}},
        ],
        "relationships": [
            {"relationId": "r1", "sourceEntityId": "e3", "targetEntityId": "e1",
             "matchingStrategy": "exact"},
            {"relationId": "r1", "sourceEntityId": "e3", "targetEntityId": "e2",
             "matchingStrategy": "exact"},
        ],
    }


def c(sequence: int, action: str, target: dict, payload: dict | None = None) -> dict:
    return {"sequence": sequence, "action": action, "targetIdentity": target,
            "payload": payload or {}, "actorUserId": "u1", "reason": ""}


def test_no_corrections_returns_outcome_unchanged():
    original = outcome()
    assert apply_corrections(original, []) is original


def test_edit_overrides_source_value_with_human_assertion():
    result = apply_corrections(outcome(), [
        c(1, "edit_entity", {"entityId": "e1"}, {"attribute": "city", "value": "Paris"})])
    entity = next(e for e in result["entities"] if e["entityId"] == "e1")
    assert entity["attributes"]["city"] == "Paris"
    assertion = next(a for a in result["assertions"]
                     if a["entityId"] == "e1" and a["attribute"] == "city")
    assert assertion["origin"] == "human"
    assert assertion["evidence"]["correction"]["originalValue"] == "Lyon"
    assert assertion["evidence"]["correction"]["actorUserId"] == "u1"
    assert assertion["evidence"]["rowNumber"] == 2


def test_second_edit_keeps_the_first_original_value():
    result = apply_corrections(outcome(), [
        c(1, "edit_entity", {"entityId": "e1"}, {"attribute": "city", "value": "Paris"}),
        c(2, "edit_entity", {"entityId": "e1"}, {"attribute": "city", "value": "Nice"})])
    assertion = next(a for a in result["assertions"]
                     if a["entityId"] == "e1" and a["attribute"] == "city")
    assert assertion["value"] == "Nice"
    assert assertion["evidence"]["correction"]["originalValue"] == "Lyon"


def test_remove_entity_hides_values_and_links():
    result = apply_corrections(outcome(), [c(1, "remove_entity", {"entityId": "e2"})])
    assert [e["entityId"] for e in result["entities"]] == ["e1", "e3"]
    assert all(a["entityId"] != "e2" for a in result["assertions"])
    assert [r["targetEntityId"] for r in result["relationships"]] == ["e1"]


def test_add_and_remove_links():
    link = {"relationId": "r1", "sourceEntityId": "e3", "targetEntityId": "e1"}
    missing = {"relationId": "r2", "sourceEntityId": "e1", "targetEntityId": "e2"}
    unknown = {"relationId": "r2", "sourceEntityId": "e1", "targetEntityId": "nope"}
    result = apply_corrections(outcome(), [
        c(1, "remove_relationship", link), c(2, "add_relationship", missing),
        c(3, "add_relationship", unknown)])
    keys = {(r["relationId"], r["sourceEntityId"], r["targetEntityId"])
            for r in result["relationships"]}
    assert keys == {("r1", "e3", "e2"), ("r2", "e1", "e2")}
    added = next(r for r in result["relationships"] if r["relationId"] == "r2")
    assert added["matchingStrategy"] == "human"
    assert result["appliedCorrections"] == 2


def test_revert_undoes_a_correction():
    corrections = [c(1, "remove_entity", {"entityId": "e2"}),
                   c(2, "revert", {"entityId": "e2"}, {"sequence": 1})]
    assert corrections_in_force(corrections) == []
    result = apply_corrections(outcome(), corrections)
    assert len(result["entities"]) == 3


@pytest.mark.asyncio
async def test_persist_applies_corrections_and_records_watermark():
    from test_population_task import command, run_population_for_payload
    from app.population.compiler import canonical_spec_hash
    from app.persistence.population_store import revision_id_for
    from app.workers.population_tasks import persist_population_revision
    from test_population_compiler import base_spec

    stored: dict = {}

    class FakePool:
        async def fetchval(self, sql, *params):  # type: ignore[no-untyped-def]
            return 0 if "model_data_resets" in sql else 4

        async def fetch(self, sql, *params):  # type: ignore[no-untyped-def]
            return [{"sequence": 4, "model_version_id": "v1", "actor_user_id": "u9",
                     "reason": "", "target_identity": {"entityId": "e2"},
                     "action": "remove_entity", "payload": {}, "created_at": None}]

        async def fetchrow(self, sql, *params):  # type: ignore[no-untyped-def]
            if "INSERT INTO semantic_population.data_revisions" in sql:
                stored["correction_sequence"] = params[6]
            return {"id": "row-1", "sequence": 1}

        async def executemany(self, sql, rows):  # type: ignore[no-untyped-def]
            if "semantic_population.entities" in sql:
                stored["entities"] = [row[0] for row in rows]

    base = outcome()
    base.update({"specHash": canonical_spec_hash(base_spec()), "gaps": [], "counts": {},
                 "executionFingerprint":
                     run_population_for_payload(command())["executionFingerprint"],
                 "datasetFingerprints": []})
    revision = await persist_population_revision(FakePool(), command(), base)
    assert revision == revision_id_for("v1", base["executionFingerprint"], [], 4)
    assert stored["correction_sequence"] == 4
    assert stored["entities"] == ["e1", "e3"]
