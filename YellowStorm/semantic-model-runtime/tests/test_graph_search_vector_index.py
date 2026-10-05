"""Meaning searches go through the HNSW indexes with iterative scans, so filters keep enough rows."""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

import pytest

from app.persistence import graph_search_store as store


class Connection:
    def __init__(self) -> None:
        self.statements: list[str] = []

    async def execute(self, sql: str) -> None:
        self.statements.append(sql)

    async def fetch(self, sql: str, *args):  # type: ignore[no-untyped-def]
        self.statements.append(sql)
        return [{"entity_id": "e1", "similarity": 0.9}] if "entity_documents" in sql else []

    @asynccontextmanager
    async def transaction(self):  # type: ignore[no-untyped-def]
        yield


class Pool:
    def __init__(self) -> None:
        self.connection = Connection()

    @asynccontextmanager
    async def acquire(self):  # type: ignore[no-untyped-def]
        yield self.connection


@pytest.mark.asyncio
async def test_record_search_walks_the_index_with_an_iterative_scan():
    pool = Pool()
    found = await store.vector_candidates(pool, "idx", "[0.1]", None, None, 50)
    assert found == [{"entityId": "e1", "similarity": 0.9}]
    settings, query = pool.connection.statements[:2], pool.connection.statements[2]
    assert settings == [f"SET LOCAL hnsw.ef_search = {store.MIN_EF_SEARCH}", "SET LOCAL hnsw.iterative_scan = relaxed_order"]
    # The inner ORDER BY is the distance alone: anything more and the index cannot serve it.
    assert "ORDER BY embedding <=> $4::text::halfvec LIMIT $5) nearest" in query


@pytest.mark.asyncio
async def test_passage_search_looks_at_several_passages_per_record_wanted():
    pool = Pool()
    await store.vector_passage_candidates(pool, "idx", "[0.1]", None, None, 50)
    assert pool.connection.statements[0] == f"SET LOCAL hnsw.ef_search = {50 * store.PASSAGES_SCANNED_PER_RECORD}"
    assert "ORDER BY embedding <=> $4::text::halfvec LIMIT $7" in pool.connection.statements[2]


def test_the_migration_indexes_both_tables_with_cosine_hnsw():
    sql = (Path(__file__).resolve().parents[1] / "migrations" / "026_graph_search_vector_index.sql").read_text(encoding="utf-8")
    for table in ("entity_documents", "entity_passages"):
        assert f"ON semantic_graph_search.{table}\n  USING hnsw (embedding halfvec_cosine_ops)" in sql
