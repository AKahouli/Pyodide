from __future__ import annotations

import pytest

from app.persistence.population_store import revision_id_for


def test_revision_id_is_deterministic():
    fingerprint = "sha256:" + "a" * 64
    first = revision_id_for("v1", fingerprint, ["sha256:abc", "sha256:def"], 2)
    assert first.startswith("dr_") and len(first) == 27
    assert revision_id_for("v1", fingerprint, ["sha256:def", "sha256:abc"], 2) == first
    assert revision_id_for("v1", "sha256:" + "b" * 64, ["sha256:abc", "sha256:def"], 2) != first
    assert revision_id_for("v1", fingerprint, ["sha256:abc"], 2) != first
    assert revision_id_for("v1", fingerprint, ["sha256:abc", "sha256:def"], 3) != first


@pytest.mark.asyncio
async def test_cas_create_and_update_sql_shapes():
    calls: list[tuple[str, tuple]] = []

    class FakePool:
        def acquire(self):  # type: ignore[no-untyped-def]
            return self

        async def __aenter__(self):  # type: ignore[no-untyped-def]
            return self

        async def __aexit__(self, *_args):  # type: ignore[no-untyped-def]
            return None

        def transaction(self):  # type: ignore[no-untyped-def]
            return self

        async def fetchrow(self, sql: str, *params):  # type: ignore[no-untyped-def]
            calls.append((sql, params))
            return {"version": 1} if "RETURNING version" in sql else {"id": "x"}

    from app.persistence.population_store import cas_active_binding

    assert await cas_active_binding(
        FakePool(), model_id="m1", expected_version=None, model_version_id="v1",
        data_revision_id="dr_1", projection_ref="p", correction_sequence=0,
        spec_hash="sha256:" + "a" * 64) is True
    assert "ON CONFLICT (model_id, environment) DO NOTHING" in calls[0][0]
    assert await cas_active_binding(
        FakePool(), model_id="m1", expected_version=4, model_version_id="v1",
        data_revision_id="dr_2", projection_ref="p", correction_sequence=1,
        spec_hash="sha256:" + "a" * 64) is True
    assert "AND version = $7" in calls[1][0]
    assert calls[1][1][-2] == 4


@pytest.mark.asyncio
async def test_entity_listing_filters_before_limit():
    calls: list[tuple[str, tuple]] = []

    class FakePool:
        async def fetch(self, sql: str, *params):  # type: ignore[no-untyped-def]
            calls.append((sql, params))
            return []

    from app.persistence.population_store import list_revision_entities

    assert await list_revision_entities(FakePool(), "dr_1", 25, "c1") == []
    assert "FROM semantic_population.entities" in calls[0][0]
    assert "concept_id = $3" in calls[0][0]
    assert calls[0][1] == ("dr_1", 25, "c1")


def test_a_reset_model_gets_a_new_revision_id():
    fingerprint = "sha256:" + "a" * 64
    before = revision_id_for("v1", fingerprint, ["sha256:abc"], 2)
    assert revision_id_for("v1", fingerprint, ["sha256:abc"], 2, 0) == before
    assert revision_id_for("v1", fingerprint, ["sha256:abc"], 2, 1) != before
    assert revision_id_for("v1", fingerprint, ["sha256:abc"], 2, 2) != revision_id_for(
        "v1", fingerprint, ["sha256:abc"], 2, 1)


class _PurgeConnection:
    """Records the purge's statements and answers like the runtime database."""

    def __init__(self, running: int = 0) -> None:
        self.running = running
        self.statements: list[tuple[str, tuple]] = []

    def acquire(self):  # type: ignore[no-untyped-def]
        return self

    def transaction(self):  # type: ignore[no-untyped-def]
        return self

    async def __aenter__(self):  # type: ignore[no-untyped-def]
        return self

    async def __aexit__(self, *_args):  # type: ignore[no-untyped-def]
        return None

    async def execute(self, sql: str, *params):  # type: ignore[no-untyped-def]
        self.statements.append((sql, params))

    async def fetch(self, sql: str, *params):  # type: ignore[no-untyped-def]
        self.statements.append((sql, params))
        if "FROM semantic_runtime.active_bindings" in sql:
            return [{"data_revision_id": "dr_published"}]
        if "DELETE FROM semantic_population.data_revisions" in sql:
            return [{"id": "dr_a", "projection_ref": "age:v1:pop_dr_a"},
                    {"id": "dr_b", "projection_ref": None}]
        return []

    async def fetchval(self, sql: str, *params):  # type: ignore[no-untyped-def]
        self.statements.append((sql, params))
        if "FROM semantic_jobs.jobs WHERE" in sql and "count(*)" in sql and "DELETE" not in sql:
            return self.running
        if "model_data_resets" in sql:
            return 3
        return 2

    async def fetchrow(self, sql: str, *params):  # type: ignore[no-untyped-def]
        self.statements.append((sql, params))
        return {"id": 1}


@pytest.mark.asyncio
async def test_purge_keeps_published_data_and_settings():
    from app.persistence.population_store import purge_model_data

    connection = _PurgeConnection()
    result = await purge_model_data(connection, "m1")
    sql = "\n".join(statement for statement, _ in connection.statements)
    assert result == {"modelId": "m1", "resetGeneration": 3, "revisions": 2, "keptRevisions": 1,
                      "reviewItems": 2, "jobs": 2, "documentReadings": 0,
                      "projections": ["age:v1:pop_dr_a"]}
    # Only the draft pointer goes; the revision another environment serves is kept.
    assert "environment = 'draft'" in sql
    revisions = next(params for statement, params in connection.statements
                     if "DELETE FROM semantic_population.data_revisions" in statement)
    assert revisions == ("m1", ["dr_published"])
    # Settings and human fixes are never touched; the AI readings stay unless asked.
    for kept in ("semantic_population.corrections", "semantic_runtime.specifications",
                 "manual_", "document_extractions"):
        assert kept not in sql


@pytest.mark.asyncio
async def test_purge_can_forget_document_readings():
    from app.persistence.population_store import purge_model_data

    connection = _PurgeConnection()
    result = await purge_model_data(connection, "m1", forget_document_reading=True)
    assert result["documentReadings"] == 2
    assert any("DELETE FROM semantic_population.document_extractions" in statement
               for statement, _ in connection.statements)


@pytest.mark.asyncio
async def test_purge_refuses_while_a_build_runs():
    from app.persistence.population_store import PopulationRunning, purge_model_data

    connection = _PurgeConnection(running=1)
    with pytest.raises(PopulationRunning):
        await purge_model_data(connection, "m1")
    assert not any("DELETE" in statement for statement, _ in connection.statements)
