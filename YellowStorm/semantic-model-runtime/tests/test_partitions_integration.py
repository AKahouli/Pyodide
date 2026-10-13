"""The per-revision tables are partitioned (migration 031) on a real Postgres: a revision and a search
generation get partitions when they are created, clearing a model drops them (the published revision's
stay), a lock held by a reader is waited for, not failed on.

Needs SEMANTIC_RUNTIME_TEST_DATABASE_URL (its runtime schemas are dropped and rebuilt).
"""

from __future__ import annotations

import asyncio
import os
from pathlib import Path

import asyncpg
import pytest
import pytest_asyncio

from app.persistence import graph_search_store as search_store
from app.persistence import partitions
from app.persistence import population_store as store

DSN = os.environ.get("SEMANTIC_RUNTIME_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DSN, reason="SEMANTIC_RUNTIME_TEST_DATABASE_URL not set")
ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = sorted((ROOT / "migrations").glob("*.sql"))
SCHEMAS = ("semantic_jobs", "semantic_datasource", "semantic_runtime", "semantic_population",
           "semantic_graph_search", "semantic_model")
SPEC_HASH = "sha256:" + "a" * 64
FINGERPRINT = "sha256:" + "b" * 64
TABLES = tuple(f"semantic_population.{table.name}" for table in partitions.REVISION_TABLES)
SEARCH_TABLES = tuple(f"semantic_graph_search.{table.name}" for table in partitions.GENERATION_TABLES)


@pytest_asyncio.fixture
async def pool():
    assert DSN
    connection = await asyncpg.connect(DSN)
    try:
        for schema in SCHEMAS:
            await connection.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
        for migration in MIGRATIONS:
            await connection.execute(migration.read_text(encoding="utf-8"))
    finally:
        await connection.close()
    value = await asyncpg.create_pool(DSN, min_size=1, max_size=6)
    yield value
    await value.close()


async def partition_count(pool: asyncpg.Pool, table: str) -> int:
    return await pool.fetchval(
        "SELECT count(*) FROM pg_inherits WHERE inhparent = $1::regclass", table)


async def partition_counts(pool: asyncpg.Pool, tables: tuple[str, ...]) -> set[int]:
    """How many partitions each of the tables has (one value when they all agree)."""
    return {await partition_count(pool, table) for table in tables}


async def revision_with_rows(pool: asyncpg.Pool, model_id: str, label: str) -> str:
    """A revision of the model with one record, one fact, one link, one alias and one candidate."""
    revision = store.revision_id_for("v1", FINGERPRINT, [label], 0)
    await store.create_data_revision(
        pool, revision_id=revision, model_id=model_id, model_version_id="v1", spec_hash=SPEC_HASH,
        execution_fingerprint=FINGERPRINT, source_observations=[], correction_sequence=0, coverage={})
    entities = [{"entityId": f"{label}:{n}", "conceptId": "c", "namespace": "ns", "identity": {}, "label": "x",
                 "attributes": {}, "provenance": {}} for n in (1, 2)]
    await store.store_entities(pool, model_id=model_id, revision_id=revision, entities=entities)
    served = {"entityId": f"{label}:1", "attribute": "name", "value": "X", "origin": "source", "evidence": {}}
    other = {**served, "value": "Y", "evidence": {"blockPk": 3}}
    await store.store_assertions(pool, model_id=model_id, revision_id=revision, assertions=[served, other])
    await store.store_relationships(pool, model_id=model_id, revision_id=revision, relationships=[
        {"relationId": "r", "sourceEntityId": f"{label}:1", "targetEntityId": f"{label}:2"}])
    await store.store_entity_aliases(pool, revision_id=revision, aliases=[
        {"entityId": f"{label}:1", "aliasNamespace": "ns", "aliasKey": label}])
    return revision


async def generation_with_rows(pool: asyncpg.Pool, model_id: str, revision: str, fingerprint: str) -> str:
    generation = await search_store.create_generation(
        pool, model_id=model_id, data_revision_id=revision, projection_ref="age:v1:pop_x",
        spec_hash=SPEC_HASH, fingerprint=fingerprint)
    index_id = generation["index_id"]
    await pool.execute(
        "INSERT INTO semantic_graph_search.entity_documents (index_id, entity_id, concept_id, label, label_key, "
        "search_text, lexical, content_hash, status) VALUES ($1::uuid, 'e', 'c', 'A', 'a', 'a', "
        "to_tsvector('simple', 'a'), $2, 'exact_only')", index_id, SPEC_HASH)
    await pool.execute(
        "INSERT INTO semantic_graph_search.entity_passages (index_id, entity_id, ordinal, concept_id, field_key, "
        "start_offset, end_offset, passage_text, search_text, lexical, content_hash, status) VALUES "
        "($1::uuid, 'e', 0, 'c', 'body', 0, 1, 'a', 'a', to_tsvector('simple', 'a'), $2, 'pending')",
        index_id, SPEC_HASH)
    await pool.execute(
        "UPDATE semantic_graph_search.index_generations SET state = 'ready' WHERE index_id = $1::uuid", index_id)
    return index_id


@pytest.mark.asyncio
async def test_a_revision_and_a_generation_get_their_partitions_when_created(pool: asyncpg.Pool):
    revision = await revision_with_rows(pool, "m1", "a")
    for table in TABLES:
        assert await partition_count(pool, table) == 1, table
    # Creating the same revision again changes nothing.
    await store.create_data_revision(
        pool, revision_id=revision, model_id="m1", model_version_id="v1", spec_hash=SPEC_HASH,
        execution_fingerprint=FINGERPRINT, source_observations=[], correction_sequence=0, coverage={})
    assert await partition_counts(pool, TABLES) == {1}
    # A row of a revision without partitions is refused, not stored where a drop would miss it.
    await pool.execute("INSERT INTO semantic_population.data_revisions (id, model_id, model_version_id, spec_hash) "
                       "VALUES ('dr_bare', 'm1', 'v1', $1)", SPEC_HASH)
    with pytest.raises(asyncpg.exceptions.CheckViolationError):
        await pool.execute(
            "INSERT INTO semantic_population.entities (id, model_id, data_revision_id, concept_id, namespace, "
            "identity_key) VALUES ('e', 'm1', 'dr_bare', 'c', 'ns', 'k')")

    index_id = await generation_with_rows(pool, "m1", revision, "fp1")
    assert await partition_counts(pool, SEARCH_TABLES) == {1}
    again = await search_store.create_generation(
        pool, model_id="m1", data_revision_id=revision, projection_ref="age:v1:pop_x", spec_hash=SPEC_HASH,
        fingerprint="fp1")
    assert again["index_id"] == index_id
    assert await partition_counts(pool, SEARCH_TABLES) == {1}
    # The facts, the candidates and the links read as before.
    assert await store.count_revision_rows(pool, revision) == {"entities": 2, "assertions": 1, "relationships": 1}
    assert (await store.list_assertion_candidates(pool, revision, "a:1"))["name"][0]["value"] == "Y"


@pytest.mark.asyncio
async def test_purge_drops_the_partitions_of_unpublished_revisions_and_keeps_the_published_one(pool: asyncpg.Pool):
    published = await revision_with_rows(pool, "m1", "pub")
    old = await revision_with_rows(pool, "m1", "old")
    other_model = await revision_with_rows(pool, "m2", "oth")
    await pool.execute(
        "INSERT INTO semantic_runtime.active_bindings (model_id, environment, model_version_id, data_revision_id, "
        "projection_ref) VALUES ('m1', 'production', 'v1', $1, 'age:v1:pop_pub')", published)
    kept_index = await generation_with_rows(pool, "m1", published, "fp-pub")
    old_index = await generation_with_rows(pool, "m1", old, "fp-old")
    other_index = await generation_with_rows(pool, "m2", other_model, "fp-oth")
    assert await partition_count(pool, "semantic_population.entities") == 3

    result = await store.purge_model_data(pool, "m1")

    assert result["revisions"] == 1 and result["keptRevisions"] == 1 and result["resetGeneration"] == 1
    assert [row["id"] for row in await pool.fetch("SELECT id FROM semantic_population.data_revisions ORDER BY id")] \
        == sorted([published, other_model])
    for table in TABLES:
        assert await partition_count(pool, table) == 2, table
        remaining = await pool.fetch(
            f"SELECT DISTINCT data_revision_id FROM {table}")
        assert {row["data_revision_id"] for row in remaining} == {published, other_model}
    for table in SEARCH_TABLES:
        assert await partition_count(pool, table) == 2, table
        assert {row["index_id"] for row in await pool.fetch(f"SELECT DISTINCT index_id::text FROM {table}")} \
            == {kept_index, other_index}
    assert old_index not in {row["index_id"] for row in await pool.fetch(
        "SELECT index_id::text FROM semantic_graph_search.index_generations")}
    # Nothing but the cleared revision's own partitions went; the data it never owned is whole.
    assert await store.count_revision_rows(pool, published) == {"entities": 2, "assertions": 1, "relationships": 1}
    assert await pool.fetchval("SELECT count(*) FROM semantic_population.entity_identities") == 2

    # A second purge has nothing left to clear.
    again = await store.purge_model_data(pool, "m1")
    assert again["revisions"] == 0 and again["resetGeneration"] == 2
    assert await partition_counts(pool, TABLES) == {2}


@pytest.mark.asyncio
async def test_pruning_generations_drops_their_partitions(pool: asyncpg.Pool):
    revisions = [await revision_with_rows(pool, "m1", label) for label in ("a", "b", "c")]
    indexes = [await generation_with_rows(pool, "m1", revision, f"fp{n}") for n, revision in enumerate(revisions)]
    assert await search_store.prune_generations(pool, "m1", keep_recent=1) == 2
    left = await pool.fetch("SELECT index_id::text FROM semantic_graph_search.index_generations")
    assert len(left) == 1 and left[0]["index_id"] in indexes
    for table in SEARCH_TABLES:
        assert await partition_count(pool, table) == 1, table
        assert {row["index_id"] for row in await pool.fetch(f"SELECT DISTINCT index_id::text FROM {table}")} \
            == {left[0]["index_id"]}


@pytest.mark.asyncio
async def test_deleting_a_model_drops_its_partitions(pool: asyncpg.Pool):
    gone = await revision_with_rows(pool, "m1", "a")
    kept = await revision_with_rows(pool, "m2", "b")
    await generation_with_rows(pool, "m1", gone, "fp1")
    await generation_with_rows(pool, "m2", kept, "fp2")
    result = await store.delete_model(pool, "m1")
    assert result["deleted"]["semantic_population.entities"] == 1
    assert result["deleted"]["semantic_graph_search.entity_documents"] == 1
    assert await partition_counts(pool, TABLES + SEARCH_TABLES) == {1}
    assert await store.count_revision_rows(pool, kept) == {"entities": 2, "assertions": 1, "relationships": 1}


@pytest.mark.asyncio
async def test_a_purge_waits_for_a_reader_of_the_table_then_goes_through(
        pool: asyncpg.Pool, monkeypatch: pytest.MonkeyPatch):
    await revision_with_rows(pool, "m1", "a")
    monkeypatch.setattr(partitions, "LOCK_TIMEOUT_S", 1)
    monkeypatch.setattr(partitions, "_RETRY_PAUSE_S", 0.1)
    async with pool.acquire() as reader:
        async with reader.transaction():
            # A long query on the table: dropping a partition needs the table to itself.
            await reader.execute("LOCK TABLE semantic_population.entities IN ACCESS SHARE MODE")
            purge = asyncio.create_task(store.purge_model_data(pool, "m1"))
            await asyncio.sleep(1.8)
            assert not purge.done()
        result = await asyncio.wait_for(purge, 30)
    assert result["revisions"] == 1
    assert await partition_count(pool, "semantic_population.entities") == 0


@pytest.mark.asyncio
async def test_a_purge_that_cannot_get_the_lock_fails_and_changes_nothing(
        pool: asyncpg.Pool, monkeypatch: pytest.MonkeyPatch):
    await revision_with_rows(pool, "m1", "a")
    monkeypatch.setattr(partitions, "LOCK_TIMEOUT_S", 1)
    monkeypatch.setattr(partitions, "LOCK_ATTEMPTS", 2)
    monkeypatch.setattr(partitions, "_RETRY_PAUSE_S", 0.1)
    async with pool.acquire() as reader:
        async with reader.transaction():
            await reader.execute("LOCK TABLE semantic_population.entities IN ACCESS SHARE MODE")
            with pytest.raises(asyncpg.exceptions.LockNotAvailableError):
                await store.purge_model_data(pool, "m1")
    assert await pool.fetchval("SELECT count(*) FROM semantic_population.data_revisions") == 1
    assert await partition_count(pool, "semantic_population.entities") == 1
    assert await pool.fetchval("SELECT count(*) FROM semantic_population.model_data_resets") == 0
