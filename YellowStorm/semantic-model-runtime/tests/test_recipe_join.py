"""A recipe's input can join several parts (columns, fields, the file name, fixed texts) into one text,
then the usual steps shape it; documents, sheet rows and another concept's records all share it."""

from __future__ import annotations

import pytest

from app.population.computed_fields import (apply_computed, apply_row_recipes, check_inputs, compute,
                                            compute_from, normalize_computed, normalize_row_recipes,
                                            recipe_columns, recipe_sources)
from app.population.document_rules import RuleError
from test_derived_fields import CONTRACTS, assertion, by_org, derivation, derive

SENDER = {"kind": "join", "parts": [{"kind": "field", "name": "name"}, {"kind": "text", "value": " <"},
                                    {"kind": "field", "name": "email"}, {"kind": "text", "value": ">"}],
          "separator": ""}


def join(*parts: dict, **options) -> dict:  # type: ignore[no-untyped-def]
    return {"kind": "join", "parts": list(parts), **options}


def column(name: str) -> dict:
    return {"kind": "column", "name": name}


def field(name: str) -> dict:
    return {"kind": "field", "name": name}


def text(value: str) -> dict:
    return {"kind": "text", "value": value}


def test_a_join_is_normalized_with_its_defaults() -> None:
    spec = normalize_computed({"input": join(column("first"), column(" last ")), "method": "whole"})
    assert spec["input"] == {"kind": "join", "parts": [column("first"), column(" last ")],
                             "separator": " ", "skipEmpty": True}
    assert spec["stripExtension"] is False
    assert recipe_columns({"x": spec}) == {"first", " last "}
    assert recipe_sources(spec) == ["first", " last "]


def test_old_single_inputs_keep_their_exact_shape() -> None:
    # The stored recipe and its normalized form are unchanged, so run fingerprints do not move.
    assert normalize_computed({"input": {"kind": "field", "name": " title "}, "method": "whole"}) == {
        "input": {"kind": "field", "name": "title"}, "method": "whole", "transform": "none", "stripExtension": False}
    assert normalize_computed({"input": {"kind": "file", "name": "document_name"}, "method": "split",
                               "delimiter": "_", "part": 1}) == {
        "input": {"kind": "file", "name": "document_name"}, "method": "split", "transform": "none",
        "stripExtension": True, "delimiter": "_", "part": 1}


@pytest.mark.parametrize("source", [
    join(column("a")),
    join(text("a"), text("b")),
    join(*[column(f"c{index}") for index in range(11)]),
    join(column("a"), text("")),
    join(column("a"), text("x" * 101)),
    join(column("a"), column("b"), separator="x" * 11),
    join(column("a"), column("b"), skipEmpty="yes"),
    join(column("a"), {"kind": "join", "parts": [column("b"), column("c")]}),
    join(column("a"), {"kind": "file", "name": "path"}),
])
def test_unusable_joins_are_refused(source: dict) -> None:
    with pytest.raises(RuleError):
        normalize_computed({"input": source, "method": "whole"})


def test_a_join_on_a_row_and_the_steps_after_it() -> None:
    recipes = normalize_row_recipes({"full": {"input": join(column("First"), column("Last")), "method": "whole",
                                              "transform": "upper"}}, {"full"})
    values: dict = {}
    outcomes = apply_row_recipes(recipes, values, {"First": " Ada ", "Last": "Lovelace"})
    assert values["full"] == "ADA LOVELACE"
    assert outcomes["full"] == {"method": "recipe", "reason": "found", "input": "Ada Lovelace"}


def test_empty_parts_are_skipped_or_kept_and_all_empty_is_no_input() -> None:
    spec = normalize_computed({"input": join(column("a"), column("b"), column("c"), separator=", "), "method": "whole"})
    lookup = {"a": "x", "b": "", "c": "z"}.get
    assert compute_from(spec, lambda kind, name: lookup(name))[:2] == ("x, z", "found")
    kept = normalize_computed({"input": join(column("a"), column("b"), column("c"), separator=", ", skipEmpty=False),
                               "method": "whole"})
    assert compute_from(kept, lambda kind, name: lookup(name))[:2] == ("x, , z", "found")
    # Fixed texts alone are no input.
    sender = normalize_computed({"input": SENDER, "method": "whole"})
    steps: list[dict] = []
    assert compute_from(sender, lambda kind, name: None, steps) == (None, "no_input", None)
    assert steps == [{"step": "join", "value": None}]


def test_text_parts_and_the_trace() -> None:
    spec = normalize_computed({"input": SENDER, "method": "whole", "transform": "lower"})
    steps: list[dict] = []
    values = {"name": "Jean Dupont", "email": "JD@example.org"}
    value, reason, joined = compute_from(spec, lambda kind, name: values.get(name), steps)
    assert (value, reason, joined) == ("jean dupont <jd@example.org>", "found", "Jean Dupont <JD@example.org>")
    assert steps == [{"step": "join", "value": "Jean Dupont <JD@example.org>"},
                     {"step": "transform", "value": "jean dupont <jd@example.org>"}]
    # The usual cut runs on the joined text.
    cut = normalize_computed({"input": SENDER, "method": "between", "after": "<", "before": ">"})
    assert compute(cut, "Jean <jd@x.org>") == ("jd@x.org", "found")


def test_a_join_on_document_fields_and_the_file_name() -> None:
    plain = [{"mode": "extract", "targetAttribute": "name"}, {"mode": "extract", "targetAttribute": "email"}]
    sender = {"mode": "computed", "targetAttribute": "sender", "computed": normalize_computed({"input": SENDER, "method": "whole"})}
    labelled = {"mode": "computed", "targetAttribute": "labelled", "computed": normalize_computed(
        {"input": join({"kind": "file", "name": "document_name"}, field("name"), separator=" - "), "method": "whole"})}
    check_inputs([*plain, sender, labelled])
    values = {"name": "Jean", "email": "j@x.org"}
    outcomes = apply_computed([*plain, sender, labelled], values, {"document_name": "mail_42.eml"})
    assert values["sender"] == "Jean <j@x.org>" and outcomes["sender"]["reason"] == "found"
    # The file part loses its extension, as a file input does.
    assert values["labelled"] == "mail_42 - Jean"


def test_a_join_never_reads_another_computed_field_or_a_column_of_a_document() -> None:
    plain = {"mode": "extract", "targetAttribute": "name"}
    year = {"mode": "computed", "targetAttribute": "year", "computed": normalize_computed(
        {"input": {"kind": "file", "name": "document_name"}, "method": "split", "delimiter": "_", "part": 1})}
    chained = {"mode": "computed", "targetAttribute": "both", "computed": normalize_computed(
        {"input": join(field("name"), field("year")), "method": "whole"})}
    with pytest.raises(RuleError):
        check_inputs([plain, year, chained])
    with pytest.raises(RuleError):
        check_inputs([plain, {"mode": "computed", "targetAttribute": "c", "computed": normalize_computed(
            {"input": join(field("name"), column("x")), "method": "whole"})}])


def test_sheet_joins_refuse_chains_and_the_file_name() -> None:
    mapped = {"first", "last", "full", "initials"}
    # A join may read a field read from a column, even one shaped by its own column recipe.
    recipes = normalize_row_recipes({
        "last": {"input": column("Last"), "method": "whole", "transform": "upper"},
        "full": {"input": join(field("first"), field("last")), "method": "whole"},
    }, mapped)
    values = {"first": "Ada"}
    apply_row_recipes(recipes, values, {"Last": "Lovelace"})
    assert values["full"] == "Ada LOVELACE"
    # ...but not a field that itself reads a field (alone or joined), nor itself.
    for chained in ({"full": {"input": join(field("first"), field("last")), "method": "whole"},
                     "initials": {"input": field("full"), "method": "whole"}},
                    {"full": {"input": field("first"), "method": "whole"},
                     "initials": {"input": join(field("full"), column("x")), "method": "whole"}},
                    {"full": {"input": join(field("full"), column("x")), "method": "whole"}},
                    {"full": {"input": join(column("x"), field("unknown")), "method": "whole"}},
                    {"full": {"input": join(column("x"), {"kind": "file", "name": "document_name"}), "method": "whole"}}):
        with pytest.raises(RuleError):
            normalize_row_recipes(chained, mapped)


@pytest.mark.asyncio
async def test_a_join_on_record_fields_names_every_source_field_as_evidence() -> None:
    joined = {"targetAttribute": "short", "mode": "computed",
              "computed": {"input": join(column("customer_id"), text("·"), column("customer_name"), separator=" "),
                           "method": "whole"}}
    output, _read = await derive(derivation(joined))
    assert by_org(output, "short") == {"c-1": "C-1 · Acme", "c-2": "C-2 · Globex"}
    derived_from = assertion(output, "c-1", "short")["evidence"]["derivedFrom"]
    assert derived_from["method"] == "recipe"
    assert derived_from["attribute"] == "customer_id"
    assert derived_from["attributes"] == ["customer_id", "customer_name"]
    # A join of another derived field reads that field's source field.
    taken = {"targetAttribute": "kind", "mode": "computed",
             "computed": {"input": join(field("name"), column("customer_id")), "method": "whole"}}
    output, _read = await derive(derivation(taken))
    assert assertion(output, "c-2", "kind")["evidence"]["derivedFrom"]["attributes"] == ["customer_name", "customer_id"]
    assert CONTRACTS


@pytest.mark.asyncio
async def test_a_record_join_refuses_unknown_source_fields() -> None:
    from app.population.derived import DerivationError

    unknown = {"targetAttribute": "short", "mode": "computed",
               "computed": {"input": join(column("customer_id"), column("missing")), "method": "whole"}}
    with pytest.raises(DerivationError):
        await derive(derivation(unknown))


@pytest.mark.asyncio
async def test_the_preview_joins_part_samples() -> None:
    from fastapi import HTTPException

    from app.api.population_routes import preview_computed_field

    result = await preview_computed_field({
        "computed": {"input": SENDER, "method": "whole"},
        "partSamples": [{"field:name": "Jean", "field:email": "j@x.org"}, {"field:name": "", "field:email": ""}],
        "partRecipes": {"field:email": {"input": field("email"), "method": "whole", "transform": "upper"}},
    })
    first, second = result["results"]
    assert first["input"] == "Jean <J@X.ORG>" and first["value"] == "Jean <J@X.ORG>"
    assert first["steps"][0] == {"step": "join", "value": "Jean <J@X.ORG>"}
    assert second["reason"] == "no_input"
    with pytest.raises(HTTPException):
        await preview_computed_field({"computed": {"input": SENDER, "method": "whole"}, "samples": ["x"]})
