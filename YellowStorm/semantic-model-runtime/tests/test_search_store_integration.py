from __future__ import annotations

import os
from pathlib import Path

import asyncpg
import pytest
import pytest_asyncio

from app.persistence import search_store as store
from app.search.projections import build_entity_projections

DSN = os.environ.get("SEMANTIC_RUNTIME_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DSN, reason="SEMANTIC_RUNTIME_TEST_DATABASE_URL not set")
ROOT = Path(__file__).resolve().parents[1]


@pytest_asyncio.fixture
async def pool():
    assert DSN
    connection = await asyncpg.connect(DSN)
    try:
        await connection.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")
        await connection.execute("DROP SCHEMA IF EXISTS semantic_search CASCADE")
        await connection.execute(
            (ROOT / "migrations" / "007_search_store.sql").read_text(encoding="utf-8"))
    finally:
        await connection.close()
    value = await asyncpg.create_pool(DSN, min_size=1, max_size=6)
    yield value
    await value.close()


@pytest.mark.asyncio
async def test_projection_round_trip_and_candidate_lookup(pool: asyncpg.Pool):
    projections = build_entity_projections(
        [{"entityId": "e1", "conceptId": "c1", "label": "Acme",
          "identity": {"customer_id": "c-1"}, "attributes": {}},
         {"entityId": "e2", "conceptId": "c1", "label": "acme",
          "identity": {"customer_id": "c-1"}, "attributes": {}}],
        model_id="m1", revision_id="dr_1")
    assert await store.store_entity_projections(pool, projections) == 2
    assert await store.store_entity_projections(pool, projections) == 2
    assert await pool.fetchval("SELECT count(*) FROM semantic_search.entity_projections") == 2

    exact = await store.find_projection_candidates(
        pool, model_id="m1", revision_id="dr_1", strategy="exact", key="c-1")
    assert {c["entityId"] for c in exact} == {"e1", "e2"}
    scoped = await store.find_projection_candidates(
        pool, model_id="m1", revision_id="dr_1", strategy="exact", key="c-1",
        concept_id="other")
    assert scoped == []


@pytest.mark.asyncio
async def test_context_open_is_idempotent(pool: asyncpg.Pool):
    manifest = {"contextId": "ctx_1", "actorUserId": "u1", "modelId": "m1",
                "modelVersionId": "v1", "dataRevisionId": "dr_1",
                "sourceScope": [{"workspaceId": "w", "assetId": "a"}],
                "requiredSources": [], "coverage": {},
                "expiresAt": "2030-01-01T00:00:00+00:00"}
    assert await store.open_context(pool, manifest) == "ctx_1"
    assert await store.open_context(pool, manifest) == "ctx_1"
    assert (await store.get_context(pool, "ctx_1"))["model_id"] == "m1"
