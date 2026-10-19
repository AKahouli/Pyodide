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


@pytest.mark.asyncio
async def test_bulk_revision_read_budget_covers_served_and_candidate_assertions():
    from app.persistence.population_store import (list_revision_assertions, list_revision_entities,
                                                  list_revision_relationships)

    class Connection:
        def __init__(self):
            self.options = []

        async def fetch(self, sql, *params, **options):
            self.options.append(options)
            if "assertion_candidates" in sql:
                return [{"entity_id": "e", "attribute": "name", "value": "other",
                         "origin": "source", "evidence": {}}]
            if "semantic_population.assertions" in sql:
                return [{"entity_id": "e", "attribute": "name", "value": "served",
                         "origin": "source", "evidence": {}}]
            return []

    connection = Connection()
    values = await list_revision_assertions(connection, "dr", timeout=120)
    assert [value["value"] for value in values] == ["served", "other"]
    await list_revision_entities(connection, "dr", timeout=120)
    await list_revision_relationships(connection, "dr", timeout=120)
    assert connection.options == [{"timeout": 120}] * 4
    await list_revision_assertions(connection, "dr")
    assert connection.options[-2:] == [{}, {}]


class _PurgeConnection:
    """Records the purge's statements and answers like the runtime database."""

    def __init__(self, running: int = 0) -> None:
        self.running = running
        self.statements: list[tuple[str, tuple]] = []
        self.timeouts: list[float] = []

    def acquire(self):  # type: ignore[no-untyped-def]
        return self

    def transaction(self):  # type: ignore[no-untyped-def]
        return self

    async def __aenter__(self):  # type: ignore[no-untyped-def]
        return self

    async def __aexit__(self, *_args):  # type: ignore[no-untyped-def]
        return None

    async def execute(self, sql: str, *params, timeout=None):  # type: ignore[no-untyped-def]
        self.statements.append((sql, params))

    async def fetch(self, sql: str, *params, timeout=None):  # type: ignore[no-untyped-def]
        self.statements.append((sql, params))
        if timeout is not None:
            self.timeouts.append(timeout)
        if "FROM semantic_runtime.active_bindings" in sql:
            return [{"data_revision_id": "dr_published"}]
        if "SELECT id, projection_ref FROM semantic_population.data_revisions" in sql:
            return [{"id": "dr_a", "projection_ref": "age:v1:pop_dr_a"},
                    {"id": "dr_b", "projection_ref": None}]
        if "FROM semantic_graph_search.index_generations" in sql:
            return [{"index_id": "00000000-0000-4000-8000-00000000000a"}]
        if "FROM pg_class" in sql:
            return [{"relname": name} for name in params[1]]
        if "DELETE FROM semantic_population.data_revisions" in sql:
            return [{"id": "dr_a", "projection_ref": "age:v1:pop_dr_a"},
                    {"id": "dr_b", "projection_ref": None}]
        return []

    async def fetchval(self, sql: str, *params, timeout=None):  # type: ignore[no-untyped-def]
        self.statements.append((sql, params))
        if timeout is not None:
            self.timeouts.append(timeout)
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
    # Clearing a large model outlasts the API pool's few-second statement limit.
    assert connection.statements[0][0].startswith("SET LOCAL statement_timeout = '300s'")
    # The revisions to clear are those no environment serves; only those are deleted.
    doomed = next(params for statement, params in connection.statements
                  if "SELECT id, projection_ref FROM semantic_population.data_revisions" in statement)
    assert doomed == ("m1", ["dr_published"])
    revisions = next(params for statement, params in connection.statements
                     if "DELETE FROM semantic_population.data_revisions" in statement)
    assert revisions == (["dr_a", "dr_b"],)
    # Settings and human fixes are never touched; the AI readings stay unless asked.
    for kept in ("semantic_population.corrections", "semantic_runtime.specifications",
                 "manual_", "document_extractions"):
        assert kept not in sql


@pytest.mark.asyncio
async def test_purge_drops_the_partitions_of_the_cleared_revisions_before_their_rows():
    from app.persistence.partitions import partition_name
    from app.persistence.population_store import purge_model_data

    connection = _PurgeConnection()
    await purge_model_data(connection, "m1")
    sql = [statement for statement, _ in connection.statements]
    dropped = [i for i, statement in enumerate(sql) if statement.startswith("DROP TABLE")]
    deleted = next(i for i, statement in enumerate(sql)
                   if "DELETE FROM semantic_population.data_revisions" in statement)
    # The search generations' tables, then the revisions' ones, all before the small rows go.
    assert len(dropped) == 4 and max(dropped) < deleted
    assert "entity_passages_" in sql[dropped[0]] and "entity_documents_" in sql[dropped[1]]
    for table in ("assertions", "relationships"):
        for revision in ("dr_a", "dr_b"):
            assert partition_name(table, revision) in sql[dropped[2]]
    for revision in ("dr_a", "dr_b"):
        assert '"' + partition_name("entities", revision) + '"' in sql[dropped[3]]
    # The published revision's partitions stay.
    assert partition_name("entities", "dr_published") not in "\n".join(sql)


@pytest.mark.asyncio
async def test_purge_uses_the_time_it_is_given():
    from app.persistence.population_store import purge_model_data

    connection = _PurgeConnection()
    await purge_model_data(connection, "m1", forget_document_reading=True, timeout_s=900)
    assert connection.statements[0][0] == "SET LOCAL statement_timeout = '900s'"
    # The heavy deletes wait as long as the statement may run.
    assert connection.timeouts == [900, 900]
    assert "SET LOCAL lock_timeout" in connection.statements[1][0]


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


@pytest.mark.asyncio
async def test_large_writes_go_in_chunks_each_within_the_statement_limit():
    from app.persistence.population_store import WRITE_CHUNK_ROWS, store_entities

    class Pool:
        def __init__(self):  # type: ignore[no-untyped-def]
            self.calls: list[tuple[int, dict]] = []

        async def executemany(self, _sql, rows, **options):  # type: ignore[no-untyped-def]
            self.calls.append((len(rows), options))

    pool = Pool()
    entities = [{"entityId": f"e{index}", "conceptId": "c"} for index in range(WRITE_CHUNK_ROWS * 2 + 5)]
    assert await store_entities(pool, model_id="m1", revision_id="r1", entities=entities) == len(entities)
    # No budget given: today's chunk size, and the pool's own timeout is left alone.
    assert pool.calls == [(WRITE_CHUNK_ROWS, {}), (WRITE_CHUNK_ROWS, {}), (5, {})]


@pytest.mark.asyncio
async def test_every_write_uses_the_batch_size_and_time_of_the_budget():
    from app.persistence.population_store import (SaveBudget, store_assertions, store_entities,
                                                  store_entity_aliases, store_relationships)

    class Pool:
        def __init__(self):  # type: ignore[no-untyped-def]
            self.calls: list[tuple[str, int, dict]] = []

        async def executemany(self, sql, rows, **options):  # type: ignore[no-untyped-def]
            self.calls.append((sql.split("semantic_population.")[1].split()[0], len(rows), options))

    pool = Pool()
    budget = SaveBudget(rows=100, seconds=120)
    await store_entities(pool, model_id="m", revision_id="r", budget=budget,
                         entities=[{"entityId": f"e{n}"} for n in range(250)])
    await store_entity_aliases(pool, revision_id="r", budget=budget, aliases=[
        {"entityId": "e", "aliasNamespace": "n", "aliasKey": str(n)} for n in range(101)])
    await store_assertions(pool, model_id="m", revision_id="r", budget=budget, assertions=[
        {"entityId": f"e{n}", "attribute": "a", "value": "v"} for n in range(150)])
    await store_relationships(pool, model_id="m", revision_id="r", budget=budget, relationships=[
        {"relationId": "x", "sourceEntityId": f"s{n}", "targetEntityId": "t"} for n in range(100)])
    options = {"timeout": 120}
    assert pool.calls == [("entities", 100, options), ("entities", 100, options), ("entities", 50, options),
                          ("entity_identities", 100, options), ("entity_identities", 1, options),
                          ("assertions", 100, options), ("assertions", 50, options),
                          ("relationships", 100, options)]


@pytest.mark.asyncio
async def test_the_budget_is_told_the_rows_of_each_written_batch():
    from app.persistence.population_store import SaveBudget, store_entities

    class Pool:
        async def executemany(self, _sql, rows, **options):  # type: ignore[no-untyped-def]
            pass

    told: list[int] = []

    async def on_rows(count: int) -> None:
        told.append(count)

    await store_entities(Pool(), model_id="m", revision_id="r", budget=SaveBudget(rows=100, on_rows=on_rows),
                         entities=[{"entityId": f"e{n}"} for n in range(250)])
    assert told == [100, 100, 50]


class Connection:
    def __init__(self, fail_reset: bool = False):  # type: ignore[no-untyped-def]
        self.statements: list[str] = []
        self.fail_reset = fail_reset
        self.terminated = False

    async def execute(self, sql):  # type: ignore[no-untyped-def]
        self.statements.append(sql)
        if self.fail_reset and sql.startswith("RESET"):
            raise OSError("connection lost")

    def terminate(self):  # type: ignore[no-untyped-def]
        self.terminated = True


class PoolOf:
    def __init__(self, connection):  # type: ignore[no-untyped-def]
        self.connection = connection

    def acquire(self):  # type: ignore[no-untyped-def]
        connection = self.connection

        class Held:
            async def __aenter__(self):  # type: ignore[no-untyped-def]
                return connection

            async def __aexit__(self, *exc):  # type: ignore[no-untyped-def]
                return False

        return Held()


@pytest.mark.asyncio
async def test_the_save_connection_allows_the_budget_time_then_gives_the_pool_limit_back():
    from app.persistence.population_store import SaveBudget, save_connection

    connection = Connection()
    with pytest.raises(RuntimeError):
        async with save_connection(PoolOf(connection), SaveBudget(seconds=300)) as held:
            assert held is connection
            raise RuntimeError("a write failed")
    assert connection.statements == ["SET statement_timeout = '300s'", "RESET statement_timeout"]
    assert connection.terminated is False


@pytest.mark.asyncio
async def test_a_connection_that_cannot_be_reset_is_closed_not_returned_with_the_longer_limit():
    from app.persistence.population_store import SaveBudget, save_connection

    connection = Connection(fail_reset=True)
    async with save_connection(PoolOf(connection), SaveBudget(seconds=300)):
        pass
    assert connection.terminated is True
