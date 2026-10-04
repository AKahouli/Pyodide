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


# --- A sheet expanding a column: one record per item of a row -------------------------------------------

def _sheet_command(expand, mapping=None, extractions=None):  # type: ignore[no-untyped-def]
    from tests.test_population_task import SOURCE, command

    source = {"conceptId": "c1", "source": dict(SOURCE), "options": {"expand": expand} if expand else {},
              "columnMapping": mapping or {"@item": "customer_id", "name": "name"}, "mappingVersion": "map-v1"}
    if extractions:
        source["fieldExtractions"] = extractions
    return command(sources=[source])


def _recipients_prepare(source, options, data, output):  # type: ignore[no-untyped-def]
    output.write_bytes(b"parquet-bytes")
    return {"datasetId": "ds_0123456789abcdef01234567", "rowCount": 2, "columns": ["__sheetRow", "to", "name"]}


def _recipients_query(asked):  # type: ignore[no-untyped-def]
    def query(path, *, columns=None, filters=None, limit=100, offset=0):  # type: ignore[no-untyped-def]
        asked.append(list(columns or []))
        rows = [{"__sheetRow": 2, "to": '"Dupont, Jean" <a@x.fr>; b@y.fr', "name": "Acme"},
                {"__sheetRow": 3, "to": '["b@y.fr", "c@z.fr"]', "name": "Acme"},
                {"__sheetRow": 4, "to": "", "name": "Empty"}][offset:]
        return {"columns": columns, "rows": rows, "returnedRows": len(rows), "limit": limit, "offset": offset}
    return query


def test_expand_rows_keeps_the_row_and_numbers_its_items():
    from app.population.expand import expand_rows

    rows, gaps = expand_rows([{"__sheetRow": 2, "to": "a; b; c", "n": 1}], {"field": "to", "split": "delimiters",
                             "delimiters": [";"], "maxItems": 2}, lambda row: row["to"], lambda row: row["__sheetRow"])
    assert rows == [{"__sheetRow": 2, "to": "a; b; c", "n": 1, "@item": "a", "_item": 1},
                    {"__sheetRow": 2, "to": "a; b; c", "n": 1, "@item": "b", "_item": 2}]
    assert gaps[0]["kind"] == "expand_cap" and gaps[0]["rowNumber"] == 2


@pytest.mark.asyncio
async def test_a_sheet_expanding_a_column_makes_one_record_per_item():
    from app.workers.population_tasks import run_population_for_task
    from tests.test_population_task import fake_fetch

    asked: list[list[str]] = []
    outcome = await run_population_for_task(_sheet_command({"field": "to", "split": "auto"}),
                                            fetch=fake_fetch, prepare=_recipients_prepare, query=_recipients_query(asked))
    assert outcome["ok"] is True, outcome
    # The item is not a column: the expanded column is read instead.
    assert "@item" not in asked[0] and "to" in asked[0]
    # An address list and a JSON array alike; b@y.fr on two rows is one record; the empty row makes none.
    assert sorted(entity["identity"]["customer_id"] for entity in outcome["entities"]) == [
        "b@y.fr", "c@z.fr", "dupont, jean <a@x.fr>"]
    merged = next(entity for entity in outcome["entities"] if entity["identity"]["customer_id"] == "b@y.fr")
    assert merged["provenance"]["sources"][0]["rowNumbers"] == [2, 3]
    name = next(a for a in outcome["assertions"] if a["entityId"] == merged["entityId"] and a["attribute"] == "name")
    assert name["evidence"]["rowNumber"] == 2 and name["evidence"]["item"] == 2


@pytest.mark.asyncio
async def test_a_value_read_out_of_an_item_points_at_the_expanded_cell():
    from app.workers.population_tasks import run_population_for_task
    from tests.test_population_task import fake_fetch

    extractions = {"name": {"column": "@item", "extractionStrategy": "deterministic",
                            "rules": {"location": "anywhere", "pattern": r"[\w.]+@[\w.]+"}}}
    outcome = await run_population_for_task(
        _sheet_command({"field": "to", "split": "emails"}, mapping={"@item": "customer_id"}, extractions=extractions),
        fetch=fake_fetch, prepare=_recipients_prepare, query=_recipients_query([]))
    assert outcome["ok"] is True, outcome
    found = [a for a in outcome["assertions"] if a["attribute"] == "name"]
    assert {a["value"] for a in found} >= {"a@x.fr", "c@z.fr"}
    evidence = next(a["evidence"] for a in found if a["value"] == "c@z.fr")
    assert evidence["column"] == "to" and evidence["itemField"] == "@item" and evidence["item"] == 2
    assert evidence["rowNumber"] == 3 and "span" not in evidence


def test_a_sheet_reading_an_item_without_expanding_is_refused():
    from app.workers.population_tasks import run_population_for_payload

    assert run_population_for_payload(_sheet_command(None)) == {"ok": False, "errorCode": "invalid_column_mapping"}
    assert run_population_for_payload(_sheet_command({"field": "to", "split": "nope"}))["errorCode"] == "invalid_column_mapping"
    # Links back are a derived source's: a sheet row is not a record to link from.
    assert run_population_for_payload(_sheet_command({"field": "to", "relationId": "r1"}))["errorCode"] == "invalid_column_mapping"


@pytest.mark.asyncio
async def test_a_missing_expanded_column_fails_the_source():
    from app.workers.population_tasks import run_population_for_task
    from tests.test_population_task import fake_fetch

    outcome = await run_population_for_task(_sheet_command({"field": "cc", "split": "auto"}),
                                            fetch=fake_fetch, prepare=_recipients_prepare, query=_recipients_query([]))
    assert outcome["ok"] is False and outcome["errorCode"] == "expand_column_missing"


@pytest.mark.asyncio
async def test_the_data_preview_shows_one_row_per_item():
    from app.api.population_routes import shape_sheet_rows_route

    shaped = await shape_sheet_rows_route({
        "rows": [{"__sheetRow": 2, "to": "a@x.fr, b@y.fr"}],
        "fieldMappings": [{"sourceField": "@item", "targetAttribute": "address", "mode": "direct"}],
        "expand": {"field": "to", "split": "auto"}})
    assert shaped["itemsTruncated"] is False
    rows = shaped["rows"]
    assert [(row["rowNumber"], row["item"], row["values"]["address"]) for row in rows] == [(2, 1, "a@x.fr"), (2, 2, "b@y.fr")]


def test_the_mapping_preview_finds_one_record_per_item():
    from app.workers.datasource_tasks import build_mapping_preview

    preview = build_mapping_preview({"samples": [{"__sheetRow": 2, "to": "a@x.fr; b@y.fr"}, {"__sheetRow": 3, "to": "b@y.fr"}],
                                     "fieldProfiles": []}, {
        "fieldMappings": [{"sourceField": "@item", "targetAttribute": "address", "mode": "direct"}],
        "identityFields": ["address"], "expand": {"field": "to", "split": "auto"}})
    assert [entity["values"]["address"] for entity in preview["entities"]] == ["a@x.fr", "b@y.fr"]
    assert preview["entities"][1]["provenance"] == {"rowNumber": 2, "item": 2, "fields": {
        "address": {"method": "direct_mapping", "reference": "@item"}}}
    assert preview["stats"]["duplicateKeysSkipped"] == 1
