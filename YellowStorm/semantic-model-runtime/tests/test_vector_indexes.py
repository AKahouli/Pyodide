"""Sizing and fallback of the bulk HNSW index build (``app/persistence/vector_indexes.py``)."""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any

import asyncpg
import pytest

from app.persistence import vector_indexes

INDEX_ID = "0b6f1d2e-0000-4000-8000-00000000000a"


def test_memory_follows_the_rows_within_the_bounds(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SEMANTIC_SEARCH_VECTOR_INDEX_MAX_MEMORY_MB", raising=False)
    assert vector_indexes.memory_for(0) == vector_indexes.MIN_MEMORY_MB
    assert vector_indexes.memory_for(25_000) == 25_000 * vector_indexes.BYTES_PER_ROW * 5 // 4 // (1024 * 1024) + 1
    assert vector_indexes.memory_for(10_000_000) == vector_indexes.DEFAULT_MAX_MEMORY_MB
    monkeypatch.setenv("SEMANTIC_SEARCH_VECTOR_INDEX_MAX_MEMORY_MB", "512")
    assert vector_indexes.memory_for(10_000_000) == 512


def test_workers_come_from_the_environment_and_ignore_garbage(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SEMANTIC_SEARCH_VECTOR_INDEX_WORKERS", raising=False)
    assert vector_indexes.parallel_workers() == vector_indexes.DEFAULT_PARALLEL_WORKERS
    monkeypatch.setenv("SEMANTIC_SEARCH_VECTOR_INDEX_WORKERS", "0")
    assert vector_indexes.parallel_workers() == 0
    monkeypatch.setenv("SEMANTIC_SEARCH_VECTOR_INDEX_WORKERS", "many")
    assert vector_indexes.parallel_workers() == vector_indexes.DEFAULT_PARALLEL_WORKERS


def test_index_names_are_deterministic_and_fit_an_identifier() -> None:
    names = {table: vector_indexes.vector_index_name(table, INDEX_ID) for table in vector_indexes.VECTOR_TABLES}
    assert names == {table: vector_indexes.vector_index_name(table, INDEX_ID.upper()) for table in names}
    assert all(len(name) <= 63 and name.endswith("_hnsw") for name in names.values()) and len(set(names.values())) == 2


class Connection:
    def __init__(self, fail_parallel: bool) -> None:
        self.fail_parallel = fail_parallel
        self.statements: list[str] = []

    async def fetch(self, sql: str, *args: Any) -> list[dict[str, str]]:
        return []

    async def fetchval(self, sql: str, *args: Any) -> int:
        return 3

    async def execute(self, sql: str, *args: Any, **kwargs: Any) -> None:
        self.statements.append(sql)
        if self.fail_parallel and "SET (parallel_workers" in sql:
            raise asyncpg.exceptions.DiskFullError("could not resize shared memory segment")

    @asynccontextmanager
    async def transaction(self):  # type: ignore[no-untyped-def]
        yield


class Pool:
    def __init__(self, fail_parallel: bool = False) -> None:
        self.connection = Connection(fail_parallel)

    @asynccontextmanager
    async def acquire(self):  # type: ignore[no-untyped-def]
        yield self.connection


@pytest.mark.asyncio
async def test_a_bulk_build_is_parallel_and_resets_the_table_setting() -> None:
    pool = Pool()
    assert await vector_indexes.build_vector_indexes(pool, INDEX_ID, workers=3) == {"entity_documents": 3, "entity_passages": 3}
    statements = pool.connection.statements
    assert sum("SET (parallel_workers = 3)" in sql for sql in statements) == 2
    assert sum("RESET (parallel_workers)" in sql for sql in statements) == 2
    assert sum("USING hnsw (embedding halfvec_cosine_ops)" in sql for sql in statements) == 2


@pytest.mark.asyncio
async def test_a_host_without_shared_memory_builds_without_workers() -> None:
    pool = Pool(fail_parallel=True)
    assert await vector_indexes.build_vector_indexes(pool, INDEX_ID, workers=4) == {"entity_documents": 3, "entity_passages": 3}
    statements = pool.connection.statements
    assert sum("USING hnsw" in sql for sql in statements) == 2 and not any("RESET (parallel_workers)" in sql for sql in statements)
    # Once it failed, the passages' index is not tried in parallel again.
    assert sum("SET (parallel_workers" in sql for sql in statements) == 1


@pytest.mark.asyncio
async def test_no_workers_means_no_table_setting() -> None:
    pool = Pool()
    await vector_indexes.build_vector_indexes(pool, INDEX_ID, workers=0)
    assert not any("parallel_workers = " in sql for sql in pool.connection.statements)
