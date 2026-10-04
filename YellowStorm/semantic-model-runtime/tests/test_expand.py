from __future__ import annotations

import pytest

from app.population.derived import DerivationError, derivation_items, derive_concept, normalize_derivations, read_derived_fields
from app.population.expand import ExpandError, item_attributes, item_paths, normalize_expand, split_value
from tests.test_derived import compiled_concepts, contract, derivation, evidence


@pytest.mark.parametrize(("value", "expected"), [
    ('"Dupont, Jean" <j.dupont@x.fr>, ann@y.fr; Bob Martin <bob@z.io>',
     ["Dupont, Jean <j.dupont@x.fr>", "ann@y.fr", "Bob Martin <bob@z.io>"]),
    ("a@x.fr\nb@y.fr", ["a@x.fr", "b@y.fr"]),
    ("Sony; Acme ;; Globex", ["Sony", "Acme", "Globex"]),
    ("Sony\nAcme, Inc", ["Sony", "Acme, Inc"]),
    ('["a@x.fr", "b@y.fr"]', ["a@x.fr", "b@y.fr"]),
    ('[{"name": "Ann", "email": "ann@x.fr"}]', [{"name": "Ann", "email": "ann@x.fr"}]),
    (["a", " ", None, "b"], ["a", "b"]),
    (None, []),
])
def test_auto_finds_lists_addresses_lines_or_delimiters(value, expected):
    assert split_value(value, {"split": "auto"}) == expected


def test_a_path_reaches_the_array_inside_a_json_object_and_other_splits_follow_their_setting():
    payload = '{"meta": {"count": 2}, "to": [{"email": "a@x.fr"}, {"email": "b@y.fr"}]}'
    assert split_value(payload, {"split": "list", "path": "to[*]"}) == [{"email": "a@x.fr"}, {"email": "b@y.fr"}]
    assert split_value(payload, {"split": "list", "path": "missing"}) == []
    assert split_value("a|b / c", {"split": "delimiters", "delimiters": ["|", "/"]}) == ["a", "b", "c"]
    assert split_value("a, b\nc", {"split": "lines"}) == ["a, b", "c"]
    # Not an address list: the e-mail split falls back to separators.
    assert split_value("Ann; Bob", {"split": "emails"}) == ["Ann", "Bob"]


def test_an_object_item_offers_its_paths_and_a_text_item_offers_itself():
    assert item_attributes("ann@x.fr") == {"@item": "ann@x.fr"}
    attributes = item_attributes({"name": "Ann", "address": {"city": "Lyon"}, "tags": ["a"], "empty": None})
    assert attributes["@item.name"] == "Ann" and attributes["@item.address.city"] == "Lyon"
    assert attributes["@item.tags"] == '["a"]' and "@item.empty" not in attributes
    assert attributes["@item"].startswith("{")
    entities = [{"entityId": "m1", "attributes": {"to": '[{"name": "Ann", "email": "a@x.fr"}, {"email": "b@y.fr"}]'}}]
    assert item_paths(entities, {"field": "to", "split": "auto"}) == ["@item", "@item.email", "@item.name"]


def test_expand_settings_are_checked():
    assert normalize_expand({"field": "to"}, ["to"]) == {"field": "to", "split": "auto"}
    for bad in ({"field": "nope"}, {"field": "to", "split": "regex"}, {"field": "to", "split": "delimiters"},
                {"field": "to", "split": "lines", "path": "x"}, {"field": "to", "maxItems": 0}, "to"):
        with pytest.raises(ExpandError):
            normalize_expand(bad, ["to"])


def recipients_derivation(**overrides) -> dict:
    # Organizations named in a contract's comma-separated list of customer names.
    return derivation(**{"fieldMappings": [{"sourceAttribute": "@item", "targetAttribute": "org_id"},
                                           {"sourceAttribute": "@item", "targetAttribute": "name"}],
                         "expand": {"field": "customer_name", "split": "delimiters", "delimiters": [","]}, **overrides})


def test_item_fields_are_only_allowed_when_a_field_is_expanded():
    concepts = compiled_concepts()
    [normalized] = normalize_derivations([recipients_derivation()], concepts)
    assert normalized["expand"] == {"field": "customer_name", "split": "delimiters", "delimiters": [","]}
    with pytest.raises(DerivationError):
        normalize_derivations([derivation(fieldMappings=[{"sourceAttribute": "@item", "targetAttribute": "org_id"}])], concepts)
    with pytest.raises(DerivationError):
        normalize_derivations([recipients_derivation(expand={"field": "unknown"})], concepts)


def test_each_item_makes_a_record_merged_by_key_with_the_evidence_of_its_source_record():
    concepts = compiled_concepts()
    [normalized] = normalize_derivations([recipients_derivation()], concepts)
    entities = [contract("c1", "x", "Acme, Globex"), contract("c2", "y", "Acme")]
    items, gaps = derivation_items(normalized, entities)
    assert [item["entityId"] for item in items] == ["c1#1", "c1#2", "c2#1"] and gaps == []
    output = derive_concept(concepts["org"], normalized, items,
                            [evidence(entity["entityId"], "customer_name") for entity in entities])
    by_key = {entity["identity"]["org_id"]: entity for entity in output["entities"]}
    assert sorted(by_key) == ["acme", "globex"]
    assert by_key["acme"]["provenance"]["derivedFrom"] == {"derivationId": "d1", "conceptId": "contract", "count": 2, "entityIds": ["c1", "c2"]}
    [name] = [assertion for assertion in output["assertions"] if assertion["entityId"] == by_key["globex"]["entityId"]]
    assert name["evidence"]["quote"] == "quote c1"
    assert name["evidence"]["derivedFrom"]["entityId"] == "c1"
    assert name["evidence"]["derivedFrom"]["item"] == 2 and name["evidence"]["derivedFrom"]["expandedFrom"] == "customer_name"


def test_a_record_listing_too_many_items_reads_the_first_ones_and_says_so():
    concepts = compiled_concepts()
    [normalized] = normalize_derivations([recipients_derivation(
        expand={"field": "customer_name", "split": "delimiters", "delimiters": [","], "maxItems": 2})], concepts)
    items, gaps = derivation_items(normalized, [contract("c1", "x", "A, B, C")])
    assert len(items) == 2
    assert gaps[0]["kind"] == "expand_cap" and gaps[0]["derivationId"] == "d1" and gaps[0]["values"]["count"] == 3


@pytest.mark.asyncio
async def test_recipes_read_object_items_by_path():
    concepts = compiled_concepts()
    recipe = {"input": {"kind": "column", "name": "@item.email"}, "method": "whole", "transform": "lower"}
    [normalized] = normalize_derivations([derivation(
        fieldMappings=[{"sourceAttribute": None, "targetAttribute": "org_id", "mode": "computed", "computed": recipe},
                       {"sourceAttribute": "@item.name", "targetAttribute": "name"}],
        expand={"field": "customer_name", "split": "list"})], concepts)
    entities = [contract("c1", "x", '[{"name": "Ann", "email": "ANN@X.FR"}, {"name": "Bob", "email": "bob@y.fr"}]')]
    items, _gaps = derivation_items(normalized, entities)
    read = await read_derived_fields(normalized, items, {"conceptId": "org", "conceptLabel": "Org", "source": {}, "modelId": "m"})
    output = derive_concept(concepts["org"], normalized, items, [], read["readings"])
    assert sorted((entity["identity"]["org_id"], entity["attributes"].get("name")) for entity in output["entities"]) == [
        ("ann@x.fr", "Ann"), ("bob@y.fr", "Bob")]


def test_an_expanding_derivation_names_the_links_from_each_source_record_to_its_items_records():
    concepts = compiled_concepts()
    expand = {"field": "customer_name", "split": "delimiters", "delimiters": [","], "relationId": "r1"}
    [normalized] = normalize_derivations([recipients_derivation(expand=expand)], concepts)
    entities = [contract("c1", "x", "Acme, Globex"), contract("c2", "y", "Acme")]
    items, _gaps = derivation_items(normalized, entities)
    output = derive_concept(concepts["org"], normalized, items, [])
    keys = {entity["identity"]["org_id"]: entity["entityId"] for entity in output["entities"]}
    assert sorted((link["sourceEntityId"], link["targetEntityId"]) for link in output["links"]) == sorted([
        ("c1", keys["acme"]), ("c1", keys["globex"]), ("c2", keys["acme"])])
    # Without a relationship there is nothing to link.
    [plain] = normalize_derivations([recipients_derivation()], concepts)
    assert derive_concept(concepts["org"], plain, derivation_items(plain, entities)[0], [])["links"] == []
