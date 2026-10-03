"""The record query compiler: names resolved against the model, relative dates, typed
comparisons, grouping, and SQL whose only interpolated parts are constants."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from decimal import Decimal

import pytest

from app.graph_search.record_query import (MAX_BUCKETS, compile_query, groups_sql, records_sql, resolve_date,
                                           stats_sql)
from app.graph_search.typed_values import parse_boolean, parse_number, typed_value_sql

NOW = datetime(2026, 10, 3, 12, 0, tzinfo=timezone.utc)  # a Saturday
COMPILED = {
    "concepts": {
        "c-invoice": {"conceptId": "c-invoice", "key": "invoice", "label": "Invoice", "aliases": ["Bill"],
                      "keyComponents": ["number"],
                      "allowedFields": ["amount", "issued", "notes", "number", "paid", "status"],
                      "fieldAliases": {"amount": ["Total"]}},
        "c-customer": {"conceptId": "c-customer", "key": "customer", "label": "Customer", "aliases": [],
                       "keyComponents": ["code"], "allowedFields": ["code", "country", "full_name"]},
    },
    "relations": {"r-billed": {"relationId": "r-billed", "key": "billed_to", "sourceConceptId": "c-invoice",
                               "targetConceptId": "c-customer", "cardinality": "many_to_one"}},
}
CATALOG = {
    "concepts": [
        {"key": "invoice", "label": "Invoice", "fields": [
            {"key": "number", "label": "Invoice number", "type": "text"},
            {"key": "issued", "label": "Issue date", "type": "date", "aliases": ["Date"]},
            {"key": "amount", "label": "Amount", "type": "number"},
            {"key": "status", "label": "Status", "type": "enum"},
            {"key": "paid", "label": "Paid", "type": "boolean"},
            {"key": "dropped_later", "label": "Not in the data", "type": "text"},
        ]},
        {"key": "customer", "label": "Customer", "fields": [{"key": "country", "label": "Pays", "type": "text"}]},
    ],
    "relations": [{"key": "billed_to", "label": "billed to", "inverseLabel": "receives"}],
}


def compile_(request: dict, allowed: list[str] | None = None):  # type: ignore[no-untyped-def]
    return compile_query(COMPILED, CATALOG, request, model_id="m-1", revision_id="dr_1",
                         allowed_workspaces=allowed, now=NOW)


def reasons(errors: list[dict]) -> list[tuple[str, str]]:
    return [(error["part"], error["reason"]) for error in errors]


# Relative and absolute dates ---------------------------------------------------------------


@pytest.mark.parametrize("token, start, end", [
    ("today", "2026-10-03", "2026-10-04"),
    ("yesterday", "2026-10-02", "2026-10-03"),
    ("last_7_days", "2026-09-27", "2026-10-04"),
    ("last 3 months", "2026-07-04", "2026-10-04"),
    ("last_2_weeks", "2026-09-20", "2026-10-04"),
    ("last_1_years", "2025-10-04", "2026-10-04"),
    ("this_week", "2026-09-28", "2026-10-05"),
    ("last_week", "2026-09-21", "2026-09-28"),
    ("this_month", "2026-10-01", "2026-11-01"),
    ("last_month", "2026-09-01", "2026-10-01"),
    ("this_quarter", "2026-10-01", "2027-01-01"),
    ("last_quarter", "2026-07-01", "2026-10-01"),
    ("this_year", "2026-01-01", "2027-01-01"),
    ("LAST-YEAR", "2025-01-01", "2026-01-01"),
    ("2026-07-14", "2026-07-14", "2026-07-15"),
    ("14/07/2026", "2026-07-14", "2026-07-15"),
    ("2026-02", "2026-02-01", "2026-03-01"),
    ("2025", "2025-01-01", "2026-01-01"),
])
def test_dates_are_half_open_utc_ranges(token: str, start: str, end: str) -> None:
    resolved = resolve_date(token, NOW)
    assert resolved is not None
    assert (resolved[0].date().isoformat(), resolved[1].date().isoformat()) == (start, end)
    assert resolved[0].tzinfo is not None


def test_an_instant_is_itself_and_bad_dates_are_refused() -> None:
    start, end, label = resolve_date("2026-07-27T09:31:28+02:00", NOW)  # type: ignore[misc]
    assert start == datetime(2026, 7, 27, 7, 31, 28, tzinfo=timezone.utc)
    assert (end - start).total_seconds() < 0.001
    for bad in ("2026-02-30", "last_0_days", "last_month_please", "soon", "", 2026, None):
        assert resolve_date(bad, NOW) is None


# Names and errors --------------------------------------------------------------------------


def test_fields_resolve_by_key_label_or_alias_accents_and_case_aside() -> None:
    plan, errors, applied = compile_({"concept": "bill", "filters": [
        {"field": "ISSUE DATE", "op": "eq", "value": "2026-07"},
        {"field": "total", "op": "gte", "value": "1 000,50 €"},
        {"field": "billed to.pays", "op": "eq", "value": "France"},
        {"field": "name", "op": "contains", "value": "Acmé"},
    ]})
    assert errors == []
    assert plan is not None and plan.concept.key == "invoice"
    filters = applied["filters"]
    assert [f["field"] for f in filters] == ["issued", "amount", "country", "name"]
    assert filters[0]["range"] == {"from": "2026-07-01T00:00:00Z", "to": "2026-08-01T00:00:00Z", "toExclusive": True}
    assert filters[2]["relation"] == "billed_to" and filters[2]["direction"] == "outgoing"
    assert Decimal("1000.50") in plan.params
    assert "acme" in plan.params  # compared folded


def test_an_inverse_label_reads_the_relation_backwards() -> None:
    plan, errors, applied = compile_({"concept": "Customer", "filters": [
        {"field": "receives.amount", "op": "gt", "value": 100}, {"field": "billed_to", "op": "is_empty"}]})
    assert errors == []
    assert [f["direction"] for f in applied["filters"]] == ["incoming", "incoming"]
    assert "rel.target_entity_id = typed.id" in plan.where


def test_unknown_names_come_back_part_by_part() -> None:
    plan, errors, _ = compile_({"concept": "Invoice", "filters": [
        {"field": "sender", "op": "eq", "value": "x"},
        {"field": "status", "op": "gt", "value": "a"},
        {"field": "issued", "op": "in", "value": ["2026-01-01"]},
        {"field": "issued", "op": "eq", "value": "next tuesday"},
        {"field": "amount", "op": "eq", "value": "lots"},
        {"field": "amount", "op": "like", "value": "1"},
        {"field": "dropped_later", "op": "eq", "value": "x"},
    ], "groupBy": [{"field": "status", "bucket": "month"}, "issued", "amount"],
        "aggregates": [{"op": "sum", "field": "status"}, {"op": "median", "field": "amount"}],
        "limit": 500})
    assert plan is None
    assert reasons(errors) == [
        ("filters[0].field", "unknown_field"), ("filters[1].op", "unsupported_op"),
        ("filters[2].op", "unsupported_op"), ("filters[3].value", "invalid_date"),
        ("filters[4].value", "invalid_value"), ("filters[5].op", "unknown_op"),
        ("filters[6].field", "unknown_field"),  # defined in the model, absent from the data
        ("groupBy", "too_many"), ("groupBy[0].bucket", "invalid_bucket"),
        ("aggregates[0].op", "unsupported_op"), ("aggregates[1].op", "unknown_op"), ("limit", "invalid_value"),
    ]
    assert "Issue date" in errors[0]["available"]
    assert all(error["code"] == "invalid_query" for error in errors)


def test_an_unknown_concept_lists_the_concepts() -> None:
    plan, errors, _ = compile_({"concept": "Supplier"})
    assert plan is None and reasons(errors) == [("concept", "unknown_concept")]
    assert errors[0]["available"] == ["Invoice", "Customer"]


def test_as_reads_a_text_field_with_another_type() -> None:
    plan, errors, applied = compile_({"concept": "Invoice", "filters": [
        {"field": "notes", "op": "gte", "value": "2026-01-01", "as": "date"}]})
    assert errors == [] and applied["filters"][0]["type"] == "date"
    assert "pg_input_is_valid" in plan.typed_columns[0]


# SQL ---------------------------------------------------------------------------------------


def test_names_and_values_are_bound_never_interpolated() -> None:
    hostile = "x'); DROP TABLE semantic_population.entities; --"
    plan, errors, _ = compile_({"concept": "Invoice", "filters": [
        {"field": "notes", "op": "contains", "value": hostile},
        {"field": "status", "op": "in", "value": [hostile, "paid"]},
    ], "orderBy": [{"field": "amount", "direction": "desc"}]}, allowed=["ws'1"])
    assert errors == []
    for sql in (stats_sql(plan), records_sql(plan)):
        assert "DROP TABLE" not in sql and "ws'1" not in sql and "notes" not in sql
    assert plan.params[:4] == ["m-1", "dr_1", "c-invoice", ["ws'1"]]
    assert "notes" in plan.params and "amount" in plan.params


def test_a_hostile_field_name_is_an_error_not_sql() -> None:
    plan, errors, _ = compile_({"concept": "Invoice", "groupBy": [{"field": "status'; --"}],
                                "orderBy": [{"field": "1; DROP", "direction": "desc; DROP"}]})
    assert plan is None
    assert reasons(errors) == [("groupBy[0].field", "unknown_field"), ("orderBy[0].direction", "invalid_value")]


def test_visibility_is_applied_in_sql_before_counting() -> None:
    plan, _, _ = compile_({"concept": "Invoice", "filters": [{"field": "billed_to.country", "op": "eq", "value": "fr"}]},
                          allowed=["ws1"])
    sql = stats_sql(plan)
    scoped = sql.split("), typed AS")[0]
    assert "$4::text[] IS NULL OR NOT EXISTS" in scoped
    # The linked record must be readable too.
    assert "jsonb_array_elements(CASE WHEN jsonb_typeof(o.provenance" in plan.where


def test_grouping_by_a_date_bucket_and_default_order() -> None:
    plan, errors, applied = compile_({"concept": "Invoice", "groupBy": [{"field": "issued", "bucket": "month"}, "status"]})
    assert errors == []
    assert applied["aggregates"] == [{"name": "count", "op": "count"}]
    assert [g["name"] for g in applied["groupBy"]] == ["issued:month", "status"]
    assert applied["orderBy"] == [{"by": "issued:month", "direction": "asc"}, {"by": "status", "direction": "asc"}]
    sql = groups_sql(plan)
    assert "to_char(t0, 'YYYY-MM') AS g0" in sql and "mode() WITHIN GROUP (ORDER BY btrim(r1)) AS d1" in sql
    assert sql.endswith(f"LIMIT ${len(plan.params) + 1}") and MAX_BUCKETS == 500


def test_group_order_by_an_aggregate_name() -> None:
    plan, errors, applied = compile_({"concept": "Invoice", "groupBy": ["status"],
                                      "aggregates": [{"op": "count"}, {"op": "sum", "field": "amount"}],
                                      "orderBy": [{"field": "sum_amount", "direction": "desc"}]})
    assert errors == [] and applied["orderBy"] == [{"by": "sum_amount", "direction": "desc"}]
    assert "a1 DESC NULLS LAST" in groups_sql(plan)


def test_fields_returned_are_the_allowed_fields_in_model_order() -> None:
    plan, _, applied = compile_({"concept": "Invoice"})
    assert [item["key"] for item in applied["fields"]] == ["number", "issued", "amount", "status", "paid", "notes"]
    assert applied["orderBy"] == [{"by": "name", "direction": "asc"}]
    assert records_sql(plan).endswith(f"id ASC LIMIT ${len(plan.params) + 1} OFFSET ${len(plan.params) + 2}")


# Reading typed values (Python twins; the SQL is exercised in the integration test) ----------


@pytest.mark.parametrize("text, expected", [
    ("1032", Decimal("1032")), ("11 200 000 €", Decimal("11200000")), ("8 750 000 EUR hors taxes.", Decimal("8750000")),
    ("12,5 %", Decimal("12.5")), ("1.234,56", Decimal("1234.56")), ("1,234.56", Decimal("1234.56")),
    ("1,234,567", Decimal("1234567")), ("-3.5", Decimal("-3.5")), (7, Decimal("7")),
    ("abc", None), ("", None), (True, None),
])
def test_numbers_read_like_stored_values(text, expected) -> None:  # type: ignore[no-untyped-def]
    assert parse_number(text) == expected


def test_yes_no_values() -> None:
    assert [parse_boolean(v) for v in ("Oui", "false", 1, "vrai", "peut-être")] == [True, False, True, True, None]


def test_typed_sql_is_built_from_constants_around_one_expression() -> None:
    for kind in ("date", "number", "boolean", "text"):
        sql = typed_value_sql(kind, "r0")
        assert "r0" in sql and not re.search(r"\$\d", sql)  # no parameter: nothing from the caller


@pytest.mark.parametrize("op, value", [("eq", "2026-07"), ("ne", "today"), ("gt", "2026"), ("gte", "last_month"),
                                       ("lt", "2026-01-01"), ("lte", "this_year"), ("between", ["2025", "2026-03"])])
def test_every_bound_parameter_is_used(op: str, value: object) -> None:
    # Postgres refuses a statement with a parameter it does not use.
    plan, errors, _ = compile_({"concept": "Invoice", "filters": [{"field": "issued", "op": op, "value": value},
                                                                 {"field": "billed_to.country", "op": "ne", "value": "x"}]})
    assert errors == []
    sql = stats_sql(plan)
    assert all(re.search(rf"\${index}(?!\d)", sql) for index in range(1, len(plan.params) + 1))
