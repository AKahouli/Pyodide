"""Incremental search index generations on a real Postgres (pgvector, pg_trgm).

A refresh builds its generation from the model's previous ready one: unchanged records are copied
inside the database, and only the changed ones (and the records that show their names) are built and
embedded. Only the embedding model is replaced, by a deterministic bag-of-words vector.
Needs SEMANTIC_RUNTIME_TEST_DATABASE_URL (its semantic_* schemas are dropped and rebuilt).
"""

from __future__ import annotations

import hashlib
import math
import os
import re
from pathlib import Path
from typing import Any

import asyncpg
import pytest
import pytest_asyncio

from app.graph_search import indexer
from app.graph_search.documents import lexical_query
from app.graph_search.embeddings import STORAGE_DIMENSION, EmbeddingProfile, vector_literal
from app.graph_search.settings import IndexSettings, index_fingerprint
from app.persistence import graph_search_store as search_store
from app.persistence import population_store as population

DSN = os.environ.get("SEMANTIC_RUNTIME_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DSN, reason="SEMANTIC_RUNTIME_TEST_DATABASE_URL not set")
MIGRATIONS = sorted((Path(__file__).resolve().parents[1] / "migrations").glob("*.sql"))

PROFILE = EmbeddingProfile(base_url="http://embeddings.invalid", api_key="", model="fake-words",
                           dimension=STORAGE_DIMENSION, batch_size=16, parallel_calls=2)
FINGERPRINT = index_fingerprint(PROFILE.fingerprint, IndexSettings())
MODEL, FULL_MODEL, VERSION = "m-incremental", "m-incremental-full", "v1"
WORKSPACE = "ws-1"
SHA = "sha256:" + "a" * 64
LONG_BODY = " ".join(f"Clause {n}: deliveries follow the usual schedule and the usual terms." for n in range(40))


def word_vector(text: str) -> list[float]:
    vector = [0.0] * STORAGE_DIMENSION
    for word in re.findall(r"[a-z0-9]+", text.lower()):
        vector[int(hashlib.sha1(word.encode()).hexdigest(), 16) % STORAGE_DIMENSION] += 1.0
    norm = math.sqrt(sum(value * value for value in vector)) or 1.0
    return [value / norm for value in vector]


class Embedder:
    """Counts the texts the model is asked for."""

    def __init__(self) -> None:
        self.texts: list[str] = []

    async def __call__(self, profile: Any, texts: list[str]) -> list[list[float]]:
        self.texts.extend(texts)
        return [word_vector(text) for text in texts]


def specification(*, message_label: str = "Message") -> dict[str, Any]:
    return {
        "modelId": MODEL, "modelVersionId": VERSION, "homeWorkspaceId": WORKSPACE,
        "concepts": [
            {"conceptId": "c-customer", "key": "customer", "label": "Customer",
             "identity": {"namespace": "crm", "keyComponents": ["customer_id"]},
             "populationMode": "materialized", "allowedFields": ["customer_id", "name"]},
            {"conceptId": "c-message", "key": "message", "label": message_label,
             "identity": {"namespace": "mail", "keyComponents": ["message_id"]},
             "populationMode": "materialized", "allowedFields": ["message_id", "subject", "body"]}],
        "relations": [{"relationId": "r-has-message", "key": "has_message", "label": "has message",
                       "sourceConceptId": "c-customer", "targetConceptId": "c-message",
                       "cardinality": "one_to_many", "matchingStrategy": "normalized"}]}


class World:
    """A population: customers, messages and the links between them."""

    def __init__(self, customers: int = 3, messages: int = 100) -> None:
        self.customers = {f"customer:{n}": f"Customer {n}" for n in range(customers)}
        self.messages = {f"message:{n:03d}": {"subject": f"Subject {n}", "body": LONG_BODY if n < 10 else f"Body of message {n}"}
                         for n in range(messages)}
        # customer 0 writes messages 0-4, customer 1 messages 5-9, customer 2 none.
        self.links = [(f"customer:{n // 5}", f"message:{n:03d}") for n in range(10)]

    def copy(self) -> "World":
        other = World(0, 0)
        other.customers = dict(self.customers)
        other.messages = {key: dict(value) for key, value in self.messages.items()}
        other.links = list(self.links)
        return other

    def entities(self) -> list[dict[str, Any]]:
        provenance = {"sources": [{"assetRef": {"workspaceId": WORKSPACE}}]}
        customers = [{"entityId": key, "conceptId": "c-customer", "namespace": "crm", "label": name,
                      "identity": {"customer_id": key}, "attributes": {"name": name}, "provenance": provenance}
                     for key, name in self.customers.items()]
        messages = [{"entityId": key, "conceptId": "c-message", "namespace": "mail", "label": key,
                     "identity": {"message_id": key}, "attributes": value, "provenance": provenance}
                    for key, value in self.messages.items()]
        return customers + messages

    def relationships(self) -> list[dict[str, Any]]:
        return [{"relationId": "r-has-message", "sourceEntityId": source, "targetEntityId": target,
                 "matchingStrategy": "normalized"} for source, target in self.links]


@pytest_asyncio.fixture
async def pool():
    assert DSN
    connection = await asyncpg.connect(DSN)
    try:
        for schema in ("semantic_jobs", "semantic_datasource", "semantic_runtime", "semantic_population",
                       "semantic_graph_search", "semantic_model"):
            await connection.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
        for migration in MIGRATIONS:
            await connection.execute(migration.read_text(encoding="utf-8"))
    finally:
        await connection.close()
    value = await asyncpg.create_pool(DSN, min_size=1, max_size=4)
    yield value
    await value.close()


async def store_revision(pool: asyncpg.Pool, name: str, world: World, *, model_id: str = MODEL,
                         spec: dict[str, Any] | None = None) -> tuple[str, str]:
    """A stored, valid revision of this population; returns (revision id, spec hash)."""
    spec = spec or specification()
    spec_hash = "sha256:" + hashlib.sha256(repr(sorted(spec["concepts"][1].items())).encode()).hexdigest()
    await population.mirror_specification(pool, home_workspace_id=WORKSPACE, model_id=model_id, model_version_id=VERSION,
                                          spec_hash=spec_hash, specification={**spec, "modelId": model_id})
    revision_id = population.revision_id_for(VERSION, SHA, [name, model_id], 0)
    await population.create_data_revision(
        pool, revision_id=revision_id, model_id=model_id, model_version_id=VERSION, spec_hash=spec_hash,
        execution_fingerprint=SHA, source_observations=[], correction_sequence=0, coverage={})
    await population.store_entities(pool, model_id=model_id, revision_id=revision_id, entities=world.entities())
    await population.store_relationships(pool, model_id=model_id, revision_id=revision_id,
                                         relationships=world.relationships())
    return revision_id, spec_hash


async def build(pool: asyncpg.Pool, revision: tuple[str, str], embedder: Embedder, *, model_id: str = MODEL,
                should_stop: Any = None, reports: list[dict[str, Any]] | None = None,
                index_id: str | None = None) -> tuple[str, dict[str, Any]]:
    revision_id, spec_hash = revision
    if index_id is None:
        index_id = (await search_store.create_generation(
            pool, model_id=model_id, data_revision_id=revision_id, projection_ref="projection",
            spec_hash=spec_hash, fingerprint=FINGERPRINT, vector_fingerprint=PROFILE.vector_fingerprint))["index_id"]

    async def report(progress: dict[str, Any]) -> None:
        if reports is not None:
            reports.append(progress)

    outcome = await indexer.build_index(pool, index_id=index_id, owner="worker", report=report, profile=PROFILE,
                                        embedder=embedder, should_stop=should_stop)
    return index_id, outcome


async def snapshot(pool: asyncpg.Pool, index_id: str) -> dict[str, list[Any]]:
    """Everything searched in a generation, vectors included, in a form that compares across generations."""
    documents = await pool.fetch(
        "SELECT entity_id, concept_id, label, label_key, source_workspaces, search_text, lexical::text AS lexical, "
        "content_hash, status, diagnostics::text AS diagnostics, source_digest, embedding::text AS embedding "
        "FROM semantic_graph_search.entity_documents WHERE index_id = $1::uuid ORDER BY entity_id", index_id)
    passages = await pool.fetch(
        "SELECT entity_id, ordinal, concept_id, field_key, field_label, start_offset, end_offset, passage_text, "
        "search_text, lexical::text AS lexical, content_hash, status, source_workspaces, embedding::text AS embedding "
        "FROM semantic_graph_search.entity_passages WHERE index_id = $1::uuid ORDER BY entity_id, ordinal", index_id)
    return {"documents": [dict(row) for row in documents], "passages": [dict(row) for row in passages]}


async def search(pool: asyncpg.Pool, index_id: str, query: str) -> dict[str, Any]:
    vector = vector_literal(word_vector(query))
    nearest = await search_store.vector_candidates(pool, index_id, vector, None, None, 25)
    # Records tied with the last one kept are cut at random by the approximate index: leave that tie out.
    floor = nearest[-1]["similarity"] if nearest else 0.0
    return {"lexical": await search_store.lexical_candidates(
                pool, index_id, lexical_query(query), query.lower(), None, None, 25),
            "vector": [hit for hit in nearest if hit["similarity"] > floor],
            "passages": await search_store.lexical_passage_candidates(
                pool, index_id, lexical_query(query), None, None, 25)}


async def assert_same_as_a_full_build(pool: asyncpg.Pool, index_id: str, world: World, *,
                                      spec: dict[str, Any] | None = None) -> None:
    """The generation holds exactly what a build from nothing of the same population holds, and finds the same."""
    other = await store_revision(pool, "full-reference", world, model_id=FULL_MODEL, spec=spec)
    reference_id, outcome = await build(pool, other, Embedder(), model_id=FULL_MODEL)
    assert outcome["mode"] == "full" and outcome["reason"] == "no_previous_generation"
    assert await snapshot(pool, index_id) == await snapshot(pool, reference_id)
    for query in ("Subject 3", "deliveries schedule", "Customer 1 bis", "Body of message 42"):
        assert await search(pool, index_id, query) == await search(pool, reference_id, query), query


@pytest.mark.asyncio
async def test_a_refresh_carries_unchanged_records_and_rebuilds_the_changed_and_their_neighbours(pool: asyncpg.Pool) -> None:
    world = World()
    first_embedder = Embedder()
    first, outcome = await build(pool, await store_revision(pool, "one", world), first_embedder)
    assert (outcome["state"], outcome["mode"], outcome["reason"]) == ("ready", "full", "no_previous_generation")
    assert (outcome["carried"], outcome["rebuilt"], outcome["embedded"]) == (0, 103, 103)

    refreshed = world.copy()
    refreshed.messages["message:003"]["body"] = "A new body for message three"      # changed
    del refreshed.messages["message:099"]                                         # removed
    refreshed.messages["message:100"] = {"subject": "Subject 100", "body": "Brand new"}  # added
    refreshed.customers["customer:1"] = "Customer 1 bis"                           # renamed: its record and the 5 it links
    embedder, reports = Embedder(), []
    second, outcome = await build(pool, await store_revision(pool, "two", refreshed), embedder, reports=reports)

    changed = 1 + 1 + 1 + 5  # message 3, message 100, customer 1, and messages 5-9 which show the customer's name
    assert (outcome["state"], outcome["mode"], outcome["reason"]) == ("ready", "incremental", None)
    assert (outcome["carried"], outcome["rebuilt"], outcome["embedded"]) == (103 - changed, changed, changed)
    # Only the changed cards go to the model: the rebuilt passages of messages 5-9 are in the vector cache.
    assert len(embedder.texts) == changed
    stages = [report["stage"] for report in reports]
    assert stages.index("comparing") < stages.index("carrying") < stages.index("documents") < stages.index("embedding")
    # The removed record is gone, the new one is there, and the linking cards show the new name.
    held = {row["entity_id"]: row["search_text"] for row in await pool.fetch(
        "SELECT entity_id, search_text FROM semantic_graph_search.entity_documents WHERE index_id = $1::uuid", second)}
    assert "message:099" not in held and "message:100" in held and len(held) == 103
    assert all("Customer 1 bis" in held[f"message:{n:03d}"] for n in range(5, 10))
    assert all("Customer 1 bis" not in held[f"message:{n:03d}"] for n in range(0, 5))
    generation = await search_store.get_generation_by_id(pool, second)
    assert generation is not None and generation["state"] == "ready"
    public = search_store.public_generation(generation)
    assert (public["buildMode"], public["buildReason"], public["carriedCount"], public["rebuiltCount"],
            public["embeddedCount"]) == ("incremental", None, 103 - changed, changed, changed)
    assert generation["indexed_count"] + generation["exact_only_count"] == 103
    await assert_same_as_a_full_build(pool, second, refreshed)
    assert first != second


@pytest.mark.asyncio
async def test_a_refresh_that_changes_nothing_embeds_nothing(pool: asyncpg.Pool) -> None:
    world = World(messages=30)
    await build(pool, await store_revision(pool, "one", world), Embedder())
    embedder = Embedder()
    second, outcome = await build(pool, await store_revision(pool, "two", world.copy()), embedder)
    assert (outcome["mode"], outcome["carried"], outcome["rebuilt"], outcome["embedded"]) == ("incremental", 33, 0, 0)
    assert embedder.texts == []
    await assert_same_as_a_full_build(pool, second, world)


@pytest.mark.asyncio
async def test_a_label_change_in_the_specification_builds_in_full(pool: asyncpg.Pool) -> None:
    world = World(messages=30)
    await build(pool, await store_revision(pool, "one", world), Embedder())
    relabelled = specification(message_label="E-mail")
    second, outcome = await build(pool, await store_revision(pool, "two", world.copy(), spec=relabelled), Embedder())
    assert (outcome["state"], outcome["mode"], outcome["reason"]) == ("ready", "full", "specification_changed")
    assert (outcome["carried"], outcome["rebuilt"]) == (0, 33)
    held = await pool.fetchval("SELECT search_text FROM semantic_graph_search.entity_documents "
                               "WHERE index_id = $1::uuid AND entity_id = 'message:001'", second)
    assert held.startswith("Type: E-mail")
    await assert_same_as_a_full_build(pool, second, world, spec=relabelled)


@pytest.mark.asyncio
async def test_other_index_settings_are_another_generation_built_in_full(pool: asyncpg.Pool) -> None:
    world = World(messages=30)
    await build(pool, await store_revision(pool, "one", world), Embedder())
    settings = IndexSettings(card_value_chars=200)
    revision_id, spec_hash = await store_revision(pool, "two", world.copy())
    generation = await search_store.create_generation(
        pool, model_id=MODEL, data_revision_id=revision_id, projection_ref="projection", spec_hash=spec_hash,
        fingerprint=index_fingerprint(PROFILE.fingerprint, settings), index_settings=settings.canonical(),
        vector_fingerprint=PROFILE.vector_fingerprint)
    _, outcome = await build(pool, (revision_id, spec_hash), Embedder(), index_id=generation["index_id"])
    assert (outcome["state"], outcome["mode"], outcome["reason"]) == ("ready", "full", "no_previous_generation")


@pytest.mark.asyncio
async def test_more_than_thirty_percent_changed_builds_in_full(pool: asyncpg.Pool) -> None:
    world = World(messages=40)
    await build(pool, await store_revision(pool, "one", world), Embedder())
    edited = world.copy()
    for number in range(20, 40):  # 20 of 43 records
        edited.messages[f"message:{number:03d}"]["subject"] = f"Edited {number}"
    second, outcome = await build(pool, await store_revision(pool, "two", edited), Embedder())
    assert (outcome["state"], outcome["mode"], outcome["reason"]) == ("ready", "full", "too_many_changes")
    assert (outcome["carried"], outcome["rebuilt"]) == (0, 43)
    await assert_same_as_a_full_build(pool, second, edited)


@pytest.mark.asyncio
async def test_carrying_does_not_depend_on_the_rows_the_previous_generation_was_built_from(pool: asyncpg.Pool) -> None:
    """A revision stored again in place (same id, other rows) leaves its generation describing the old rows:
    the next generation compares with that snapshot, not with the revision's current rows."""
    world = World(messages=30)
    original = await store_revision(pool, "one", world)
    await build(pool, original, Embedder())
    changed = world.copy()
    changed.messages["message:020"]["subject"] = "Rewritten in place"
    # The first revision's rows are replaced in place by the changed population.
    async with pool.acquire() as connection:
        async with connection.transaction():
            await population.replace_revision_rows(connection, original[0], coverage={}, source_observations=[])
            await population.store_entities(connection, model_id=MODEL, revision_id=original[0], entities=changed.entities())
            await population.store_relationships(connection, model_id=MODEL, revision_id=original[0],
                                                 relationships=changed.relationships())
    # Its rows now equal the new population, yet the next generation still sees message 20 as changed.
    embedder = Embedder()
    second, outcome = await build(pool, await store_revision(pool, "two", changed), embedder)
    assert (outcome["mode"], outcome["carried"], outcome["rebuilt"], outcome["embedded"]) == ("incremental", 32, 1, 1)
    assert any("Rewritten in place" in text for text in embedder.texts)
    await assert_same_as_a_full_build(pool, second, changed)


@pytest.mark.asyncio
async def test_a_build_stopped_while_carrying_ends_cancelled_and_resumes_to_the_same_result(pool: asyncpg.Pool, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(search_store, "CARRY_CHUNK_ROWS", 10)
    world = World(messages=100)
    await build(pool, await store_revision(pool, "one", world), Embedder())
    edited = world.copy()
    edited.messages["message:050"]["subject"] = "Edited 50"
    revision = await store_revision(pool, "two", edited)
    reports: list[dict[str, Any]] = []

    async def stop_after_two_chunks() -> bool:
        return any(report["stage"] == "carrying" and report["loaded"] >= 20 for report in reports)

    index_id, outcome = await build(pool, revision, Embedder(), should_stop=stop_after_two_chunks, reports=reports)
    assert outcome == {"state": "cancelled"}
    stopped = await search_store.get_generation_by_id(pool, index_id)
    assert stopped is not None and (stopped["state"], stopped["last_error_code"]) == ("failed", "cancelled")
    held = await pool.fetchval("SELECT count(*) FROM semantic_graph_search.entity_documents WHERE index_id = $1::uuid", index_id)
    assert 0 < held < 103

    assert await search_store.retry_generation(pool, index_id) is not None
    embedder = Embedder()
    _, resumed = await build(pool, revision, embedder, index_id=index_id)
    assert (resumed["state"], resumed["mode"], resumed["carried"], resumed["rebuilt"]) == ("ready", "incremental", 102, 1)
    assert len(embedder.texts) == 1
    await assert_same_as_a_full_build(pool, index_id, edited)
