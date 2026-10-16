"""One value is served per field of a record; the other sources' values are kept beside it."""

from __future__ import annotations

from app.persistence.population_store import MAX_CANDIDATES_PER_FIELD, split_assertions
from app.population.corrections import apply_corrections


def stated(value: str, asset: str, block: int = 1, entity: str = "e1", attribute: str = "date") -> dict:
    return {"entityId": entity, "attribute": attribute, "value": value, "origin": "source",
            "evidence": {"assetRef": {"assetId": asset}, "blockPk": block}}


def test_the_first_value_is_served_and_the_other_sources_are_kept() -> None:
    first, second = stated("2026-01-01", "a1"), stated("2026-02-02", "a2")
    served, others = split_assertions([first, second, stated("2026-01-01", "a1"), stated("2026-01-01", "a3"),
                                       stated("x", "a1", entity="e2")])
    assert [(a["entityId"], a["value"]) for a in served] == [("e1", "2026-01-01"), ("e2", "x")]
    # The same value read from the same place twice is one support; the same value from another file counts.
    assert [(a["value"], a["evidence"]["assetRef"]["assetId"]) for a in others] == [
        ("2026-02-02", "a2"), ("2026-01-01", "a3")]


def test_candidates_per_field_are_bounded() -> None:
    many = [stated(f"v{n}", f"a{n}") for n in range(MAX_CANDIDATES_PER_FIELD + 10)]
    served, others = split_assertions(many)
    assert len(served) == 1 and len(others) == MAX_CANDIDATES_PER_FIELD


def test_a_correction_edits_the_served_value_and_keeps_the_others() -> None:
    outcome = {"entities": [{"entityId": "e1", "attributes": {"date": "2026-01-01"}}],
               "assertions": [stated("2026-01-01", "a1"), stated("2026-02-02", "a2")], "relationships": []}
    corrected = apply_corrections(outcome, [{
        "sequence": 1, "action": "edit_entity", "targetIdentity": {"entityId": "e1"},
        "payload": {"attributes": {"date": "2026-03-03"}}, "reason": "checked", "actorUserId": "u"}])
    served, others = split_assertions(corrected["assertions"])
    assert [(a["value"], a["origin"]) for a in served] == [("2026-03-03", "human")]
    assert [a["value"] for a in others] == ["2026-02-02"]
    removed = apply_corrections(outcome, [{
        "sequence": 2, "action": "remove_entity", "targetIdentity": {"entityId": "e1"}, "payload": {}}])
    assert removed["assertions"] == []
