"""Migration 037 on a real Postgres: generations that exist before it keep (or get back) their vector index.

Up to migration 036 the HNSW indexes were defined on the parent tables, so every partition had one. 037 moves
them to the partitions, built when a generation is finished: a ready generation is searched, so it is indexed
by the migration itself; a generation still being built is indexed when its build ends.
Needs SEMANTIC_RUNTIME_TEST_DATABASE_URL (its semantic_* schemas are dropped and rebuilt).
"""

from __future__ import annotations

import os
from pathlib import Path

import asyncpg
import pytest

from app.persistence import graph_search_store as search_store
from app.persistence import vector_indexes
from tests.test_partitions_integration import FINGERPRINT, SCHEMAS, SPEC_HASH, revision_with_rows

DSN = os.environ.get("SEMANTIC_RUNTIME_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DSN, reason="SEMANTIC_RUNTIME_TEST_DATABASE_URL not set")
MIGRATIONS = sorted((Path(__file__).resolve().parents[1] / "migrations").glob("*.sql"))
MIGRATION = "037_graph_search_deferred_vector_index.sql"
VECTOR = "array_fill(0.01::real, ARRAY[2560])::vector(2560)::halfvec"


async def hnsw(connection: asyncpg.Connection) -> set[str]:
    rows = await connection.fetch(
        "SELECT indexname FROM pg_indexes WHERE schemaname = 'semantic_graph_search' AND indexdef ILIKE '%USING hnsw%'")
    return {row["indexname"] for row in rows}


async def generation_with_vectors(pool: asyncpg.Pool, revision: str, fingerprint: str, state: str) -> str:
    index_id = (await search_store.create_generation(
        pool, model_id="m1", data_revision_id=revision, projection_ref="age:v1:pop_x", spec_hash=SPEC_HASH,
        fingerprint=fingerprint))["index_id"]
    await pool.execute(
        "INSERT INTO semantic_graph_search.entity_documents (index_id, entity_id, concept_id, label, label_key, "
        f"search_text, lexical, content_hash, embedding, status) VALUES ($1::uuid, 'e', 'c', 'A', 'a', 'a', "
        f"to_tsvector('simple', 'a'), $2, {VECTOR}, 'ready')", index_id, SPEC_HASH)
    await pool.execute(
        "INSERT INTO semantic_graph_search.entity_passages (index_id, entity_id, ordinal, concept_id, field_key, "
        "start_offset, end_offset, passage_text, search_text, lexical, content_hash, embedding, status) VALUES "
        f"($1::uuid, 'e', 0, 'c', 'body', 0, 1, 'a', 'a', to_tsvector('simple', 'a'), $2, {VECTOR}, 'ready')",
        index_id, SPEC_HASH)
    await pool.execute("UPDATE semantic_graph_search.index_generations SET state = $2 WHERE index_id = $1::uuid",
                       index_id, state)
    return index_id


@pytest.mark.asyncio
async def test_ready_generations_keep_a_vector_index_and_the_parents_have_none() -> None:
    assert DSN
    connection = await asyncpg.connect(DSN)
    try:
        for schema in SCHEMAS:
            await connection.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
        for migration in MIGRATIONS:
            if migration.name < MIGRATION:
                await connection.execute(migration.read_text(encoding="utf-8"))
        pool = await asyncpg.create_pool(DSN, min_size=1, max_size=2)
        try:
            first = await revision_with_rows(pool, "m1", "a")
            second = await revision_with_rows(pool, "m1", "b")
            ready = await generation_with_vectors(pool, first, "fp-ready", "ready")
            building = await generation_with_vectors(pool, second, "fp-building", "indexing")
            before = await hnsw(connection)
            assert {"entity_documents_embedding_hnsw", "entity_passages_embedding_hnsw"} <= before

            await connection.execute((Path(__file__).resolve().parents[1] / "migrations" / MIGRATION)
                                     .read_text(encoding="utf-8"))
            after = await hnsw(connection)
            assert not {"entity_documents_embedding_hnsw", "entity_passages_embedding_hnsw"} & after
            assert after == {vector_indexes.vector_index_name(table, ready) for table in vector_indexes.VECTOR_TABLES}
            assert not await vector_indexes.existing_vector_indexes_of(pool, building)

            # The build that was under way ends with its own index; a new partition has none until then.
            assert await vector_indexes.build_vector_indexes(pool, building) == {"entity_documents": 1, "entity_passages": 1}
            assert await vector_indexes.existing_vector_indexes_of(pool, building) == set(vector_indexes.VECTOR_TABLES)
            third = await revision_with_rows(pool, "m1", "c")
            new = (await search_store.create_generation(
                pool, model_id="m1", data_revision_id=third, projection_ref="age:v1:pop_x", spec_hash=SPEC_HASH,
                fingerprint=FINGERPRINT))["index_id"]
            assert not await vector_indexes.existing_vector_indexes_of(pool, new)
            # The migration is safe to run again.
            await connection.execute((Path(__file__).resolve().parents[1] / "migrations" / MIGRATION)
                                     .read_text(encoding="utf-8"))
            assert await vector_indexes.existing_vector_indexes_of(pool, ready) == set(vector_indexes.VECTOR_TABLES)
        finally:
            await pool.close()
    finally:
        await connection.close()
