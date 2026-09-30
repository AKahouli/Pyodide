from __future__ import annotations

import time

import pytest

from app.population.document import _read_rules, _select_ai_blocks
from app.population.document_rules import (RuleError, clean, compile_pattern, match_pattern,
                                           next_line_values, normalize_ai_settings, normalize_rules,
                                           same_line_values, to_iso_date)


def section(pk, title, *blocks):  # type: ignore[no-untyped-def]
    return {"sectionPk": pk, "sectionKey": f"s{pk}", "title": title,
            "blocks": [{"blockPk": pk * 100 + index, "content": content, "pageNumber": page,
                        "blockType": kind, "origin": "native_text"}
                       for index, (content, page, kind) in enumerate(blocks)]}


AMENDMENT = [
    section(1, "Amendment 2 - identifying record",
            ("Contract number CNT-2026-0041 Amendment number 2 Effective date 2026-03-01", 1, "image/table")),
    section(2, "1.2 Subject and control",
            ("The subject of this amendment is: Service availability schedule. The operative wording is on page 2.", 1, "text/text")),
    section(3, "Operative changes", ("Amendment 2 / effective 1 March 2026", 2, "text/text")),
]


def field(key, label, **rules):  # type: ignore[no-untyped-def]
    return {"targetAttribute": key, "sourceField": label, "mode": "extract",
            **({"rules": normalize_rules(rules)} if rules else {})}


def test_rules_are_checked_before_use():
    assert normalize_rules(None) is None
    assert normalize_rules({"labels": [" Title ", ""]})["labels"] == ["Title"]
    with pytest.raises(RuleError):
        normalize_rules({"location": "somewhere"})
    with pytest.raises(RuleError):
        normalize_rules({"pattern": "("})
    with pytest.raises(RuleError):
        normalize_rules({"location": "anywhere"})
    with pytest.raises(RuleError):
        normalize_ai_settings({"maxBlocks": 5})
    assert normalize_ai_settings({"blocksPerField": 3})["blocksPerField"] == 3


def test_a_slow_pattern_gives_up_instead_of_hanging():
    compiled = compile_pattern(r"(a+)+$")
    started = time.monotonic()
    assert match_pattern(compiled, "a" * 40 + "b") is None
    assert time.monotonic() - started < 2


def test_text_after_a_label_and_on_the_next_line():
    assert same_line_values("The subject of this amendment is: Service schedule. More text.",
                            "subject of this amendment") == ["Service schedule"]
    assert same_line_values("Contract No - CNT-1", "contract no") == ["CNT-1"]
    assert next_line_values("Title\nService schedule\nOther", "title") == ["Service schedule"]


def test_values_are_matched_and_cleaned():
    assert to_iso_date("1 March 2026") == "2026-03-01"
    assert to_iso_date("01/03/2026") == "2026-03-01"
    assert to_iso_date("1er mars 2026") == "2026-03-01"
    assert to_iso_date("soon") is None
    rules = normalize_rules({"pattern": r"CNT-\d{4}-\d{4}", "transform": "lower"})
    assert clean("number CNT-2026-0041 (signed)", rules) == "cnt-2026-0041"
    assert clean("no number here", rules) is None


def test_a_label_anywhere_on_a_line_finds_the_title():
    outcome = _read_rules(field("title", "Title", labels=["subject of this amendment"], location="same_line"),
                          AMENDMENT, [], ["subject of this amendment"])
    assert outcome["reason"] == "found" and outcome["value"] == "Service availability schedule"


def test_a_heading_or_a_pattern_anywhere():
    heading = _read_rules(field("title", "Title", location="heading"), [], AMENDMENT, [])
    assert heading["value"] == "Amendment 2 - identifying record"
    number = _read_rules(field("contract_number", "Contract number", location="anywhere",
                               pattern=r"CNT-\d{4}-\d{4}"), [], AMENDMENT, [])
    assert number["value"] == "CNT-2026-0041"


def test_says_why_a_value_was_not_kept():
    several = _read_rules(field("date", "Date", location="anywhere", pattern=r"\d{4}-\d{2}-\d{2}|\d+ \w+ \d{4}",
                                transform="none"), [], AMENDMENT, [])
    assert several["reason"] == "several_values"
    first = _read_rules(field("date", "Date", location="anywhere", pattern=r"\d{4}-\d{2}-\d{2}|\d+ March \d{4}",
                              transform="date_iso", occurrence="first"), [], AMENDMENT, [])
    assert first["value"] == "2026-03-01"
    mismatch = _read_rules(field("title", "Title", labels=["subject of this amendment"], location="same_line",
                                 pattern=r"\d+"), AMENDMENT, [], ["subject of this amendment"])
    assert mismatch["reason"] == "pattern_mismatch" and mismatch["values"] == ["Service availability schedule"]
    missing = _read_rules(field("status", "Status"), AMENDMENT, [], ["Status"])
    assert missing["reason"] == "label_not_found"


def test_ai_reads_a_short_document_whole_and_a_long_one_by_field():
    settings = normalize_ai_settings({"longDocumentCharacters": 1000, "blocksPerField": 1})
    blocks, sent = _select_ai_blocks(AMENDMENT, [field("title", "Title")], settings)
    assert len(blocks) == 3 and sent["longDocument"] is False
    filler = [section(10 + index, f"Clause {index}", ("x " * 400, 3, "text/text")) for index in range(5)]
    document = AMENDMENT + filler + [section(99, "Penalties", ("The penalty is 5%.", 9, "text/text"))]
    blocks, sent = _select_ai_blocks(document, [field("penalty", "Penalty")], settings)
    assert sent["longDocument"] is True
    # The opening of the document, and the one block about penalties.
    assert [block["content"] for block, _ in blocks][-1] == "The penalty is 5%."
    assert len(blocks) == 4
    tight = normalize_ai_settings({"maxCharacters": 2000})
    blocks, sent = _select_ai_blocks(document, [field("penalty", "Penalty")], tight)
    assert sent["charactersSent"] <= 2000
