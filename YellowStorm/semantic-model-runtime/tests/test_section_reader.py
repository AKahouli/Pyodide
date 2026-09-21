from __future__ import annotations

import pytest

from app.datasource.section_reader import (SectionReadError, analyze_outline, get_outline,
                                           read_evidence, read_sections, structural_closure)


class FakeConnection:
    def __init__(self, *, sections=None, blocks=None, evidence=None) -> None:
        self.sections = sections or []
        self.blocks = blocks or []
        self.evidence = evidence or []
        self.calls: list[tuple[str, tuple]] = []

    async def fetch(self, sql: str, *params):  # type: ignore[no-untyped-def]
        self.calls.append((sql, params))
        if "AS block_pk" in sql:
            return self.evidence
        if "FROM logical_blocks" in sql:
            return self.blocks
        if "FROM logical_sections" in sql:
            return self.sections[:params[-1]] if sql.endswith("LIMIT $2") else self.sections
        raise AssertionError(sql)


def _section(pk: int, key: str, parent, level: int = 0) -> dict:
    return {"id": pk, "section_id": key, "title": f"title-{key}", "level": level,
            "parent_section_id": parent}


def test_analyze_outline_normalizes_both_root_conventions():
    analyzed = analyze_outline([
        _section(1, "sec_1", "1"),          # self-referencing level-0 root
        _section(2, "sec_2", None, 1),      # NULL parent
        _section(3, "sec_3", "2", 2),       # child of 2
    ])
    assert analyzed["roots"] == [1, 2]
    assert analyzed["cycles"] == []
    parents = {s["sectionPk"]: s["parentSectionPk"] for s in analyzed["sections"]}
    assert parents == {1: None, 2: None, 3: 2}


def test_analyze_outline_reports_cycles_and_malformed_parents():
    analyzed = analyze_outline([_section(1, "sec_1", "2"), _section(2, "sec_2", "1")])
    assert analyzed["cycles"] == [[1, 2]]
    with pytest.raises(SectionReadError):
        analyze_outline([_section(1, "sec_1", "not-a-number")])


def test_structural_closure_includes_descendants_and_reports_missing():
    sections = analyze_outline([
        _section(1, "sec_1", None), _section(2, "sec_2", "1"), _section(3, "sec_3", "2"),
        _section(4, "sec_4", None),
    ])["sections"]
    closure = structural_closure(sections, [1, 99], include_descendants=True)
    assert closure["sectionPks"] == [1, 2, 3]
    assert closure["missingTargets"] == [99]
    direct = structural_closure(sections, [1], include_descendants=False)
    assert direct["sectionPks"] == [1]


@pytest.mark.asyncio
async def test_get_outline_is_bounded_and_flags_truncation():
    conn = FakeConnection(sections=[_section(1, "sec_1", None), _section(2, "sec_2", "1", 1)])
    outline = await get_outline(conn, document_pk=42)
    assert outline["documentPk"] == 42
    assert outline["roots"] == [1]
    assert outline["truncated"] is False

    small = FakeConnection(sections=[_section(1, "sec_1", None),
                                      _section(2, "sec_2", "1", 1)])
    outline = await get_outline(small, document_pk=42, max_nodes=1)
    assert outline["truncated"] is True
    assert [s["sectionPk"] for s in outline["sections"]] == [1]


@pytest.mark.asyncio
async def test_read_sections_groups_blocks_and_continuation():
    conn = FakeConnection(
        sections=[_section(1, "sec_1", None), _section(2, "sec_2", "1", 1)],
        blocks=[{"id": 10, "section_id": "sec_1", "block_id": "p1_b1", "block_type": "text",
                 "content": "hello", "page_number": 1},
                {"id": 11, "section_id": "sec_2", "block_id": "p2_b1", "block_type": "text",
                 "content": "world", "page_number": 2}],
    )
    result = await read_sections(conn, document_pk=42, section_pks=[1], include_descendants=True)
    assert [s["sectionPk"] for s in result["sections"]] == [1, 2]
    assert result["sections"][0]["blocks"][0]["blockKey"] == "p1_b1"
    assert result["sections"][1]["blocks"][0]["content"] == "world"
    assert result["coverage"]["directBlocksComplete"] is True
    assert result["coverage"]["outlineTruncated"] is False
    assert result["continuation"] is None


@pytest.mark.asyncio
async def test_read_sections_truncates_with_continuation_and_empty_is_not_absence():
    blocks = [{"id": i, "section_id": "sec_1", "block_id": f"b{i}", "block_type": "text",
               "content": "x", "page_number": 1} for i in range(1, 4)]
    conn = FakeConnection(sections=[_section(1, "sec_1", None)], blocks=blocks)
    result = await read_sections(conn, document_pk=42, section_pks=[1], max_blocks=2)
    assert result["coverage"]["directBlocksComplete"] is False
    assert result["continuation"] == "2"
    assert len(result["sections"][0]["blocks"]) == 2

    empty = FakeConnection(sections=[_section(1, "sec_1", None)], blocks=[])
    empty_result = await read_sections(empty, document_pk=42, section_pks=[1])
    assert empty_result["sections"][0]["blocks"] == []
    assert empty_result["coverage"]["directBlocksComplete"] is True


@pytest.mark.asyncio
async def test_read_evidence_maps_origin_and_bounds_text():
    conn = FakeConnection(evidence=[
        {"block_pk": 10, "block_key": "p1_b1", "section_key": "sec_1", "section_pk": 1,
         "block_type": "text/text", "content": "x" * 50, "page_number": 1},
        {"block_pk": 11, "block_key": "p2_b1", "section_key": "sec_2", "section_pk": 2,
         "block_type": "text/text/OCR", "content": "short", "page_number": 2},
    ])
    result = await read_evidence(conn, document_pk=42, block_pks=[10, 11, 99], max_chars=10)
    assert result["packets"][0]["origin"] == "native_text"
    assert result["packets"][0]["rawText"] == "x" * 10
    assert result["packets"][0]["truncated"] is True
    assert result["packets"][1]["origin"] == "ocr"
    assert result["packets"][1]["truncated"] is False
    assert result["packets"][0]["locator"] == {"documentPk": 42, "sectionPk": 1,
                                               "sectionKey": "sec_1", "blockPk": 10,
                                               "blockKey": "p1_b1", "pageNumber": 1}
    assert result["coverage"]["directBlocksComplete"] is False
    assert conn.calls[0][1] == (42, [10, 11, 99], 3)


@pytest.mark.asyncio
async def test_read_evidence_rejects_invalid_selection():
    conn = FakeConnection()
    with pytest.raises(SectionReadError):
        await read_evidence(conn, document_pk=42, block_pks=[])
    with pytest.raises(SectionReadError):
        await read_evidence(conn, document_pk=42, block_pks=[0])
    with pytest.raises(SectionReadError):
        await read_evidence(conn, document_pk=42, block_pks=[1], max_chars=99999)
    assert conn.calls == []


@pytest.mark.asyncio
async def test_read_sections_rejects_invalid_selection():
    conn = FakeConnection()
    with pytest.raises(SectionReadError):
        await read_sections(conn, document_pk=42, section_pks=[])
    with pytest.raises(SectionReadError):
        await read_sections(conn, document_pk=42, section_pks=[1], max_blocks=0)
    with pytest.raises(SectionReadError):
        await read_sections(conn, document_pk=42, section_pks=[1], offset=-1)
    assert conn.calls == []
