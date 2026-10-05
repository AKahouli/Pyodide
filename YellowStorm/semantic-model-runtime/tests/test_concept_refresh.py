"""A concept refresh re-reads one concept and keeps the rest of the data in use."""

from app.workers.population_tasks import carry_over, compare_revisions, derivations_to_rerun


def _entity(entity_id, concept, attributes, derivation=None):
    provenance = {"sources": [{"assetRef": {"assetId": f"asset-{concept}"}}]}
    if derivation:
        provenance["derivedFrom"] = {"derivationId": derivation}
    return {"entityId": entity_id, "conceptId": concept, "namespace": concept, "label": entity_id,
            "identity": {"id": entity_id}, "attributes": dict(attributes), "provenance": provenance}


def _value(entity_id, attribute, value, derivation=None):
    evidence = {"assetRef": {"assetId": "a"}}
    if derivation:
        evidence["derivedFrom"] = {"derivationId": derivation}
    return {"entityId": entity_id, "attribute": attribute, "value": value, "origin": "source", "evidence": evidence}


DERIVATIONS = [{"derivationId": "d1", "sourceConceptId": "message", "conceptId": "person",
                "expand": {"relationId": "r_sent"}},
               {"derivationId": "d2", "sourceConceptId": "person", "conceptId": "domain"},
               {"derivationId": "d3", "sourceConceptId": "company", "conceptId": "sector"}]


def test_derivations_downstream_of_the_refreshed_concept_run_again():
    assert derivations_to_rerun(DERIVATIONS, {"message"}) == {"d1", "d2"}
    assert derivations_to_rerun(DERIVATIONS, {"company"}) == {"d3"}
    assert derivations_to_rerun(DERIVATIONS, {"other"}) == set()


def test_carry_over_keeps_what_the_run_does_not_make_again():
    carried = {
        "revisionId": "dr_old",
        "entities": [
            _entity("m1", "message", {"subject": "old"}),          # read again: dropped
            _entity("c1", "company", {"name": "Acme"}),            # other concept: kept
            _entity("p1", "person", {"email": "a@x"}, "d1"),       # rerun derivation: dropped
            _entity("p2", "person", {"email": "b@x", "phone": "1"}, "d1"),  # source + rerun: source part kept
            _entity("s1", "sector", {"name": "Retail"}, "d3"),     # derivation not rerun: kept
        ],
        "assertions": [
            _value("m1", "subject", "old"), _value("c1", "name", "Acme"),
            _value("p1", "email", "a@x", "d1"),
            _value("p2", "email", "b@x", "d1"), _value("p2", "phone", "1"),
            _value("s1", "name", "Retail", "d3"),
        ],
        "relationships": [
            {"relationId": "r_sent", "sourceEntityId": "m1", "targetEntityId": "p1", "matchingStrategy": "derived"},
            {"relationId": "r_sector", "sourceEntityId": "c1", "targetEntityId": "s1", "matchingStrategy": "derived"},
            {"relationId": "r_works", "sourceEntityId": "p2", "targetEntityId": "c1", "matchingStrategy": "normalized"},
            {"relationId": "r_typed", "sourceEntityId": "c1", "targetEntityId": "s1", "matchingStrategy": "manual"},
        ],
    }
    merged = {"message": {"entities": [_entity("m1", "message", {"subject": "new"})],
                          "assertions": [_value("m1", "subject", "new")], "gaps": [], "counts": {}}}
    links = carry_over(merged, carried, {"message"}, {"d1", "d2"}, DERIVATIONS, set())

    assert [entity["attributes"] for entity in merged["message"]["entities"]] == [{"subject": "new"}]
    assert [entity["entityId"] for entity in merged["company"]["entities"]] == ["c1"]
    person = merged["person"]["entities"]
    assert [entity["entityId"] for entity in person] == ["p2"]
    # The rerun derivation fills its field afresh; the value a source gave stays.
    assert person[0]["attributes"] == {"phone": "1"} and "derivedFrom" not in person[0]["provenance"]
    assert [assertion["attribute"] for assertion in merged["person"]["assertions"]] == ["phone"]
    assert [entity["entityId"] for entity in merged["sector"]["entities"]] == ["s1"]
    # Matched links are matched again by the run; derived links of rerun derivations are made again.
    assert {(link["relationId"], link["matchingStrategy"]) for link in links} == {
        ("r_sector", "derived"), ("r_typed", "manual")}


def test_typed_links_of_a_concept_typed_again_are_not_kept():
    carried = {"revisionId": "dr", "entities": [_entity("c1", "company", {}), _entity("s1", "sector", {})],
               "assertions": [],
               "relationships": [{"relationId": "r", "sourceEntityId": "c1", "targetEntityId": "s1",
                                  "matchingStrategy": "manual"}]}
    assert carry_over({}, carried, {"company"}, set(), [], {"company"}) == []


def test_changes_of_a_concept_refresh_do_not_report_kept_sources_as_removed():
    before = [_entity("c1", "company", {"name": "Acme"})]
    after = [_entity("c1", "company", {"name": "Acme"})]
    kept_assets = {"asset-company"}
    assert compare_revisions(before, after, kept_assets)["removedSources"] == []


def test_a_concept_made_from_another_is_made_again_from_the_kept_records():
    assert derivations_to_rerun(DERIVATIONS, {"person"}, "person") == {"d1", "d2"}
    assert derivations_to_rerun(DERIVATIONS, {"sector"}, "sector") == {"d3"}
