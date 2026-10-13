"""HNSW vector indexes of a search index generation (migration 037).

A generation's partitions (``partitions.GENERATION_TABLES``) are created without a vector index. The build
fills them (cards, passages, carried and embedded vectors) with no index to maintain, then builds each
HNSW index once, in bulk, before the generation is declared ready. A row-by-row insert into HNSW costs a
graph search per row; a bulk build does the same work in memory, in parallel, and without the page and WAL
traffic of a live index.

The indexes live on the partitions, not on the parent tables: an index on the parent would be created on
every new partition at attach time (empty, but then maintained for every row written). The planner uses a
partition's own indexes after pruning to it, so searches are unchanged. Only a ready generation is searched
(``retrieval.find_seeds``); a generation without its indexes is never ready.

``build_vector_indexes`` is idempotent (``IF NOT EXISTS`` on a deterministic name), so a build that stops
after, or during, the indexing resumes without redoing what exists: a statement stopped midway leaves no
index (a plain ``CREATE INDEX`` is transactional).
"""

from __future__ import annotations

import logging
import os
from typing import Any

import asyncpg

from app.persistence.partitions import generation_key, partition_name

logger = logging.getLogger(__name__)

SCHEMA = "semantic_graph_search"
VECTOR_TABLES = ("entity_documents", "entity_passages")
HNSW_OPTIONS = "m = 16, ef_construction = 64"

# A graph held in memory while it is built is what makes a bulk build fast: past maintenance_work_mem
# pgvector keeps building on disk, several times slower. Bytes per indexed row: the 2,560-dimension halfvec
# (5 KB), the element's neighbours and page overhead. The memory asked for is the estimate with headroom, within
# [MIN_MEMORY_MB, max]; ``SEMANTIC_SEARCH_VECTOR_INDEX_MAX_MEMORY_MB`` caps what a build may take.
BYTES_PER_ROW = 6_500
MIN_MEMORY_MB = 128
DEFAULT_MAX_MEMORY_MB = 2048
# The server grants what max_parallel_workers allows; the build scales almost linearly with them.
DEFAULT_PARALLEL_WORKERS = 8
# A single CREATE INDEX cannot be chunked: the worker's short statement timeout does not apply to it.
DEFAULT_TIMEOUT_S = 3600


def _env_int(name: str, default: int) -> int:
    try:
        return max(0, int(os.environ.get(name, "")))
    except ValueError:
        return default


def max_memory_mb() -> int:
    return _env_int("SEMANTIC_SEARCH_VECTOR_INDEX_MAX_MEMORY_MB", DEFAULT_MAX_MEMORY_MB) or DEFAULT_MAX_MEMORY_MB


def parallel_workers() -> int:
    """Workers a bulk index build may use (0: the session alone). Parallel builds share memory with the
    server (dynamic shared memory): a host with little ``/dev/shm`` sets this to 0."""
    return _env_int("SEMANTIC_SEARCH_VECTOR_INDEX_WORKERS", DEFAULT_PARALLEL_WORKERS)


def memory_for(rows: int, ceiling_mb: int | None = None) -> int:
    """Megabytes of maintenance_work_mem to build an index over ``rows`` vectors in memory."""
    wanted = rows * BYTES_PER_ROW * 5 // 4 // (1024 * 1024) + 1
    return max(MIN_MEMORY_MB, min(wanted, ceiling_mb or max_memory_mb()))


def vector_index_name(table: str, index_id: Any) -> str:
    """Deterministic name of the HNSW index of a generation's partition of ``table``."""
    return f"{partition_name(table, generation_key(index_id))}_hnsw"


def _qualified(name: str) -> str:
    return f'"{SCHEMA}"."{name}"'


async def existing_vector_indexes(connection: Any, index_id: Any) -> set[str]:
    """The tables whose partition of this generation already has its vector index."""
    rows = await connection.fetch(
        "SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND indexname = ANY($2::text[])",
        SCHEMA, [vector_index_name(table, index_id) for table in VECTOR_TABLES])
    present = {row["indexname"] for row in rows}
    return {table for table in VECTOR_TABLES if vector_index_name(table, index_id) in present}


async def existing_vector_indexes_of(pool: Any, index_id: Any) -> set[str]:
    async with pool.acquire() as connection:
        return await existing_vector_indexes(connection, index_id)


async def _create(pool: Any, index_id: Any, table: str, *, timeout_s: int, workers: int) -> int:
    """One index, in its own transaction; returns the vectors indexed. A bulk build is parallel only when
    the table's ``parallel_workers`` says so: the vectors live in TOAST, so the heap itself is far too
    small for the planner to ask for workers. The table setting is reset with the index in place."""
    partition = _qualified(partition_name(table, generation_key(index_id)))
    async with pool.acquire() as connection:
        async with connection.transaction():
            rows = int(await connection.fetchval(f"SELECT count(*) FROM {partition} WHERE embedding IS NOT NULL"))
            await connection.execute(f"SET LOCAL statement_timeout = '{int(timeout_s)}s'")
            await connection.execute("SELECT set_config('maintenance_work_mem', $1, true), "
                                     "set_config('max_parallel_maintenance_workers', $2, true)",
                                     f"{memory_for(rows)}MB", str(workers))
            if workers:
                await connection.execute(f"ALTER TABLE {partition} SET (parallel_workers = {int(workers)})")
            await connection.execute(
                f'CREATE INDEX IF NOT EXISTS "{vector_index_name(table, index_id)}" ON {partition} '
                f"USING hnsw (embedding halfvec_cosine_ops) WITH ({HNSW_OPTIONS})",
                # The pool's command timeout (a few seconds) is for short statements: the server's
                # statement timeout above bounds this one.
                timeout=timeout_s + 60)
            if workers:
                await connection.execute(f"ALTER TABLE {partition} RESET (parallel_workers)")
            return rows


async def build_vector_indexes(pool: Any, index_id: Any, *, timeout_s: int = DEFAULT_TIMEOUT_S,
                               workers: int | None = None) -> dict[str, int]:
    """Create the HNSW index of each of the generation's partitions that does not have it. Returns the
    vectors indexed per table (0 for a table already indexed). Each index is its own transaction, sized
    to its rows (memory) and run by ``parallel_workers()`` workers; a host that cannot give the shared
    memory a parallel build needs builds it with the session alone."""
    indexed: dict[str, int] = {}
    workers = parallel_workers() if workers is None else workers
    for table in VECTOR_TABLES:
        async with pool.acquire() as connection:
            if table in await existing_vector_indexes(connection, index_id):
                indexed[table] = 0
                continue
        try:
            indexed[table] = await _create(pool, index_id, table, timeout_s=timeout_s, workers=workers)
        except asyncpg.exceptions.InsufficientResourcesError as error:
            if not workers:
                raise
            logger.warning("Parallel vector index build failed (%s); building without workers", type(error).__name__)
            workers = 0
            indexed[table] = await _create(pool, index_id, table, timeout_s=timeout_s, workers=0)
    return indexed


__all__ = ["VECTOR_TABLES", "build_vector_indexes", "existing_vector_indexes", "existing_vector_indexes_of", "memory_for",
           "vector_index_name"]
