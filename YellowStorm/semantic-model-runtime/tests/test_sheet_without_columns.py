"""A sheet source whose fields come from fixed values, cell readings or recipes alone (no column mapping)."""

from __future__ import annotations

import pytest

from app.jobs.models import PopulationCommand
from app.population.model_check import check_model
from app.workers.population_tasks import run_population_for_payload, run_population_for_task
from test_population_task import SOURCE, command, fake_fetch, fake_prepare

NOTES = "Pays: France\nRef: C-9"
CONSTANTS = {"customer_id": "C-0", "name": "Fixed"}
RECIPES = {"customer_id": {"input": {"kind": "column", "name": "ref"}, "method": "whole"},
           "name": {"input": {"kind": "column", "name": "label"}, "method": "whole", "transform": "upper"}}
READINGS = {"customer_id": {"column": "notes", "label": "Ref", "rules": {"labels": ["Ref"]}},
            "name": {"column": "notes", "label": "Pays", "rules": {"labels": ["Pays"]}}}


def sheet(**fields) -> dict:  # type: ignore[no-untyped-def]
    return {"conceptId": "c1", "source": dict(SOURCE), "options": {}, "mappingVersion": "map-v1", **fields}


def query(path, *, columns=None, filters=None, limit=100, offset=0):  # type: ignore[no-untyped-def]
    rows = [{"__sheetRow": 2, "ref": "C-1", "label": "acme", "notes": NOTES},
            {"__sheetRow": 3, "ref": "C-2", "label": "globex", "notes": NOTES}]
    rows = [{key: value for key, value in row.items() if key in (columns or [])} for row in rows][offset:]
    return {"columns": columns, "rows": rows, "returnedRows": len(rows), "limit": limit, "offset": offset}


READING_SHEETS = {
    "fixed values": sheet(columnMapping={}, constantMapping=CONSTANTS),
    "fixed values without a column mapping": sheet(constantMapping=CONSTANTS),
    "recipes": sheet(columnMapping={}, fieldRecipes=RECIPES),
    "cell readings": sheet(columnMapping={}, fieldExtractions=READINGS),
}


@pytest.mark.parametrize("name", list(READING_SHEETS))
def test_an_empty_column_mapping_is_accepted_when_another_way_fills_a_field(name: str) -> None:
    outcome = run_population_for_payload(command(sources=[READING_SHEETS[name]]))
    assert outcome["ok"] is True, outcome
    assert outcome["sources"][0]["columnMapping"] == {}


@pytest.mark.parametrize("fields", [{"columnMapping": {}}, {}, {"columnMapping": {}, "constantMapping": {}}])
def test_a_sheet_that_reads_nothing_is_still_refused(fields: dict) -> None:
    assert run_population_for_payload(command(sources=[sheet(**fields)])) == {
        "ok": False, "errorCode": "invalid_column_mapping"}


def test_a_column_mapping_that_is_not_a_mapping_is_still_refused() -> None:
    outcome = run_population_for_payload(command(sources=[sheet(columnMapping=["customer_id"], constantMapping=CONSTANTS)]))
    assert outcome == {"ok": False, "errorCode": "invalid_column_mapping"}


@pytest.mark.asyncio
async def test_fixed_values_alone_make_one_record_from_every_row() -> None:
    outcome = await run_population_for_task(command(sources=[READING_SHEETS["fixed values"]]),
                                            fetch=fake_fetch, prepare=fake_prepare, query=query)
    assert outcome["ok"] is True
    assert [entity["identity"]["customer_id"] for entity in outcome["entities"]] == ["c-0"]
    assert {a["value"] for a in outcome["assertions"]} == {"Fixed"}


@pytest.mark.asyncio
async def test_recipes_alone_read_the_columns_they_name() -> None:
    asked: list[list[str]] = []

    def asking(path, **kwargs):  # type: ignore[no-untyped-def]
        asked.append(list(kwargs.get("columns") or []))
        return query(path, **kwargs)

    outcome = await run_population_for_task(command(sources=[READING_SHEETS["recipes"]]),
                                            fetch=fake_fetch, prepare=fake_prepare, query=asking)
    assert outcome["ok"] is True
    assert set(asked[0]) == {"__sheetRow", "ref", "label"}
    assert {entity["identity"]["customer_id"] for entity in outcome["entities"]} == {"c-1", "c-2"}
    assert {a["value"] for a in outcome["assertions"]} == {"ACME", "GLOBEX"}


@pytest.mark.asyncio
async def test_cell_readings_alone_read_records() -> None:
    outcome = await run_population_for_task(command(sources=[READING_SHEETS["cell readings"]]),
                                            fetch=fake_fetch, prepare=fake_prepare, query=query)
    assert outcome["ok"] is True
    assert {entity["identity"]["customer_id"] for entity in outcome["entities"]} == {"c-9"}
    assert {a["value"] for a in outcome["assertions"]} == {"France"}


def test_the_model_check_agrees_with_a_run_on_these_sheets() -> None:
    from test_model_check import as_run, errors, plan
    for name, source in READING_SHEETS.items():
        request = plan([{**source, "mappingId": "map-1"}])
        assert check_model(request) == {"issues": [], "errorCount": 0, "warningCount": 0}, name
        assert run_population_for_payload(as_run(request))["ok"] is True, name
    nothing = plan([{**sheet(columnMapping={}), "mappingId": "map-1"}])
    assert errors(check_model(nothing))[0]["code"] == "invalid_column_mapping"
    assert errors(check_model(nothing))[0]["reason"] == "no_fields"
    assert run_population_for_payload(as_run(nothing))["errorCode"] == "invalid_column_mapping"


def test_admission_accepts_an_empty_column_mapping_with_fixed_values() -> None:
    admitted = PopulationCommand.model_validate(command(sources=[READING_SHEETS["fixed values"]]))
    assert admitted.payload.sources[0].column_mapping == {}
