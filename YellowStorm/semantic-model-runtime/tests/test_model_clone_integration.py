"""Cloning a model's data on a real Postgres copies the source's draft revision (and only
that model's rows) into a new revision of the target, with every mapped id rewritten.

Needs SEMANTIC_RUNTIME_TEST_DATABASE_URL (its runtime schemas are dropped and rebuilt).
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import asyncpg
import pytest
import pytest_asyncio

from app.persistence.model_clone_store import CloneTargetNotEmpty, clone_model_data
from app.persistence.population_store import ModelJobsRunning
from app.population.compiler import canonical_spec_hash

DSN = os.environ.get("SEMANTIC_RUNTIME_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DSN, reason="SEMANTIC_RUNTIME_TEST_DATABASE_URL not set")
ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = sorted((ROOT / "migrations").glob("*.sql"))
SCHEMAS = ("semantic_jobs", "semantic_datasource", "semantic_runtime", "semantic_population",
           "semantic_graph_search", "semantic_model")
SOURCE, OTHER, TARGET = ("0c1d2e3f-0000-4000-8000-00000000000a", "0c1d2e3f-0000-4000-8000-00000000000b",
                         "0c1d2e3f-0000-4000-8000-00000000000c")
SRC_VERSION, TARGET_VERSION = "0c1d2e3f-0000-4000-8000-0000000000a1", "0c1d2e3f-0000-4000-8000-0000000000c1"
CONCEPT, NEW_CONCEPT = "0c1d2e3f-0000-4000-8000-0000000000d1", "0c1d2e3f-0000-4000-8000-0000000000d2"
RELATION, NEW_RELATION = "0c1d2e3f-0000-4000-8000-0000000000e1", "0c1d2e3f-0000-4000-8000-0000000000e2"


async def _seed(connection: asyncpg.Connection, model: str, version: str) -> None:
    revision = f"dr_{model[-1]}"
    spec = {"modelId": model, "modelVersionId": version,
            "concepts": [{"conceptId": CONCEPT, "key": "person", "allowedFields": ["name"]}],
            "relations": [{"relationId": RELATION, "sourceConceptId": CONCEPT, "targetConceptId": CONCEPT}]}
    spec_hash = canonical_spec_hash(spec)
    await connection.execute(
        "INSERT INTO semantic_runtime.specifications (home_workspace_id, model_id, model_version_id, spec_hash, "
        "specification) VALUES ('ws1', $1, $2, $3, $4::jsonb)", model, version, spec_hash, json.dumps(spec))
    await connection.execute(
        "INSERT INTO semantic_population.data_revisions (id, model_id, model_version_id, spec_hash, projection_ref, "
        "validation_state, coverage) VALUES ($1, $2, $3, $4, $5, 'valid', $6::jsonb)",
        revision, model, version, spec_hash, f"age:v1:pop_{revision}", json.dumps({"conceptId": CONCEPT}))
    await connection.execute(
        "INSERT INTO semantic_runtime.active_bindings (model_id, environment, model_version_id, data_revision_id, "
        "projection_ref) VALUES ($1, 'draft', $2, $3, $4)", model, version, revision, f"age:v1:pop_{revision}")
    for key in ("a", "b"):
        await connection.execute(
            "INSERT INTO semantic_population.entities (id, model_id, data_revision_id, concept_id, namespace, "
            "identity_key, label, attributes, provenance) VALUES ($1, $2, $3, $4, 'person', '{}', $1, "
            "'{\"name\": \"x\"}'::jsonb, $5::jsonb)",
            f"person:{key}", model, revision, CONCEPT, json.dumps({"conceptId": CONCEPT}))
        await connection.execute(
            "INSERT INTO semantic_population.entity_identities (entity_id, data_revision_id, alias_namespace, "
            "alias_key) VALUES ($1, $2, 'person', $1)", f"person:{key}", revision)
        await connection.execute(
            "INSERT INTO semantic_population.assertions (model_id, data_revision_id, entity_id, attribute, value) "
            "VALUES ($1, $2, $3, 'name', 'x')", model, revision, f"person:{key}")
    await connection.execute(
        "INSERT INTO semantic_population.relationships (model_id, data_revision_id, relation_id, source_entity_id, "
        "target_entity_id) VALUES ($1, $2, $3, 'person:a', 'person:b')", model, revision, RELATION)
    await connection.execute(
        "INSERT INTO semantic_population.review_items (model_id, model_version_id, data_revision_id, kind, "
        "candidates) VALUES ($1, $2, $3, 'identity', $4::jsonb)", model, version, revision,
        json.dumps([{"conceptId": CONCEPT}]))
    sequence = await connection.fetchval(
        "INSERT INTO semantic_population.corrections (model_id, model_version_id, actor_user_id, target_identity, "
        "action, data_revision_id) VALUES ($1, $2, 'u1', $3::jsonb, 'suppress', $4) RETURNING sequence",
        model, version, json.dumps({"conceptId": CONCEPT}), revision)
    await connection.execute(
        "UPDATE semantic_population.data_revisions SET correction_sequence = $2 WHERE id = $1", revision, sequence)
    snapshot = f"m{model[-1] * 40}"
    await connection.execute(
        "INSERT INTO semantic_population.manual_snapshots (id, model_id, row_count, link_count, committed_at) "
        "VALUES ($1, $2, 1, 0, now())", snapshot, model)
    await connection.execute(
        'INSERT INTO semantic_population.manual_rows (snapshot_id, concept_id, row_key, label, "values") '
        "VALUES ($1, $2, 'r1', 'R', '{}'::jsonb)", snapshot, CONCEPT)
    await connection.execute(
        "INSERT INTO semantic_jobs.jobs (id, job_type, actor_user_id, model_id, idempotency_key, command_hash, "
        "command, state) VALUES (gen_random_uuid(), 'population.run', 'u1', $1, $2, $3, '{}'::jsonb, 'completed')",
        model, f"key-{model}", spec_hash)


@pytest_asyncio.fixture
async def pool():
    assert DSN
    connection = await asyncpg.connect(DSN)
    try:
        for schema in SCHEMAS:
            await connection.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
        for migration in MIGRATIONS:
            await connection.execute(migration.read_text(encoding="utf-8"))
        await _seed(connection, SOURCE, SRC_VERSION)
        await _seed(connection, OTHER, SRC_VERSION)
    finally:
        await connection.close()
    value = await asyncpg.create_pool(DSN, min_size=1, max_size=2)
    yield value
    await value.close()


async def _clone(pool: asyncpg.Pool) -> dict:
    return await clone_model_data(pool, source_model_id=SOURCE, target_model_id=TARGET,
                                  target_model_version_id=TARGET_VERSION,
                                  id_map={CONCEPT: NEW_CONCEPT, RELATION: NEW_RELATION})


@pytest.mark.asyncio
async def test_clone_copies_only_the_source_rows_with_remapped_ids(pool) -> None:  # type: ignore[no-untyped-def]
    result = await _clone(pool)
    assert result["copied"] is True
    assert result["counts"] == {"entities": 2, "aliases": 2, "assertions": 2, "relationships": 1,
                                "reviewItems": 1, "corrections": 1, "manualSnapshots": 1}
    revision = await pool.fetchrow("SELECT * FROM semantic_population.data_revisions WHERE id = $1",
                                   result["revisionId"])
    assert revision["model_id"] == TARGET and revision["model_version_id"] == TARGET_VERSION
    assert revision["projection_ref"] is None and revision["validation_state"] == "valid"
    assert json.loads(revision["coverage"]) == {"conceptId": NEW_CONCEPT}
    spec = await pool.fetchrow("SELECT spec_hash, specification FROM semantic_runtime.specifications "
                               "WHERE model_id = $1", TARGET)
    body = json.loads(spec["specification"])
    assert body["modelId"] == TARGET and body["concepts"][0]["conceptId"] == NEW_CONCEPT
    assert spec["spec_hash"] == revision["spec_hash"] == canonical_spec_hash(body)
    entities = await pool.fetch("SELECT concept_id, provenance FROM semantic_population.entities "
                                "WHERE data_revision_id = $1", result["revisionId"])
    assert {row["concept_id"] for row in entities} == {NEW_CONCEPT}
    assert all(json.loads(row["provenance"])["conceptId"] == NEW_CONCEPT for row in entities)
    relation = await pool.fetchval("SELECT relation_id FROM semantic_population.relationships "
                                   "WHERE model_id = $1", TARGET)
    assert relation == NEW_RELATION
    correction = await pool.fetchrow("SELECT sequence, data_revision_id, model_version_id "
                                     "FROM semantic_population.corrections WHERE model_id = $1", TARGET)
    assert correction["data_revision_id"] == result["revisionId"]
    assert correction["model_version_id"] == TARGET_VERSION
    assert revision["correction_sequence"] == correction["sequence"] == result["correctionSequence"]
    review = await pool.fetchrow("SELECT data_revision_id, candidates FROM semantic_population.review_items "
                                 "WHERE model_id = $1", TARGET)
    assert review["data_revision_id"] == result["revisionId"]
    assert json.loads(review["candidates"]) == [{"conceptId": NEW_CONCEPT}]
    manual = await pool.fetchval("SELECT r.concept_id FROM semantic_population.manual_rows r JOIN "
                                 "semantic_population.manual_snapshots s ON s.id = r.snapshot_id "
                                 "WHERE s.model_id = $1", TARGET)
    assert manual == NEW_CONCEPT
    # Not copied: the active binding (set after projection), the search index, the jobs.
    for table in ("semantic_runtime.active_bindings", "semantic_graph_search.index_generations",
                  "semantic_jobs.jobs"):
        assert await pool.fetchval(f"SELECT count(*) FROM {table} WHERE model_id = $1", TARGET) == 0
    # The other model's data is untouched and nothing of it went to the target.
    assert await pool.fetchval("SELECT count(*) FROM semantic_population.entities WHERE model_id = $1",
                               OTHER) == 2
    assert await pool.fetchval("SELECT count(*) FROM semantic_population.entities WHERE model_id = $1",
                               TARGET) == 2


@pytest.mark.asyncio
async def test_clone_refuses_a_running_source_job_and_a_non_empty_target(pool) -> None:  # type: ignore[no-untyped-def]
    await pool.execute("UPDATE semantic_jobs.jobs SET state = 'running' WHERE model_id = $1", SOURCE)
    with pytest.raises(ModelJobsRunning):
        await _clone(pool)
    assert await pool.fetchval("SELECT count(*) FROM semantic_population.entities WHERE model_id = $1",
                               TARGET) == 0
    await pool.execute("UPDATE semantic_jobs.jobs SET state = 'completed' WHERE model_id = $1", SOURCE)
    await _clone(pool)
    with pytest.raises(CloneTargetNotEmpty):
        await _clone(pool)


@pytest.mark.asyncio
async def test_clone_of_a_model_without_data_copies_nothing(pool) -> None:  # type: ignore[no-untyped-def]
    await pool.execute("DELETE FROM semantic_runtime.active_bindings WHERE model_id = $1", SOURCE)
    assert await _clone(pool) == {"copied": False, "reason": "no_data"}


@pytest.mark.asyncio
async def test_clone_uses_the_clone_plan_when_given(pool) -> None:  # type: ignore[no-untyped-def]
    spec = {"modelId": TARGET, "concepts": [], "relations": [], "sourceScope": []}
    planned = {"homeWorkspaceId": "ws2", "specHash": canonical_spec_hash(spec), "specification": spec,
               "executionFingerprint": "sha256:" + "e" * 64}
    result = await clone_model_data(pool, source_model_id=SOURCE, target_model_id=TARGET,
                                    target_model_version_id=TARGET_VERSION,
                                    id_map={CONCEPT: NEW_CONCEPT, RELATION: NEW_RELATION}, planned=planned)
    revision = await pool.fetchrow("SELECT spec_hash, execution_fingerprint FROM semantic_population.data_revisions "
                                   "WHERE id = $1", result["revisionId"])
    assert revision["spec_hash"] == planned["specHash"]
    assert revision["execution_fingerprint"] == "sha256:" + "e" * 64
    stored = await pool.fetchrow("SELECT home_workspace_id, spec_hash FROM semantic_runtime.specifications "
                                 "WHERE model_id = $1", TARGET)
    assert (stored["home_workspace_id"], stored["spec_hash"]) == ("ws2", planned["specHash"])
