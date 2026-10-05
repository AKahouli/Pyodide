"""A spreadsheet field's recipe: the same functions as a document's computed field, applied per row."""

from __future__ import annotations

import pytest

from app.population.computed_fields import (apply_row_recipes, compute, normalize_computed,
                                            normalize_row_recipes, recipe_columns)
from app.population.document_rules import RuleError
from app.workers.datasource_tasks import build_mapping_preview
from app.workers.population_tasks import (population_execution_fingerprint, run_population_for_payload,
                                          run_population_for_task)
from test_population_task import SOURCE, command, fake_fetch, fake_prepare, fake_query

UPPER = {"input": {"kind": "column", "name": "name"}, "method": "whole", "transform": "upper"}
# "C-1" → "1": the identity is computed from the shaped value.
NUMBER = {"input": {"kind": "column", "name": "customer_id"}, "method": "split", "delimiter": "-", "part": 2}


def sheet_source(recipes: dict | None = None) -> dict:
    source = {"conceptId": "c1", "source": dict(SOURCE), "options": {},
              "columnMapping": {"customer_id": "customer_id", "name": "name"}, "mappingVersion": "map-v1"}
    return {**source, "fieldRecipes": recipes} if recipes is not None else source


def test_a_whole_value_is_only_shaped_and_each_step_is_traced() -> None:
    spec = normalize_computed({**UPPER, "take": {"from": "start", "count": 3, "unit": "characters"},
                               "valuePattern": r"[A-Za-z]+"})
    assert spec["input"] == {"kind": "column", "name": "name"} and spec["stripExtension"] is False
    steps: list[dict] = []
    assert compute(spec, "Acme Corp", steps) == ("ACM", "found")
    assert [step["step"] for step in steps] == ["keep", "pattern", "transform"]
    assert steps[0]["value"] == "Acm"


def test_a_cut_that_finds_nothing_stops_at_the_cut() -> None:
    steps: list[dict] = []
    spec = normalize_computed({"input": {"kind": "column", "name": "ref"}, "method": "between", "after": "FY"})
    assert compute(spec, "report_2023", steps) == (None, "no_match")
    assert steps == [{"step": "cut", "value": None}]


def test_column_names_keep_their_spaces() -> None:
    spec = normalize_computed({"input": {"kind": "column", "name": " Date d'envoi "}, "method": "whole"})
    assert spec["input"]["name"] == " Date d'envoi "


@pytest.mark.parametrize("raw", [
    {"name": {"input": {"kind": "file", "name": "document_name"}, "method": "whole"}},
    {"name": {"input": {"kind": "field", "name": "name"}, "method": "whole"}},
    {"name": {"input": {"kind": "field", "name": "customer_id"}, "method": "whole"},
     "customer_id": {"input": {"kind": "field", "name": "name"}, "method": "whole"}},
    {"unmapped": UPPER},
    {"name": {"input": {"kind": "column", "name": "x"}, "method": "split"}},
])
def test_unusable_row_recipes_are_refused(raw) -> None:  # type: ignore[no-untyped-def]
    with pytest.raises(RuleError):
        normalize_row_recipes(raw, {"customer_id", "name"})


def test_recipes_on_columns_run_before_those_on_fields() -> None:
    recipes = normalize_row_recipes({
        "name": {"input": {"kind": "field", "name": "customer_id"}, "method": "whole", "transform": "lower"},
        "customer_id": {**NUMBER, "transform": "none"},
    }, {"customer_id", "name"})
    assert recipe_columns(recipes) == {"customer_id"}
    values = {"customer_id": "C-7", "name": "Acme"}
    outcomes = apply_row_recipes(recipes, values, {"customer_id": "C-7", "name": "Acme"})
    assert values == {"customer_id": "7", "name": "7"}
    assert outcomes["customer_id"]["reason"] == "found"


def test_a_recipe_that_finds_nothing_leaves_the_field_empty() -> None:
    recipes = normalize_row_recipes({"name": {"input": {"kind": "column", "name": "name"}, "method": "between",
                                              "after": "<", "before": ">"}}, {"name"})
    values = {"name": "Acme"}
    assert apply_row_recipes(recipes, values, {"name": "Acme"})["name"]["reason"] == "no_match"
    assert values == {"name": None}


def test_a_recipe_on_a_document_column_is_refused() -> None:
    from app.population.computed_fields import check_inputs
    with pytest.raises(RuleError):
        check_inputs([{"targetAttribute": "x", "mode": "computed",
                       "computed": normalize_computed({"input": {"kind": "column", "name": "c"}, "method": "whole"})}])


def test_old_sheet_mappings_compile_and_fingerprint_as_before() -> None:
    validated = run_population_for_payload(command())
    assert validated["ok"] is True
    assert "fieldRecipes" not in validated["sources"][0]
    source = {**sheet_source(), "sourceKind": "tabular"}
    plain = population_execution_fingerprint("h", [source], [])
    assert population_execution_fingerprint("h", [{**source, "fieldRecipes": None}], []) == plain
    assert population_execution_fingerprint("h", [{**source, "fieldRecipes": {"name": UPPER}}], []) != plain


def test_a_bad_recipe_fails_the_run_before_any_reading() -> None:
    validated = run_population_for_payload(command(sources=[sheet_source({"name": {**UPPER, "method": "nope"}})]))
    assert validated == {"ok": False, "errorCode": "invalid_column_mapping"}


@pytest.mark.asyncio
async def test_old_sheet_mappings_read_rows_unchanged() -> None:
    outcome = await run_population_for_task(command(), fetch=fake_fetch, prepare=fake_prepare, query=fake_query)
    assert {a["value"] for a in outcome["assertions"]} == {"Acme", "Globex"}
    assert {entity["identity"]["customer_id"] for entity in outcome["entities"]} == {"c-1", "c-2"}


@pytest.mark.asyncio
async def test_sheet_recipes_shape_values_and_the_identity_key() -> None:
    outcome = await run_population_for_task(
        command(sources=[sheet_source({"name": UPPER, "customer_id": NUMBER})]),
        fetch=fake_fetch, prepare=fake_prepare, query=fake_query)
    assert outcome["ok"] is True
    assert {a["value"] for a in outcome["assertions"]} == {"ACME", "GLOBEX"}
    # The identity is the transformed value: "C-1" split on "-", 2nd part.
    assert {entity["identity"]["customer_id"] for entity in outcome["entities"]} == {"1", "2"}


@pytest.mark.asyncio
async def test_a_recipe_reads_a_column_that_is_not_mapped() -> None:
    asked: list[list[str]] = []

    def prepare(source, options, data, output):  # type: ignore[no-untyped-def]
        output.write_bytes(b"parquet-bytes")
        return {"datasetId": "ds_0123456789abcdef01234567", "rowCount": 1,
                "columns": ["__sheetRow", "customer_id", "name", "ref"]}

    def query(path, *, columns=None, filters=None, limit=100, offset=0):  # type: ignore[no-untyped-def]
        asked.append(list(columns or []))
        rows = [{"__sheetRow": 2, "customer_id": "C-1", "name": "Acme", "ref": "FY2023_x"}][offset:]
        return {"columns": columns, "rows": rows, "returnedRows": len(rows), "limit": limit, "offset": offset}

    recipe = {"input": {"kind": "column", "name": "ref"}, "method": "between", "after": "FY", "before": "_"}
    outcome = await run_population_for_task(command(sources=[sheet_source({"name": recipe})]),
                                            fetch=fake_fetch, prepare=prepare, query=query)
    assert "ref" in asked[0]
    assert {a["value"] for a in outcome["assertions"]} == {"2023"}


def test_the_mapping_preview_applies_the_recipes() -> None:
    profile = {"samples": [{"__sheetRow": 2, "customer_id": "C-1", "name": "Acme"}], "fieldProfiles": []}
    preview = build_mapping_preview(profile, {
        "fieldMappings": [
            {"sourceField": "customer_id", "targetAttribute": "customer_id", "mode": "direct", "computed": NUMBER},
            {"sourceField": "name", "targetAttribute": "name", "mode": "direct", "computed": UPPER},
        ], "identityFields": ["customer_id"]})
    assert preview is not None
    assert preview["entities"][0]["values"] == {"customer_id": "1", "name": "ACME"}


def test_the_mapping_preview_skips_a_row_whose_identity_recipe_finds_nothing() -> None:
    profile = {"samples": [{"__sheetRow": 2, "customer_id": "C1", "name": "Acme"}], "fieldProfiles": []}
    recipe = {"input": {"kind": "column", "name": "customer_id"}, "method": "between", "after": "-"}
    preview = build_mapping_preview(profile, {
        "fieldMappings": [{"sourceField": "customer_id", "targetAttribute": "customer_id", "mode": "direct",
                           "computed": recipe}], "identityFields": ["customer_id"]})
    assert preview is not None and preview["entities"] == []
    assert preview["stats"]["nullIdentitySkipped"] == 1


@pytest.mark.asyncio
async def test_the_preview_route_traces_steps_and_shapes_the_input_first() -> None:
    from app.api.population_routes import preview_computed_field

    result = await preview_computed_field({
        "computed": {"input": {"kind": "field", "name": "customer_id"}, "method": "whole", "transform": "number"},
        "inputRecipe": NUMBER, "samples": ["C-12", "", "X"]})
    first, empty, missing = result["results"]
    assert (first["value"], first["reason"]) == ("12", "found")
    assert first["steps"] == [{"step": "transform", "value": "12"}]
    assert empty["reason"] == "no_input"
    assert missing["reason"] == "no_input"


def test_an_admitted_source_without_recipes_keeps_its_stored_shape() -> None:
    from app.jobs.models import PopulationSource

    plain = PopulationSource.model_validate(sheet_source()).model_dump(by_alias=True, mode="json")
    assert "fieldRecipes" not in plain
    shaped = PopulationSource.model_validate(sheet_source({"name": UPPER})).model_dump(by_alias=True, mode="json")
    assert shaped["fieldRecipes"] == {"name": UPPER}
    with pytest.raises(ValueError):
        PopulationSource.model_validate({"conceptId": "c1", "source": dict(SOURCE), "sourceKind": "document",
                                         "fieldMappings": [{"mode": "extract"}], "fieldRecipes": {}})


def test_shape_sheet_rows_applies_recipes_and_says_what_they_read():
    from app.workers.datasource_tasks import shape_sheet_rows

    shaped = shape_sheet_rows([
        {"sourceField": "First", "targetAttribute": "first", "mode": "direct"},
        {"sourceField": "Last", "targetAttribute": "last", "mode": "direct"},
        {"targetAttribute": "full", "mode": "computed", "computed": {
            "input": {"kind": "join", "parts": [{"kind": "column", "name": "First"}, {"kind": "column", "name": "Last"}],
                      "separator": " "}, "method": "whole"}},
    ], [{"__sheetRow": 2, "First": "Ada", "Last": "Lovelace"}])
    row = shaped["rows"][0]
    assert row["rowNumber"] == 2
    assert row["values"]["full"] == "Ada Lovelace"
    assert row["fields"]["full"]["sources"] == ["First", "Last"]
    assert row["fields"]["first"] == {"method": "direct_mapping", "reference": "First"}
