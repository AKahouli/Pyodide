from __future__ import annotations

import pytest

from app.datasource.logical_search import (LogicalSearchError, combine_hits, search_exact,
                                           search_lexical)


class FakeConnection:
    def __init__(self, rows=None) -> None:
        self.rows = rows or []
        self.calls: list[tuple[str, tuple]] = []

    async def fetch(self, sql: str, *params):  # type: ignore[no-untyped-def]
        self.calls.append((sql, params))
        return self.rows


def _row(section_pk, section_key, block_pk=None, block_key=None, rank=None) -> dict:
    return {"section_pk": section_pk, "section_key": section_key, "section_title": f"t{section_key}",
            "block_pk": block_pk, "block_key": block_key, "block_type": "text",
            "page_number": 1, "rank": rank}


@pytest.mark.asyncio
async def test_exact_search_is_scoped_and_groups_block_hits_by_section():
    conn = FakeConnection(rows=[_row(1, "sec_1", 10, "p1_b1"), _row(1, "sec_1", 11, "p1_b2"),
                                _row(2, "sec_2")])
    result = await search_exact(conn, document_pk=42, value="AGR-2026-014")
    assert result["method"] == "exact"
    assert [h["sectionPk"] for h in result["hits"]] == [1, 2]
    assert [b["blockKey"] for b in result["hits"][0]["blocks"]] == ["p1_b1", "p1_b2"]
    assert result["truncated"] is False
    sql, params = conn.calls[0]
    assert params == (42, "AGR-2026-014", 26)
    assert "document_id = $1" in sql and "LIMIT $3" in sql


@pytest.mark.asyncio
async def test_exact_search_accepts_opaque_document_keys():
    conn = FakeConnection()
    result = await search_exact(conn, document_pk="doc-42", value="contract number")
    assert result["documentPk"] == "doc-42"
    assert conn.calls[0][1][0] == "doc-42"


@pytest.mark.asyncio
async def test_exact_search_flags_joined_row_limit_cut():
    conn = FakeConnection(rows=[_row(i, f"sec_{i}") for i in range(1, 27)])
    result = await search_exact(conn, document_pk=42, value="x", limit=25)
    assert result["truncated"] is True
    assert result["returnedHits"] == 25


@pytest.mark.asyncio
async def test_exact_search_rejects_invalid_inputs():
    conn = FakeConnection()
    with pytest.raises(LogicalSearchError):
        await search_exact(conn, document_pk=0, value="x")
    with pytest.raises(LogicalSearchError):
        await search_exact(conn, document_pk=42, value="   ")
    with pytest.raises(LogicalSearchError):
        await search_exact(conn, document_pk=42, value="x", limit=0)
    assert conn.calls == []


@pytest.mark.asyncio
async def test_lexical_search_fails_closed_without_capability():
    conn = FakeConnection()
    with pytest.raises(LogicalSearchError):
        await search_lexical(conn, document_pk=42, query="acme", capabilities={"lexical": False})
    assert conn.calls == []


@pytest.mark.asyncio
async def test_lexical_search_ranks_and_deduplicates_sections():
    conn = FakeConnection(rows=[_row(1, "sec_1", 10, "b1", rank=0.2),
                                _row(1, "sec_1", 11, "b2", rank=0.9),
                                _row(2, "sec_2", rank=0.5)])
    result = await search_lexical(conn, document_pk=42, query="acme",
                                  capabilities={"lexical": True})
    assert [h["sectionPk"] for h in result["hits"]] == [1, 2]
    assert result["hits"][0]["rank"] == 0.9
    assert result["truncated"] is False
    assert "plainto_tsquery($2)" in conn.calls[0][0]


@pytest.mark.asyncio
async def test_lexical_search_flags_joined_row_limit_cut():
    rows = [_row(i, f"sec_{i}", rank=0.1) for i in range(1, 27)]
    conn = FakeConnection(rows=rows)
    result = await search_lexical(conn, document_pk=42, query="x",
                                  capabilities={"lexical": True}, limit=25)
    assert result["truncated"] is True
    assert result["returnedHits"] == 25


def test_combine_hits_keeps_best_rank_per_section():
    exact = [{"sectionPk": 1, "rank": 1.0}, {"sectionPk": 2, "rank": 1.0}]
    lexical = [{"sectionPk": 1, "rank": 0.4}, {"sectionPk": 3, "rank": 0.8}]
    combined = combine_hits(exact, lexical)
    assert [h["sectionPk"] for h in combined] == [1, 2, 3]
    assert combined[0]["rank"] == 1.0
