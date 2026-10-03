"""Record queries on a real Postgres: typed reading of stored text, relative dates,
grouping, visibility applied before counting, one-hop relation filters, and hostile
input that stays data. Goes through the API route with a pinned binding.

Needs SEMANTIC_RUNTIME_TEST_DATABASE_URL (its runtime schemas are dropped and rebuilt).
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path

import asyncpg
import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI

import app.api.graph_search_routes as routes
from app.graph_search.record_query import compile_query, run_query
from app.graph_search.typed_values import typed_value_sql

DSN = os.environ.get("SEMANTIC_RUNTIME_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DSN, reason="SEMANTIC_RUNTIME_TEST_DATABASE_URL not set")
ROOT = Path(__file__).resolve().parents[1]
# Every migration, as the graph search integration test does, so the test database is left whole.
MIGRATIONS = sorted((ROOT / "migrations").glob("*.sql"))
SCHEMAS = ("semantic_jobs", "semantic_datasource", "semantic_runtime", "semantic_population",
           "semantic_graph_search", "semantic_model")

MODEL, VERSION, REVISION = "model-rq", "version-1", "dr_recordquery"
SPEC_HASH = "sha256:" + "c" * 64
NOW = datetime(2026, 10, 3, 12, 0, tzinfo=timezone.utc)
SPEC = {
    "modelId": MODEL, "modelVersionId": VERSION, "homeWorkspaceId": "ws1", "sourceScope": [],
    "concepts": [
        {"conceptId": "c-invoice", "key": "invoice", "label": "Invoice",
         "identity": {"namespace": "invoice", "keyComponents": ["number"]}, "populationMode": "materialized",
         "allowedFields": ["amount", "issued", "notes", "number", "paid", "status"]},
        {"conceptId": "c-customer", "key": "customer", "label": "Customer",
         "identity": {"namespace": "customer", "keyComponents": ["code"]}, "populationMode": "materialized",
         "allowedFields": ["code", "country"]},
    ],
    "relations": [{"relationId": "r-billed", "key": "billed_to", "sourceConceptId": "c-invoice",
                   "targetConceptId": "c-customer", "cardinality": "many_to_one", "matchingStrategy": "exact"}],
}
CATALOG = {
    "concepts": [
        {"key": "invoice", "label": "Invoice", "fields": [
            {"key": "number", "label": "Invoice number", "type": "text"},
            {"key": "issued", "label": "Issue date", "type": "date"},
            {"key": "amount", "label": "Amount", "type": "number"},
            {"key": "status", "label": "Status", "type": "enum"},
            {"key": "paid", "label": "Paid", "type": "boolean"},
            {"key": "notes", "label": "Notes", "type": "text"}]},
        {"key": "customer", "label": "Customer", "fields": [{"key": "country", "label": "Country", "type": "text"}]},
    ],
    "relations": [{"key": "billed_to", "label": "billed to", "inverseLabel": "receives"}],
}


def source(workspace: str | None) -> dict:
    return {"sources": [{"assetRef": {"assetId": "a-1", **({"workspaceId": workspace} if workspace else {})}}]}


INVOICES = [  # number, issued, amount, status, paid, notes, workspace
    ("F-1", "2026-07-27T09:31:28Z", "11 200 000 €", "Payée", "oui", "Société Générale", "ws1"),
    ("F-2", "27/08/2026", "1.234,56", "payee", "false", "x" * 2000, "ws1"),
    ("F-3", "Mon, 7 Sep 2026 23:30:00 -0200", "abc", "draft", "1", "", "ws1"),
    ("F-4", "10 avril 2025", "300", "draft", None, "reported", "ws1"),
    ("F-5", "not a date", "50", "Payée", "non", "late", "ws1"),
    ("F-6", "2026-09-15", "999", "payée", "oui", "secret", "ws2"),  # hidden from ws1-only readers
    ("F-7", None, "", "cancelled", "", "manual", None),  # manual record: no workspace
]
CUSTOMERS = [("C-FR", "France", "ws1"), ("C-DE", "Deutschland", "ws1"), ("C-X", "France", "ws2")]
LINKS = [("F-1", "C-FR"), ("F-2", "C-DE"), ("F-3", "C-FR"), ("F-4", "C-X"), ("F-6", "C-FR")]


@pytest_asyncio.fixture
async def pool():
    assert DSN
    connection = await asyncpg.connect(DSN)
    try:
        for schema in SCHEMAS:
            await connection.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
        for migration in MIGRATIONS:
            await connection.execute(migration.read_text(encoding="utf-8"))
        await connection.execute(
            "INSERT INTO semantic_runtime.specifications (home_workspace_id, model_id, model_version_id, spec_hash, "
            "specification) VALUES ('ws1', $1, $2, $3, $4::jsonb)", MODEL, VERSION, SPEC_HASH, json.dumps(SPEC))
        await connection.execute(
            "INSERT INTO semantic_population.data_revisions (id, model_id, model_version_id, spec_hash) "
            "VALUES ($1, $2, $3, $4)", REVISION, MODEL, VERSION, SPEC_HASH)
        await connection.execute(
            "INSERT INTO semantic_runtime.active_bindings (model_id, environment, model_version_id, "
            "data_revision_id, projection_ref) VALUES ($1, 'production', $2, $3, 'age:v1:pop_dr_recordquery')",
            MODEL, VERSION, REVISION)
        rows = []
        for number, issued, amount, status, paid, notes, workspace in INVOICES:
            attributes = {key: value for key, value in (("issued", issued), ("amount", amount), ("status", status),
                                                       ("paid", paid), ("notes", notes)) if value is not None}
            rows.append((f"invoice:{number}", "c-invoice", json.dumps({"number": number}), f"Invoice {number}",
                         json.dumps(attributes), json.dumps(source(workspace) if workspace else {"sources": []})))
        for code, country, workspace in CUSTOMERS:
            rows.append((f"customer:{code}", "c-customer", json.dumps({"code": code}), code,
                         json.dumps({"country": country}), json.dumps(source(workspace))))
        await connection.executemany(
            "INSERT INTO semantic_population.entities (id, model_id, data_revision_id, concept_id, namespace, "
            "identity_key, label, attributes, provenance) VALUES ($1, $7, $8, $2, 'ns', $3, $4, $5::jsonb, $6::jsonb)",
            [(*row, MODEL, REVISION) for row in rows])
        await connection.executemany(
            "INSERT INTO semantic_population.relationships (model_id, data_revision_id, relation_id, "
            "source_entity_id, target_entity_id) VALUES ($1, $2, 'r-billed', $3, $4)",
            [(MODEL, REVISION, f"invoice:{invoice}", f"customer:{customer}") for invoice, customer in LINKS])
    finally:
        await connection.close()
    value = await asyncpg.create_pool(DSN, min_size=1, max_size=4)
    yield value
    await value.close()


async def query(pool, request: dict, allowed: list[str] | None = ["ws1"]) -> dict:  # noqa: B006
    compiled = await routes._compiled(pool, REVISION)
    plan, errors, _ = compile_query(compiled, CATALOG, {"concept": "Invoice", **request}, model_id=MODEL,
                                    revision_id=REVISION, allowed_workspaces=allowed, now=NOW)
    assert errors == [], errors
    return await run_query(pool, plan)


def names(result: dict) -> list[str]:
    return [record["name"] for record in result["records"]]


@pytest.mark.asyncio
async def test_stored_text_is_read_with_the_field_type(pool) -> None:  # type: ignore[no-untyped-def]
    async with pool.acquire() as connection:
        await connection.execute("SET TimeZone = 'UTC'")
        rows = await connection.fetch(
            f"SELECT {typed_value_sql('date', 'v')} AS d FROM unnest($1::text[]) WITH ORDINALITY AS u(v, i) ORDER BY i",
            ["2026-07-27T09:31:28Z", "27/08/2026", "Mon, 7 Sep 2026 23:30:00 -0200", "10 avril 2025",
             "Date : 18 juin 2026", "juin 2026", "2026-02-30", "June 2022 - July 2022", "", None])
    assert [row["d"].isoformat() if row["d"] else None for row in rows] == [
        "2026-07-27T09:31:28+00:00", "2026-08-27T00:00:00+00:00", "2026-09-08T01:30:00+00:00",
        "2025-04-10T00:00:00+00:00", "2026-06-18T00:00:00+00:00", "2026-06-01T00:00:00+00:00",
        None, None, None, None]


@pytest.mark.asyncio
async def test_relative_dates_count_only_readable_values(pool) -> None:  # type: ignore[no-untyped-def]
    result = await query(pool, {"filters": [{"field": "issued", "op": "between", "value": "last_3_months"}]})
    assert names(result) == ["Invoice F-1", "Invoice F-2", "Invoice F-3"]
    assert result["total"] == 3
    # F-5's date cannot be read (F-6 is hidden, F-7 has none).
    assert result["unparsable"] == {"issued": 1}
    assert result["hiddenRecords"] == 1


@pytest.mark.asyncio
async def test_text_comparisons_ignore_case_and_accents(pool) -> None:  # type: ignore[no-untyped-def]
    paid = await query(pool, {"filters": [{"field": "Status", "op": "eq", "value": "PAYEE"}], "fields": ["status"]})
    assert names(paid) == ["Invoice F-1", "Invoice F-2", "Invoice F-5"]
    societe = await query(pool, {"filters": [{"field": "notes", "op": "contains", "value": "generale"}]})
    assert names(societe) == ["Invoice F-1"]
    not_paid = await query(pool, {"filters": [{"field": "status", "op": "ne", "value": "payée"}]})
    assert names(not_paid) == ["Invoice F-3", "Invoice F-4", "Invoice F-7"]
    empty = await query(pool, {"filters": [{"field": "notes", "op": "is_empty"}]})
    assert names(empty) == ["Invoice F-3"]


@pytest.mark.asyncio
async def test_numbers_and_yes_no_compare_typed(pool) -> None:  # type: ignore[no-untyped-def]
    big = await query(pool, {"filters": [{"field": "amount", "op": "gte", "value": 1000}],
                             "orderBy": [{"field": "amount", "direction": "desc"}], "fields": ["amount"]})
    assert names(big) == ["Invoice F-1", "Invoice F-2"]
    assert big["unparsable"] == {"amount": 1}  # "abc"; the empty value of F-7 is not counted
    paid = await query(pool, {"filters": [{"field": "paid", "op": "eq", "value": True}]})
    assert names(paid) == ["Invoice F-1", "Invoice F-3"]
    totals = await query(pool, {"aggregates": [{"op": "count"}, {"op": "sum", "field": "amount"},
                                               {"op": "max", "field": "issued"}], "limit": 0})
    assert totals["aggregates"] == {"count": 6, "sum_amount": 11201584.56, "max_issued": "2026-09-08T01:30:00Z"}
    assert totals["records"] == [] and totals["nextOffset"] is None


@pytest.mark.asyncio
async def test_grouping_by_month_and_by_text(pool) -> None:  # type: ignore[no-untyped-def]
    months = await query(pool, {"groupBy": [{"field": "issued", "bucket": "month"}]})
    assert months["buckets"] == [{"issued:month": "2025-04", "count": 1}, {"issued:month": "2026-07", "count": 1},
                                 {"issued:month": "2026-08", "count": 1}, {"issued:month": "2026-09", "count": 1},
                                 {"issued:month": None, "count": 2}]
    statuses = await query(pool, {"groupBy": ["status"], "aggregates": [{"op": "count"},
                                                                        {"op": "count_distinct", "field": "paid"}]})
    assert statuses["buckets"][0] == {"status": "Payée", "count": 3, "count_distinct_paid": 2}
    assert statuses["bucketsTruncated"] is False
    everyone = await query(pool, {"groupBy": ["status"]}, allowed=None)
    assert everyone["buckets"][0]["count"] == 4 and everyone["hiddenRecords"] == 0


@pytest.mark.asyncio
async def test_a_linked_record_must_match_and_be_readable(pool) -> None:  # type: ignore[no-untyped-def]
    french = await query(pool, {"filters": [{"field": "billed to.country", "op": "eq", "value": "france"}]})
    # F-6 is hidden; F-4's customer is in a workspace the reader cannot open.
    assert names(french) == ["Invoice F-1", "Invoice F-3"]
    unlinked = await query(pool, {"filters": [{"field": "billed_to", "op": "is_empty"}]})
    assert names(unlinked) == ["Invoice F-4", "Invoice F-5", "Invoice F-7"]
    either = await query(pool, {"match": "any", "filters": [{"field": "billed_to.country", "op": "eq", "value": "deutschland"},
                                                            {"field": "status", "op": "eq", "value": "cancelled"}]})
    assert names(either) == ["Invoice F-2", "Invoice F-7"]


@pytest.mark.asyncio
async def test_pages_long_values_and_hostile_input(pool) -> None:  # type: ignore[no-untyped-def]
    page = await query(pool, {"limit": 2, "offset": 1, "fields": ["notes", "Invoice number"]})
    assert page["total"] == 6 and names(page) == ["Invoice F-2", "Invoice F-3"] and page["nextOffset"] == 3
    long = page["records"][0]
    assert long["truncated"] is True and long["truncatedFields"] == ["notes"] and len(long["values"]["notes"]) == 1501
    assert long["keyFields"] == {"number": "F-2"} and long["values"]["number"] == "F-2"
    hostile = await query(pool, {"filters": [{"field": "notes", "op": "contains", "value": "'); DROP TABLE x; --"}]})
    assert hostile["total"] == 0
    async with pool.acquire() as connection:
        assert await connection.fetchval("SELECT count(*) FROM semantic_population.entities") == 10


@pytest.mark.asyncio
async def test_the_route_pins_the_binding_and_reports_errors(pool, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    app = FastAPI()
    app.include_router(routes.router)
    app.state.population_pool = pool
    pinned = {"actorUserId": "u-1", "modelId": MODEL, "environment": "production", "allowedWorkspaceIds": ["ws1"]}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://runtime") as client:
        ok = await client.post("/v1/semantic-model-search/records-query", json={
            **pinned, "concept": "invoice", "catalog": CATALOG, "groupBy": [{"field": "Issue date", "bucket": "year"}],
            "filters": [{"field": "issued", "op": "gte", "value": "2026-01-01"}]})
        bad = await client.post("/v1/semantic-model-search/records-query", json={
            **pinned, "concept": "invoice", "catalog": CATALOG, "filters": [{"field": "colour", "op": "eq", "value": 1}]})
        missing = await client.post("/v1/semantic-model-search/records-query", json={**pinned, "concept": "Order"})
        draft = await client.post("/v1/semantic-model-search/records-query", json={
            **pinned, "environment": "draft", "concept": "invoice"})
        overview = await client.post("/v1/semantic-model-search/records-overview", json=pinned)
    assert ok.status_code == 200
    body = ok.json()
    assert body["dataRevisionId"] == REVISION and body["status"] == "ok"
    assert body["buckets"] == [{"issued:year": "2026", "count": 3}]
    assert body["unparsable"] == {"issued": 1}
    assert bad.json()["status"] == "invalid_query" and bad.json()["errors"][0]["part"] == "filters[0].field"
    assert missing.json()["status"] == "not_represented"
    assert draft.status_code == 404
    concepts = {item["key"]: item for item in overview.json()["concepts"]}
    assert concepts["invoice"]["recordCount"] == 6 and concepts["invoice"]["hiddenRecords"] == 1
    assert concepts["invoice"]["keyFields"] == ["number"]
    assert overview.json()["relations"] == [{"relationId": "r-billed", "key": "billed_to", "from": "invoice",
                                             "to": "customer", "cardinality": "many_to_one"}]
