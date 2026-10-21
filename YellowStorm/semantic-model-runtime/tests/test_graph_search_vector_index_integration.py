"""A generation's HNSW indexes are built once, in bulk, before it is ready (migration 037).

On a real Postgres (pgvector, pg_trgm): the partitions are filled with no vector index to maintain, the
indexes come last, a build interrupted around that step resumes to the same result, vectors carried from
the previous generation are the very ones it stored (the embedding model is asked only for changed
records), and a generation that is not ready is never searched.
Needs SEMANTIC_RUNTIME_TEST_DATABASE_URL (its semantic_* schemas are dropped and rebuilt).
"""

from __future__ import annotations

import asyncio
from typing import Any

import asyncpg
import pytest

from app.graph_search import indexer
from app.graph_search.embeddings import vector_literal
from app.graph_search.retrieval import find_seeds
from app.persistence import graph_search_store as search_store
from app.persistence import vector_indexes
from tests.test_graph_search_incremental_integration import (  # noqa: F401  (pool is a fixture)
    DSN, PROFILE, Embedder, World, assert_same_as_a_full_build, build, pool, search, snapshot, store_revision, word_vector)

pytestmark = pytest.mark.skipif(not DSN, reason="SEMANTIC_RUNTIME_TEST_DATABASE_URL not set")


async def hnsw_indexes(pool: asyncpg.Pool, table: str) -> list[str]:
    """Names of the HNSW indexes on the table and on its partitions."""
    rows = await pool.fetch(
        "SELECT indexname FROM pg_indexes WHERE schemaname = 'semantic_graph_search' "
        "AND indexdef ILIKE '%USING hnsw%' AND (tablename = $1 OR tablename LIKE $1 || '\\_%') ORDER BY indexname", table)
    return [row["indexname"] for row in rows]


async def partition_hnsw(pool: asyncpg.Pool, table: str, index_id: str) -> list[str]:
    return [name for name in await hnsw_indexes(pool, table) if name == vector_indexes.vector_index_name(table, index_id)]


class Watching(Embedder):
    """Records whether the generation had a vector index each time the model was asked."""

    def __init__(self, pool: asyncpg.Pool) -> None:
        super().__init__()
        self.pool = pool
        self.indexed_at_call: list[int] = []

    async def indexes(self) -> int:
        return len(await hnsw_indexes(self.pool, "entity_documents")) + len(await hnsw_indexes(self.pool, "entity_passages"))

    async def __call__(self, profile: Any, texts: list[str]) -> list[list[float]]:
        self.indexed_at_call.append(await self.indexes())
        return await super().__call__(profile, texts)


@pytest.mark.asyncio
async def test_a_generation_is_filled_without_vector_indexes_and_indexed_once_at_the_end(pool: asyncpg.Pool) -> None:
    # No HNSW index on the parents (so none is created on a partition when it is attached), nor on a new partition.
    assert await hnsw_indexes(pool, "entity_documents") == [] and await hnsw_indexes(pool, "entity_passages") == []
    embedder = Watching(pool)
    index_id, outcome = await build(pool, await store_revision(pool, "one", World()), embedder)
    assert outcome["state"] == "ready" and embedder.indexed_at_call
    assert set(embedder.indexed_at_call) == {0}, "the model was asked while an index was already maintained"
    for table in vector_indexes.VECTOR_TABLES:
        assert await partition_hnsw(pool, table, index_id) == [vector_indexes.vector_index_name(table, index_id)]
    # The planner serves the nearest-neighbour search from the partition's own index.
    vector = vector_literal(word_vector("Subject 3"))
    async with pool.acquire() as connection:
        await connection.execute("SET enable_seqscan = off")
        await connection.execute("SET enable_sort = off")
        plan = " | ".join(row[0] for row in await connection.fetch(
            "EXPLAIN SELECT entity_id FROM semantic_graph_search.entity_documents WHERE index_id = $1::uuid "
            "ORDER BY embedding <=> $2::text::halfvec LIMIT 5", index_id, vector))
    assert f"Index Scan using {vector_indexes.vector_index_name('entity_documents', index_id)}" in plan, plan[:300]


@pytest.mark.asyncio
async def test_an_incremental_build_reuses_the_stored_vectors_and_asks_the_model_only_for_changed_records(pool: asyncpg.Pool) -> None:
    world = World(messages=60)
    first, outcome = await build(pool, await store_revision(pool, "one", world), Embedder())
    assert outcome["state"] == "ready"
    edited = world.copy()
    edited.messages["message:030"]["subject"] = "A different subject"
    embedder = Watching(pool)
    others = await embedder.indexes()  # the first generation's own, which serves meanwhile
    second, outcome = await build(pool, await store_revision(pool, "two", edited), embedder)
    assert (outcome["state"], outcome["mode"], outcome["rebuilt"], outcome["embedded"]) == ("ready", "incremental", 1, 1)
    assert len(embedder.texts) == 1 and "A different subject" in embedder.texts[0]
    assert set(embedder.indexed_at_call) == {others}, "the new generation had an index while it was filled"

    before, after = await snapshot(pool, first), await snapshot(pool, second)
    carried = [row for row in after["documents"] if row["entity_id"] != "message:030"]
    assert len(carried) == len(after["documents"]) - 1 and len(carried) > 50
    previous = {row["entity_id"]: row for row in before["documents"]}
    # Byte-identical vectors: the text form of the stored halfvec, row by row.
    assert all(row["embedding"] is not None and row["embedding"] == previous[row["entity_id"]]["embedding"]
               for row in carried)
    previous_passages = {(row["entity_id"], row["ordinal"]): row for row in before["passages"]}
    carried_passages = [row for row in after["passages"] if row["entity_id"] != "message:030"]
    assert carried_passages and all(row["embedding"] == previous_passages[(row["entity_id"], row["ordinal"])]["embedding"]
                                    for row in carried_passages)
    assert (await pool.fetchval("SELECT embedded_count FROM semantic_graph_search.index_generations WHERE index_id = $1::uuid", second)) == 1
    await assert_same_as_a_full_build(pool, second, edited)
    # Both generations have their own index; the first one still serves.
    for index_id in (first, second):
        for table in vector_indexes.VECTOR_TABLES:
            assert await partition_hnsw(pool, table, index_id) != []
    assert await search(pool, first, "Subject 3") is not None


@pytest.mark.asyncio
async def test_a_build_that_crashes_while_indexing_resumes_without_embedding_again(pool: asyncpg.Pool, monkeypatch: pytest.MonkeyPatch) -> None:
    world = World(messages=40)
    await build(pool, await store_revision(pool, "one", world), Embedder())
    edited = world.copy()
    edited.messages["message:020"]["body"] = "Rewritten body"
    revision = await store_revision(pool, "two", edited)

    original = search_store.build_vector_indexes

    async def crash(pool_: Any, index_id: Any, **kwargs: Any) -> dict[str, int]:
        raise RuntimeError("the worker died while indexing")

    monkeypatch.setattr(search_store, "build_vector_indexes", crash)
    embedder = Embedder()
    with pytest.raises(RuntimeError, match="died while indexing"):
        await build(pool, revision, embedder)
    generation = await pool.fetchrow("SELECT index_id::text, state FROM semantic_graph_search.index_generations "
                                     "WHERE data_revision_id = $1 AND state <> 'ready'", revision[0])
    assert generation["state"] == "indexing"
    index_id = generation["index_id"]
    assert not await vector_indexes.existing_vector_indexes_of(pool, index_id)
    stored = await pool.fetch("SELECT entity_id, embedding::text AS embedding FROM semantic_graph_search.entity_documents "
                              "WHERE index_id = $1::uuid ORDER BY entity_id", index_id)
    assert len(embedder.texts) > 0 and all(row["embedding"] for row in stored)

    monkeypatch.setattr(search_store, "build_vector_indexes", original)
    resumed = Embedder()
    _, outcome = await build(pool, revision, resumed, index_id=index_id)
    assert outcome["state"] == "ready" and resumed.texts == []
    assert await pool.fetch("SELECT entity_id, embedding::text AS embedding FROM semantic_graph_search.entity_documents "
                            "WHERE index_id = $1::uuid ORDER BY entity_id", index_id) == stored
    for table in vector_indexes.VECTOR_TABLES:
        assert len(await partition_hnsw(pool, table, index_id)) == 1
    await assert_same_as_a_full_build(pool, index_id, edited)


@pytest.mark.asyncio
async def test_building_the_vector_indexes_twice_changes_nothing(pool: asyncpg.Pool) -> None:
    index_id, _ = await build(pool, await store_revision(pool, "one", World(messages=20)), Embedder())
    again = await vector_indexes.build_vector_indexes(pool, index_id)
    assert again == {"entity_documents": 0, "entity_passages": 0}
    assert await vector_indexes.existing_vector_indexes_of(pool, index_id) == set(vector_indexes.VECTOR_TABLES)


@pytest.mark.asyncio
async def test_a_build_asked_to_stop_while_indexing_ends_cancelled_without_a_ready_generation(
        pool: asyncpg.Pool, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(indexer, "VECTOR_INDEX_HEARTBEAT_SECONDS", 0.05)

    async def slow(pool_: Any, index_id: Any, **kwargs: Any) -> dict[str, int]:
        await asyncio.sleep(30)
        return {}

    monkeypatch.setattr(search_store, "build_vector_indexes", slow)
    stop = False

    class Stopper(Embedder):
        async def __call__(self, profile: Any, texts: list[str]) -> list[list[float]]:
            nonlocal stop
            stop = True
            return await super().__call__(profile, texts)

    async def should_stop() -> bool:
        return stop

    index_id, outcome = await build(pool, await store_revision(pool, "one", World(messages=10)), Stopper(),
                                    should_stop=should_stop)
    assert outcome == {"state": "cancelled"}
    generation = await search_store.get_generation_by_id(pool, index_id)
    assert generation is not None and (generation["state"], generation["last_error_code"]) == ("failed", "cancelled")


@pytest.mark.asyncio
async def test_a_generation_that_is_not_ready_is_never_searched(pool: asyncpg.Pool, monkeypatch: pytest.MonkeyPatch) -> None:
    index_id, _ = await build(pool, await store_revision(pool, "one", World(messages=20)), Embedder())
    generation = await search_store.get_generation_by_id(pool, index_id)
    assert generation is not None

    async def forbidden(*args: Any, **kwargs: Any) -> list[Any]:
        raise AssertionError("a generation that is not ready was queried")

    for name in ("vector_candidates", "vector_passage_candidates", "lexical_candidates", "lexical_passage_candidates"):
        monkeypatch.setattr(search_store, name, forbidden)
    for state in ("queued", "indexing", "failed"):
        found = await find_seeds(
            pool, revision_id=generation["data_revision_id"], compiled={"concepts": {}, "relations": {}},
            query="Subject 3", concept_ids=None, limit=5, allowed_workspaces=None,
            generation={**generation, "state": state}, profile=PROFILE)
        assert found["modeUsed"] == "exact_only", state


@pytest.mark.asyncio
async def test_cancelling_the_index_build_leaves_no_index_and_a_usable_pool(pool: asyncpg.Pool) -> None:
    """The statement is cancelled on the server and rolled back: no half-built index, the pool still serves,
    and the build can be started again."""
    revision_id, spec_hash = await store_revision(pool, "one", World(messages=10))
    index_id = (await search_store.create_generation(
        pool, model_id="m-incremental", data_revision_id=revision_id, projection_ref="projection",
        spec_hash=spec_hash, fingerprint="fp-cancel"))["index_id"]
    # Enough random vectors that the bulk build takes a few seconds on its own.
    await pool.execute(
        "INSERT INTO semantic_graph_search.entity_documents (index_id, entity_id, concept_id, label, label_key, "
        "search_text, lexical, content_hash, embedding, status) "
        "SELECT $1::uuid, 'e' || g, 'c', 'A', 'a', 'a', to_tsvector('simple', 'a'), $2, "
        "(SELECT array_agg(random() - 0.5) FROM generate_series(1, 3072) WHERE g > 0)::vector(3072)::halfvec, 'ready' "
        "FROM generate_series(1, 4000) g", index_id, "sha256:" + "a" * 64)
    building = asyncio.ensure_future(vector_indexes.build_vector_indexes(pool, index_id, workers=0))
    await asyncio.sleep(1.0)
    assert not building.done()
    building.cancel()
    with pytest.raises(asyncio.CancelledError):
        await building
    assert await pool.fetchval("SELECT 1") == 1
    assert not await vector_indexes.existing_vector_indexes_of(pool, index_id)
    assert await vector_indexes.build_vector_indexes(pool, index_id, workers=0) == {"entity_documents": 4000, "entity_passages": 0}
