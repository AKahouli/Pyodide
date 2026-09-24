"""Revoking a Workspace must immediately hide the rows PostgREST would serve.

This is a deployment test: it asserts the policies actually installed in the database, not
the SQL text in the repository. It runs as ``semantic_api_user`` because table owners bypass
RLS — querying as the owner would pass against a broken policy just as happily as a fixed one.
"""

from __future__ import annotations

import os
import re
import uuid
from pathlib import Path

import asyncpg
import pytest
import pytest_asyncio

DSN = os.environ.get("SEMANTIC_RUNTIME_TEST_DATABASE_URL")
if not DSN:
    env = Path(__file__).resolve().parents[1] / ".env"
    if env.exists():
        match = re.search(r'SEMANTIC_RUNTIME_TEST_DATABASE_URL\s*=\s*"?([^"\r\n]+)', env.read_text(encoding="utf-8"))
        DSN = match.group(1).strip() if match else None

pytestmark = pytest.mark.skipif(not DSN, reason="SEMANTIC_RUNTIME_TEST_DATABASE_URL not set")

ROOT = Path(__file__).resolve().parents[1]
SQL_DIR = ROOT / "deploy" / "data-plane" / "sql"

ACTOR = "rls-test-actor"
OTHER_ACTOR = "rls-test-other-actor"
WORKSPACE = "rls-test-workspace"
ASSET = "rls-test-asset"


def _claims(model_id: uuid.UUID, grant_id: uuid.UUID | None, actor: str = ACTOR) -> str:
    grant = f'"{grant_id}"' if grant_id else '""'
    return '{"sub": "%s", "model_id": "%s", "grant_id": %s}' % (actor, model_id, grant)


# The curated policies read four objects that other components own: models and memberships
# (via semantic_model.is_member), source_mappings, and mapping_health. A real data plane
# already has them, but the full bootstrap needs the AGE extension, which a plain Postgres
# test server does not carry. These are IF NOT EXISTS, so a real deployment is left untouched
# and only a bare test database gets the minimum the policies need to be exercised.
PREREQUISITES = """
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS semantic_model;
CREATE SCHEMA IF NOT EXISTS semantic_datasource;
CREATE TABLE IF NOT EXISTS semantic_model.models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  revision BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS semantic_model.memberships (
  model_id UUID NOT NULL REFERENCES semantic_model.models(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (model_id, user_id)
);
CREATE TABLE IF NOT EXISTS semantic_model.source_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id UUID NOT NULL,
  concept_id UUID NOT NULL,
  workspace_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  sheet_name TEXT,
  asset_kind TEXT NOT NULL,
  field_mappings JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'ready',
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS semantic_datasource.mapping_health (
  model_id UUID NOT NULL,
  mapping_id UUID NOT NULL,
  source_fingerprint TEXT,
  mapping_version TEXT NOT NULL,
  state TEXT NOT NULL,
  missing_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  available_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (model_id, mapping_id)
);
"""

GRANTS_SQL = ROOT.parent / "back" / "scripts" / "semantic-model" / "014_semantic_access_grants.sql"


async def _ensure_prerequisites(connection) -> None:
    await connection.execute(PREREQUISITES)
    # The grant tables are owned by the NestJS side; read the real file rather than restate it.
    if not GRANTS_SQL.exists():
        pytest.skip(f"{GRANTS_SQL} not found")
    await connection.execute(GRANTS_SQL.read_text(encoding="utf-8"))


@pytest_asyncio.fixture
async def fixture():
    """Applies the curated migrations, seeds one model + mapping + grant, cleans up after."""
    assert DSN
    connection = await asyncpg.connect(DSN, command_timeout=60)
    model_id = uuid.uuid4()
    mapping_id = uuid.uuid4()
    grant_id = uuid.uuid4()
    try:
        await _ensure_prerequisites(connection)
        for path in sorted(SQL_DIR.glob("*.sql")):
            await connection.execute(path.read_text(encoding="utf-8"))

        await connection.execute(
            "INSERT INTO semantic_model.models (id, owner_user_id, name, kind) VALUES ($1, $2, $3, 'designed')",
            model_id, ACTOR, f"rls-test-{model_id}",
        )
        await connection.execute(
            "INSERT INTO semantic_model.memberships (model_id, user_id, role) VALUES ($1, $2, 'owner')",
            model_id, ACTOR,
        )
        await connection.execute(
            """INSERT INTO semantic_model.source_mappings
                 (id, model_id, concept_id, workspace_id, document_id, asset_kind, created_by)
               VALUES ($1, $2, $3, $4, $5, 'document', $6)""",
            mapping_id, model_id, uuid.uuid4(), WORKSPACE, ASSET, ACTOR,
        )
        await connection.execute(
            """INSERT INTO semantic_datasource.mapping_health
                 (model_id, mapping_id, mapping_version, state)
               VALUES ($1, $2, 'v1', 'healthy')""",
            model_id, mapping_id,
        )
        await connection.execute(
            """INSERT INTO semantic_access.read_grants
                 (id, actor_user_id, model_id, scope_hash, expires_at, jti)
               VALUES ($1, $2, $3, 'test-scope', now() + interval '1 hour', $4)""",
            grant_id, ACTOR, model_id, f"jti-{grant_id}",
        )
        await connection.execute(
            "INSERT INTO semantic_access.read_grant_sources (grant_id, workspace_id, asset_id) VALUES ($1, $2, $3)",
            grant_id, WORKSPACE, ASSET,
        )
        yield connection, model_id, mapping_id, grant_id
    finally:
        await connection.execute("RESET ROLE")
        await connection.execute("DELETE FROM semantic_access.read_grants WHERE model_id = $1", model_id)
        await connection.execute("DELETE FROM semantic_datasource.mapping_health WHERE model_id = $1", model_id)
        await connection.execute("DELETE FROM semantic_model.source_mappings WHERE model_id = $1", model_id)
        await connection.execute("DELETE FROM semantic_model.models WHERE id = $1", model_id)
        await connection.close()


async def _as_api_user(connection, model_id, grant_id, actor: str = ACTOR):
    await connection.execute("RESET ROLE")
    await connection.execute("SELECT set_config('request.jwt.claims', $1, false)", _claims(model_id, grant_id, actor))
    await connection.execute("SET ROLE semantic_api_user")


async def _visible(connection, model_id, mapping_id):
    mappings = await connection.fetchval(
        "SELECT count(*) FROM semantic_model.source_mappings WHERE id = $1", mapping_id
    )
    health = await connection.fetchval(
        "SELECT count(*) FROM semantic_datasource.mapping_health WHERE model_id = $1", model_id
    )
    return mappings, health


@pytest.mark.asyncio
async def test_revoking_a_grant_immediately_hides_source_rows(fixture):
    connection, model_id, mapping_id, grant_id = fixture

    await _as_api_user(connection, model_id, grant_id)
    assert await _visible(connection, model_id, mapping_id) == (1, 1)

    await connection.execute("RESET ROLE")
    await connection.execute("UPDATE semantic_access.read_grants SET revoked_at = now() WHERE id = $1", grant_id)

    # Same token, same claims: revocation alone must be enough.
    await _as_api_user(connection, model_id, grant_id)
    assert await _visible(connection, model_id, mapping_id) == (0, 0)


@pytest.mark.asyncio
async def test_an_expired_grant_hides_source_rows(fixture):
    connection, model_id, mapping_id, grant_id = fixture

    await connection.execute(
        "UPDATE semantic_access.read_grants SET issued_at = now() - interval '2 hours',"
        " expires_at = now() - interval '1 minute' WHERE id = $1",
        grant_id,
    )

    await _as_api_user(connection, model_id, grant_id)
    assert await _visible(connection, model_id, mapping_id) == (0, 0)


@pytest.mark.asyncio
async def test_membership_without_a_grant_is_not_enough(fixture):
    """The whole point of 002/003: being a model member no longer implies seeing its sources."""
    connection, model_id, mapping_id, grant_id = fixture

    await _as_api_user(connection, model_id, None)
    assert await _visible(connection, model_id, mapping_id) == (0, 0)


@pytest.mark.asyncio
async def test_a_grant_for_another_workspace_does_not_unlock_this_source(fixture):
    connection, model_id, mapping_id, grant_id = fixture

    await connection.execute(
        "UPDATE semantic_access.read_grant_sources SET workspace_id = $2 WHERE grant_id = $1",
        grant_id, "some-other-workspace",
    )

    await _as_api_user(connection, model_id, grant_id)
    assert await _visible(connection, model_id, mapping_id) == (0, 0)


@pytest.mark.asyncio
async def test_another_actors_grant_does_not_unlock_this_source(fixture):
    """Grants are actor-bound: presenting someone else's grant id must not widen visibility."""
    connection, model_id, mapping_id, grant_id = fixture

    await _as_api_user(connection, model_id, grant_id, actor=OTHER_ACTOR)
    assert await _visible(connection, model_id, mapping_id) == (0, 0)
