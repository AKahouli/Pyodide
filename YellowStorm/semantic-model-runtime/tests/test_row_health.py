"""How a concept's rows became records: the row journey and what a person can fix about it."""

from __future__ import annotations

import pytest

from app.population.derived import derive_concept
from app.population.row_health import ConceptHealth, suggest_key
from app.population.tabular import populate_concept_rows
from app.workers.population_tasks import build_health_report, coarse_key_gaps, run_population_for_task, summarize_gaps
from test_population_compiler import base_spec
from test_population_task import command, fake_fetch

ROLES = ["destinataire", "expediteur", "copie"]


def _participants(count: int) -> list[dict]:
    """Every message has several recipients: the role alone cannot tell a participation apart."""
    return [{"_row": index + 2, "cle_message": f"msg_{index // 4}", "adresse": f"p{index}@x.fr",
             "nom_affiche": f"Person {index}", "role": ROLES[index % 3]} for index in range(count)]


def _concept(keys: list[str], fields: list[str]) -> dict:
    return {"conceptId": "p", "namespace": "mail", "keyComponents": keys, "allowedFields": fields,
            "populationMode": "materialized"}


def _health(rows: list[dict], keys: list[str], fields: list[str]) -> tuple[ConceptHealth, dict]:
    concept = _concept(keys, fields)
    health = ConceptHealth("p", keys, [name for name in fields if name not in keys])
    health.begin_source("mail.zip", sheet="participants", workspace_id="ws-1", rows_available=len(rows))
    health.rows_read(len(rows))
    output = populate_concept_rows(concept, rows, {"assetRef": {"workspaceId": "ws-1"}}, observer=health)
    return health, output


def test_a_key_too_coarse_is_found_with_the_fields_that_would_fix_it():
    health, output = _health(_participants(400), ["role"], ["cle_message", "adresse", "nom_affiche", "role"])
    report = health.report(records=len(output["entities"]))
    coarse = next(item for item in report["findings"] if item["kind"] == "identity_too_coarse")
    assert (coarse["rows"], coarse["entities"], coarse["keyFields"]) == (400, 3, ["role"])
    assert coarse["keyCardinality"] == {"role": 3}
    assert [top["rows"] for top in coarse["topKeyValues"]] == [134, 133, 133]
    assert coarse["suggestedKey"]["fields"][0] == "role" and "adresse" in coarse["suggestedKey"]["fields"]
    assert coarse["suggestedKey"]["estimatedRecords"] == 400
    # Where the rows came from, never "a source file / record".
    example = coarse["examples"][0]
    assert (example["source"], example["sheet"], example["row"]) == ("mail.zip", "participants", 2)
    assert example["values"]["role"] == "destinataire"
    # The journey: 400 rows read, 400 made a key, 3 records, 397 rows merged.
    assert (report["rowsAvailable"], report["rowsRead"], report["rowsKeyed"], report["recordsMade"]) == (400, 400, 400, 3)
    assert {"reason": "same_key", "rows": 397} in report["dropped"]
    assert report["workspaceIds"] == ["ws-1"]


def test_conflicting_values_are_counted_per_field_with_their_distinct_values():
    health, _ = _health(_participants(40), ["role"], ["adresse", "role"])
    (conflict,) = [item for item in health.report(records=3)["findings"] if item["kind"] == "conflicting_values"]
    assert conflict["field"] == "adresse" and conflict["rows"] == 37 and conflict["distinctValues"] >= 5
    assert len(conflict["examples"]) == 5 and conflict["examples"][0]["row"] is not None


def test_a_fine_key_is_not_reported():
    health, output = _health(_participants(100), ["adresse"], ["adresse", "role"])
    report = health.report(records=len(output["entities"]))
    assert [item["kind"] for item in report["findings"]] == []
    assert report["dropped"] == []


def test_a_row_the_ai_never_read_is_a_limit_not_a_missing_value():
    rows = [{"_row": 2, "description": "paid", "k": "a"},
            {"_row": 3, "description": None, "k": "b", "_ai_limited": ["description"]},
            {"_row": 4, "description": None, "k": "c"}]
    health, output = _health(rows, ["description"], ["description", "k"])
    kinds = [gap["kind"] for gap in output["gaps"]]
    assert kinds == ["missing_identity"] and output["gaps"][0]["rowNumber"] == 4
    report = health.report(records=1)
    assert {"reason": "ai_limit", "rows": 1} in report["dropped"]
    (missing,) = [item for item in report["findings"] if item["kind"] == "missing_identity"]
    assert missing["rows"] == 1 and missing["examples"][0]["row"] == 4


def test_the_ai_limit_is_a_finding_of_its_own():
    health, _ = _health(_participants(3), ["adresse"], ["adresse"])
    health.set_ai(500, {"aiRows": 500, "aiSkippedRows": 24500, "aiFailedRows": 0})
    (limit,) = [item for item in health.report(records=3)["findings"] if item["kind"] == "ai_row_limit"]
    assert (limit["limit"], limit["rowsRead"], limit["rowsLimited"]) == (500, 500, 24500)


def test_a_derived_record_the_ai_never_read_is_no_missing_identity():
    target = _concept(["description"], ["description", "kind"])
    target["conceptId"] = "fact"
    derivation = {"derivationId": "d1", "conceptId": "fact", "sourceConceptId": "m", "conflictRule": "most_common",
                  "mappingVersion": "map-v1",
                  "fieldMappings": [{"targetAttribute": "description", "sourceAttribute": "body"},
                                    {"targetAttribute": "kind", "sourceAttribute": "kind"}]}
    entities = [{"entityId": f"m{index}", "label": f"mail {index}", "attributes": {"body": f"b{index}", "kind": "x"}}
                for index in range(3)]
    entities[1]["attributes"]["body"] = None
    readings = {"m1": {"values": {}, "evidence": {}, "aiLimited": ["description"]}}
    health = ConceptHealth("fact", ["description"], ["kind"])
    health.begin_source("Message", rows_available=3, derived_from="m")
    derived = derive_concept(target, derivation, entities, [], readings, observer=health)
    assert derived["gaps"] == [] and len(derived["entities"]) == 2
    assert health.report(records=2)["dropped"] == [{"reason": "ai_limit", "rows": 1}]


def test_a_snapshot_round_trips_and_readings_add_up():
    first, _ = _health(_participants(100), ["role"], ["adresse", "role"])
    second, _ = _health(_participants(60), ["role"], ["adresse", "role"])
    restored = ConceptHealth.restore(first.snapshot())
    restored.absorb(ConceptHealth.restore(second.snapshot()))
    report = restored.report(records=3)
    assert report["rowsRead"] == 160 and report["rowsKeyed"] == 160 and len(report["sources"]) == 2
    assert ConceptHealth.restore({"v": 99}) is None and ConceptHealth.restore(None) is None


def test_suggested_key_scales_the_sample_and_gives_up_without_a_better_key():
    rows = [{"role": ROLES[index % 3], "address": f"a{index}"} for index in range(100)]
    suggestion = suggest_key(rows, ["role"], 1000)
    assert suggestion["fields"] == ["role", "address"] and suggestion["estimatedRecords"] == 1000
    assert suggest_key([{"role": "a"}] * 50, ["role"], 50) is None
    assert suggest_key([], ["role"], 0) is None


def test_the_gap_and_the_summary_carry_what_the_screen_needs():
    health, output = _health(_participants(400), ["role"], ["cle_message", "adresse", "role"])
    concept_health = {"p": health}
    report = build_health_report(concept_health, {"p": output}, output["entities"], [])
    assert report["concepts"]["p"]["recordsMade"] == 3
    gaps = coarse_key_gaps(concept_health, report)
    assert [gap["kind"] for gap in gaps] == ["identity_too_coarse"]
    summary = summarize_gaps({"entities": output["entities"], "gaps": gaps}, {"concepts": []})
    (other,) = summary["other"]
    assert other["details"]["rows"] == 400 and other["details"]["suggestedKey"]["fields"]
    assert other["details"]["examples"]


def test_a_concept_not_read_again_keeps_the_report_of_the_data_in_use():
    earlier = {"concepts": {"old": {"conceptId": "old", "findings": []}}}
    report = build_health_report({}, {}, [], [], earlier)
    assert report["concepts"] == earlier["concepts"]


CSV_ROWS = 120


def _prepare(source, options, data, output) -> dict:  # type: ignore[no-untyped-def]
    output.write_bytes(b"parquet-bytes")
    return {"datasetId": "ds_0123456789abcdef01234567", "rowCount": CSV_ROWS}


def _query(path, *, columns=None, filters=None, limit=100, offset=0) -> dict:  # type: ignore[no-untyped-def]
    rows = [{"__sheetRow": index + 2, "customer_id": f"C-{index}", "name": f"N{index // 40}",
             "country": ["FR", "BE", "ES"][index % 3]} for index in range(CSV_ROWS)]
    return {"columns": columns, "rows": rows, "returnedRows": CSV_ROWS, "limit": limit, "offset": offset}


@pytest.mark.asyncio
async def test_a_run_reports_the_journey_and_the_coarse_key_of_a_sheet():
    spec = base_spec()
    spec["concepts"][0]["identity"] = {"namespace": "crm", "keyComponents": ["country"]}
    source = {"conceptId": "c1", "source": {"workspaceId": "6512f0a1c9e77a001234aaa1",
                                           "assetId": "6512f0a1c9e77a001234bbb1", "mimeType": "text/csv",
                                           "originalName": "customers.csv"},
              "options": {"sheetName": "main"}, "mappingVersion": "map-v1",
              "columnMapping": {"customer_id": "customer_id", "name": "name", "country": "country"}}
    outcome = await run_population_for_task(command(spec=spec, sources=[source]), fetch=fake_fetch,
                                            prepare=_prepare, query=_query)
    report = outcome["health"]["concepts"]["c1"]
    assert (report["rowsAvailable"], report["rowsRead"], report["recordsMade"]) == (CSV_ROWS, CSV_ROWS, 3)
    coarse = next(item for item in report["findings"] if item["kind"] == "identity_too_coarse")
    assert "customer_id" in coarse["suggestedKey"]["fields"] and coarse["suggestedKey"]["estimatedRecords"] == CSV_ROWS
    assert coarse["examples"][0]["source"] == "customers.csv" and coarse["examples"][0]["sheet"] == "main"
    assert "identity_too_coarse" in {gap["kind"] for gap in outcome["gaps"]}
    assert report["workspaceIds"] == ["6512f0a1c9e77a001234aaa1"]
