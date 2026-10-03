"""Deleting a model on a real Postgres removes every runtime row of that model and only
of that model, refuses while one of its jobs runs, and can run again.

Needs SEMANTIC_RUNTIME_TEST_DATABASE_URL (its runtime schemas are dropped and rebuilt).
"""

from __future__ import annotations

import os
from pathlib import Path

import asyncpg
import pytest
import pytest_asyncio

from app.persistence.population_store import ModelJobsRunning, delete_model

DSN = os.environ.get("SEMANTIC_RUNTIME_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DSN, reason="SEMANTIC_RUNTIME_TEST_DATABASE_URL not set")
ROOT = Path(__file__).resolve().parents[1]
# Every migration, as the record query integration test does, so the test database is left whole.
MIGRATIONS = sorted((ROOT / "migrations").glob("*.sql"))
SCHEMAS = ("semantic_jobs", "semantic_datasource", "semantic_runtime", "semantic_population",
           "semantic_graph_search", "semantic_model")
SPEC_HASH = "sha256:" + "d" * 64
GONE, KEPT = "0b6f1d2e-0000-4000-8000-00000000000a", "0b6f1d2e-0000-4000-8000-00000000000b"
TABLES = ("semantic_runtime.specifications", "semantic_population.data_revisions",
          "semantic_runtime.active_bindings", "semantic_population.entities",
          "semantic_population.relationships", "semantic_population.model_data_resets",
          "semantic_graph_search.index_generations", "semantic_graph_search.entity_documents",
          "semantic_jobs.jobs", "semantic_jobs.ui_signal_outbox")


async def _seed(connection: asyncpg.Connection, model: str) -> None:
    revision = f"dr_{model[-1]}"
    ref = f"age:v1:pop_{revision}"
    await connection.execute(
        "INSERT INTO semantic_runtime.specifications (home_workspace_id, model_id, model_version_id, spec_hash, "
        "specification) VALUES ('ws1', $1, 'v1', $2, '{}'::jsonb)", model, SPEC_HASH)
    await connection.execute(
        "INSERT INTO semantic_population.data_revisions (id, model_id, model_version_id, spec_hash, projection_ref) "
        "VALUES ($1, $2, 'v1', $3, $4)", revision, model, SPEC_HASH, ref)
    await connection.execute(
        "INSERT INTO semantic_runtime.active_bindings (model_id, environment, model_version_id, data_revision_id, "
        "projection_ref) VALUES ($1, 'draft', 'v1', $2, $3)", model, revision, ref)
    for key in ("a", "b"):
        await connection.execute(
            "INSERT INTO semantic_population.entities (id, model_id, data_revision_id, concept_id, namespace, "
            "identity_key, label, attributes, provenance) VALUES ($1, $2, $3, 'c', 'ns', '{}'::jsonb, $1, "
            "'{}'::jsonb, '{}'::jsonb)", f"{model[-1]}:{key}", model, revision)
    await connection.execute(
        "INSERT INTO semantic_population.relationships (model_id, data_revision_id, relation_id, source_entity_id, "
        "target_entity_id) VALUES ($1, $2, 'r', $3, $4)", model, revision, f"{model[-1]}:a", f"{model[-1]}:b")
    await connection.execute("INSERT INTO semantic_population.model_data_resets (model_id) VALUES ($1)", model)
    index_id = await connection.fetchval(
        "INSERT INTO semantic_graph_search.index_generations (model_id, data_revision_id, projection_ref, spec_hash, "
        "embedding_fingerprint, state) VALUES ($1, $2, $3, $4, 'fp', 'ready') RETURNING index_id",
        model, revision, ref, SPEC_HASH)
    await connection.execute(
        "INSERT INTO semantic_graph_search.entity_documents (index_id, entity_id, concept_id, label, label_key, "
        "search_text, lexical, content_hash, status) VALUES ($1, $2, 'c', 'A', 'a', 'a', to_tsvector('simple', 'a'), $3, 'exact_only')",
        index_id, f"{model[-1]}:a", SPEC_HASH)
    await connection.execute(
        "INSERT INTO semantic_jobs.jobs (id, job_type, actor_user_id, model_id, idempotency_key, command_hash, "
        "command, state) VALUES (gen_random_uuid(), 'population.run', 'u1', $1, $2, $3, '{}'::jsonb, 'completed')",
        model, f"key-{model}", SPEC_HASH)
    await connection.execute(
        "INSERT INTO semantic_jobs.ui_signal_outbox (model_id, event_type, resource, payload) "
        "VALUES ($1, 'data-revision-changed', 'draft', '{}'::jsonb)", model)


@pytest_asyncio.fixture
async def pool():
    assert DSN
    connection = await asyncpg.connect(DSN)
    try:
        for schema in SCHEMAS:
            await connection.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
        for migration in MIGRATIONS:
            await connection.execute(migration.read_text(encoding="utf-8"))
        await _seed(connection, GONE)
        await _seed(connection, KEPT)
    finally:
        await connection.close()
    value = await asyncpg.create_pool(DSN, min_size=1, max_size=2)
    yield value
    await value.close()


async def _counts(pool: asyncpg.Pool) -> dict[str, tuple[int, int]]:
    counts = {}
    for table in TABLES:
        column = "entity_id" if table.endswith("entity_documents") else "model_id"
        pattern = "LIKE" if column == "entity_id" else "="
        if column == "entity_id":
            gone, kept = "'a:%'", "'b:%'"
        else:
            column = "model_id::text"
            gone, kept = f"'{GONE}'", f"'{KEPT}'"
        row = await pool.fetchrow(
            f"SELECT count(*) FILTER (WHERE {column} {pattern} {gone}), "
            f"count(*) FILTER (WHERE {column} {pattern} {kept}) FROM {table}")
        counts[table] = (row[0], row[1])
    return counts


@pytest.mark.asyncio
async def test_delete_removes_only_that_model_and_is_idempotent(pool) -> None:  # type: ignore[no-untyped-def]
    before = await _counts(pool)
    assert all(gone > 0 and kept > 0 for gone, kept in before.values()), before
    result = await delete_model(pool, GONE)
    assert result["projections"] == ["age:v1:pop_dr_a"]
    after = await _counts(pool)
    assert all(gone == 0 for gone, _ in after.values()), after
    assert {t: kept for t, (_, kept) in after.items()} == {t: kept for t, (_, kept) in before.items()}
    again = await delete_model(pool, GONE)
    assert again["projections"] == [] and not any(again["deleted"].values())


@pytest.mark.asyncio
async def test_delete_refuses_while_a_job_runs(pool) -> None:  # type: ignore[no-untyped-def]
    await pool.execute("UPDATE semantic_jobs.jobs SET state = 'running' WHERE model_id = $1", KEPT)
    with pytest.raises(ModelJobsRunning):
        await delete_model(pool, KEPT)
    assert (await _counts(pool))["semantic_population.entities"][1] == 2
