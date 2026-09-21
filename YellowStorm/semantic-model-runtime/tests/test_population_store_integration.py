from __future__ import annotations

import os
from pathlib import Path

import asyncpg
import pytest
import pytest_asyncio

from app.persistence import population_store as store

DSN = os.environ.get("SEMANTIC_RUNTIME_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DSN, reason="SEMANTIC_RUNTIME_TEST_DATABASE_URL not set")
ROOT = Path(__file__).resolve().parents[1]


@pytest_asyncio.fixture
async def pool():
    assert DSN
    connection = await asyncpg.connect(DSN)
    try:
        await connection.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")
        await connection.execute("DROP SCHEMA IF EXISTS semantic_population CASCADE")
        await connection.execute("DROP SCHEMA IF EXISTS semantic_runtime CASCADE")
        for name in ("005_runtime_store.sql", "006_population_store.sql"):
            await connection.execute((ROOT / "migrations" / name).read_text(encoding="utf-8"))
    finally:
        await connection.close()
    value = await asyncpg.create_pool(DSN, min_size=1, max_size=6)
    yield value
    await value.close()


@pytest.mark.asyncio
async def test_revision_lifecycle_with_idempotent_writes(pool: asyncpg.Pool):
    spec_id = await store.mirror_specification(
        pool, home_workspace_id="ws1", model_id="m1", model_version_id="v1",
        spec_hash="sha256:" + "a" * 64, specification={"concepts": []})
    assert spec_id
    revision = store.revision_id_for("v1", "sha256:" + "a" * 64, ["sha256:abc"], 0)
    assert revision.startswith("dr_")
    assert await store.create_data_revision(
        pool, revision_id=revision, model_id="m1", model_version_id="v1",
        spec_hash="sha256:" + "a" * 64, source_observations=[], correction_sequence=0,
        coverage={}) == revision
    # Idempotent re-creation returns the same id.
    assert await store.create_data_revision(
        pool, revision_id=revision, model_id="m1", model_version_id="v1",
        spec_hash="sha256:" + "a" * 64, source_observations=[], correction_sequence=0,
        coverage={}) == revision

    entities = [{"entityId": "crm:aaa", "conceptId": "c1", "namespace": "crm",
                 "identity": {"customer_id": "x"}, "label": "X", "attributes": {"name": "X"},
                 "provenance": {}}]
    assert await store.store_entities(pool, model_id="m1", revision_id=revision,
                                      entities=entities) == 1
    assert await store.store_entities(pool, model_id="m1", revision_id=revision,
                                      entities=entities) == 1
    assert await pool.fetchval("SELECT count(*) FROM semantic_population.entities") == 1

    assertions = [{"entityId": "crm:aaa", "attribute": "name", "value": "X",
                   "origin": "source", "evidence": {"mappingVersion": "map-v1"}}]
    assert await store.store_assertions(pool, model_id="m1", revision_id=revision,
                                        assertions=assertions) == 1
    assert await pool.fetchval(
        "SELECT mapping_version FROM semantic_population.assertions") == "map-v1"

    relationships = [{"relationId": "r1", "sourceEntityId": "crm:aaa",
                      "targetEntityId": "crm:aaa", "matchingStrategy": "exact"}]
    assert await store.store_relationships(pool, model_id="m1", revision_id=revision,
                                           relationships=relationships) == 1

    aliases = [{"entityId": "crm:aaa", "aliasNamespace": "erp", "aliasKey": "e-9"}]
    assert await store.store_entity_aliases(pool, revision_id=revision,
                                            aliases=aliases) == 1

    assert await store.set_revision_validation(pool, revision, "valid") is True
    # A retry can never flip a decided revision.
    assert await store.set_revision_validation(pool, revision, "invalid") is False
    with pytest.raises(ValueError):
        await store.set_revision_validation(pool, revision, "bogus")

    counts = await store.count_revision_rows(pool, revision)
    assert counts == {"entities": 1, "assertions": 1, "relationships": 1}

    assert await store.set_revision_projection(pool, revision, "graph:pop_x") is True
    assert await store.set_revision_projection(pool, revision, "graph:pop_y") is False
    assert (await store.get_data_revision(pool, revision))["projection_ref"] == "graph:pop_x"

    with pytest.raises(ValueError):
        await store.mirror_specification(
            pool, home_workspace_id="ws1", model_id="m1", model_version_id="v1",
            spec_hash="sha256:" + "b" * 64, specification={"concepts": []})


@pytest.mark.asyncio
async def test_corrections_reviews_and_cas_binding(pool: asyncpg.Pool):
    assert await store.model_correction_sequence(pool, "m1") == 0
    first = await store.record_correction(
        pool, model_id="m1", model_version_id="v1", actor_user_id="u1",
        reason="fix name", target_identity={"entityId": "crm:aaa"},
        action="edit_entity", payload={"attributes": {"name": "Y"}})
    second = await store.record_correction(
        pool, model_id="m1", model_version_id="v1", actor_user_id="u1", reason="drop",
        target_identity={"entityId": "crm:aaa"}, action="suppress", payload={})
    assert (first, second) == (1, 2)
    assert await store.model_correction_sequence(pool, "m1") == 2

    review = await store.open_review_item(
        pool, model_id="m1", model_version_id="v1", data_revision_id=None,
        kind="ambiguous_reference", prompt="Which target?",
        candidates=[{"entityId": "e1"}, {"entityId": "e2"}], evidence={})
    assert review
    assert await store.resolve_review_item(
        pool, review_id=review, model_id="m1",
        resolution={"targetEntityId": "e1"}, resolved_by="u1") is True
    # Already resolved: second attempt fences out.
    assert await store.resolve_review_item(
        pool, review_id=review, model_id="m1",
        resolution={"targetEntityId": "e2"}, resolved_by="u1") is False

    assert await store.get_active_binding(pool, "m1") is None
    assert await store.cas_active_binding(
        pool, model_id="m1", expected_version=None, model_version_id="v1",
        data_revision_id="dr_1", projection_ref="age:graph_1",
        correction_sequence=2) is True
    # Create is idempotent-safe: an existing binding blocks a second create.
    assert await store.cas_active_binding(
        pool, model_id="m1", expected_version=None, model_version_id="v1",
        data_revision_id="dr_1", projection_ref="age:graph_1",
        correction_sequence=2) is False
    binding = await store.get_active_binding(pool, "m1")
    assert binding is not None
    assert binding["data_revision_id"] == "dr_1"
    assert binding["version"] == 1
    # Stale version fences out; current version swaps atomically.
    assert await store.cas_active_binding(
        pool, model_id="m1", expected_version=1, model_version_id="v1",
        data_revision_id="dr_2", projection_ref="age:graph_2",
        correction_sequence=2) is True
    assert await store.cas_active_binding(
        pool, model_id="m1", expected_version=1, model_version_id="v1",
        data_revision_id="dr_3", projection_ref="age:graph_3",
        correction_sequence=2) is False
    assert (await store.get_active_binding(pool, "m1"))["data_revision_id"] == "dr_2"
