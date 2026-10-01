from __future__ import annotations

import pytest

from app.population.computed_fields import apply_computed, check_inputs, compute, normalize_computed
from app.population.document_rules import RuleError

NAME = "JOHNSON_JOHNSON_2023_8K_dated-2023-08-23.pdf"
FILE = {"kind": "file", "name": "document_name"}


def run(**raw):  # type: ignore[no-untyped-def]
    return compute(normalize_computed({"input": FILE, **raw}), NAME)


def test_split_counts_from_either_end_and_drops_the_extension() -> None:
    assert run(method="split", delimiter="_", part=-3) == ("2023", "found")
    assert run(method="split", delimiter="_", part=1) == ("JOHNSON", "found")
    assert run(method="split", delimiter="_", part=-1) == ("dated-2023-08-23", "found")
    assert run(method="split", delimiter="_", part=9) == (None, "no_match")


def test_between_and_transforms() -> None:
    assert run(method="between", after="dated-") == ("2023-08-23", "found")
    assert run(method="between", after="dated-", transform="year") == ("2023", "found")
    assert run(method="between", after="_", before="_", transform="lower") == ("johnson", "found")
    assert run(method="between", after="missing") == (None, "no_match")
    assert run(method="split", delimiter="_", part=1, transform="year") == (None, "not_transformable")


def test_regex_uses_the_named_group_or_a_template() -> None:
    assert run(method="regex", pattern=r"_(?P<year>(?:19|20)\d{2})_") == ("2023", "found")
    assert run(method="regex", pattern=r"_(\d{4})_(\w+?)_", template="FY{1} {2}") == ("FY2023 8K", "found")
    assert run(method="regex", pattern=r"(\d{6})") == (None, "no_match")


def test_no_input_is_reported() -> None:
    spec = normalize_computed({"input": FILE, "method": "split", "delimiter": "_", "part": 1})
    assert compute(spec, None) == (None, "no_input")
    assert compute(spec, "  ") == (None, "no_input")


@pytest.mark.parametrize("raw", [
    {"input": {"kind": "file", "name": "path"}, "method": "split", "delimiter": "_", "part": 1},
    {"input": FILE, "method": "script"},
    {"input": FILE, "method": "split", "delimiter": "", "part": 1},
    {"input": FILE, "method": "split", "delimiter": "_", "part": 0},
    {"input": FILE, "method": "between"},
    {"input": FILE, "method": "regex", "pattern": r"\d{4}"},
    {"input": FILE, "method": "regex", "pattern": r"(\d{4})", "template": "{year}"},
    {"input": FILE, "method": "regex", "pattern": "("},
])
def test_unusable_computations_are_refused(raw) -> None:  # type: ignore[no-untyped-def]
    with pytest.raises(RuleError):
        normalize_computed(raw)


def test_a_computed_field_reads_a_read_field_never_another_computed_one() -> None:
    title = {"mode": "extract", "targetAttribute": "title"}
    year = {"mode": "computed", "targetAttribute": "year",
            "computed": normalize_computed({"input": {"kind": "field", "name": "title"}, "method": "regex",
                                            "pattern": r"(\d{4})"})}
    check_inputs([title, year])
    looped = {**year, "targetAttribute": "copy", "computed": {**year["computed"], "input": {"kind": "field", "name": "year"}}}
    with pytest.raises(RuleError):
        check_inputs([title, year, looped])

    values = {"title": "Annual report 2022"}
    outcomes = apply_computed([title, year], values, {"document_name": NAME})
    assert values["year"] == "2022" and outcomes["year"]["reason"] == "found"
