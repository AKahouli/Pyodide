"""Partitions of the per-revision tables (migration 031): names, creation, drops, lock retries."""

from __future__ import annotations

import asyncpg
import pytest

from app.persistence import partitions


class Connection:
    def __init__(self, existing: set[str] | None = None) -> None:
        self.existing = existing or set()
        self.statements: list[str] = []

    async def execute(self, sql: str, *params, timeout=None):  # type: ignore[no-untyped-def]
        self.statements.append(sql)

    async def fetch(self, sql: str, *params):  # type: ignore[no-untyped-def]
        assert "FROM pg_class" in sql
        return [{"relname": name} for name in params[1] if name in self.existing]


def test_partition_names_are_deterministic_and_fit_an_identifier():
    name = partitions.partition_name("assertion_candidates", "dr_" + "a" * 24)
    assert name == partitions.partition_name("assertion_candidates", "dr_" + "a" * 24)
    assert name != partitions.partition_name("assertion_candidates", "dr_" + "b" * 24)
    assert name != partitions.partition_name("assertions", "dr_" + "a" * 24)
    assert len(name) <= 63 and name.replace("_", "").isalnum() and name == name.lower()
    # Whatever the key, the name stays short and plain.
    assert len(partitions.partition_name("entity_identities", "x" * 200)) <= 63


def test_a_key_that_is_not_a_generated_id_is_refused():
    assert partitions._literal("dr_0123abcd:x-1.2") == "'dr_0123abcd:x-1.2'"
    for key in ("", "a'b", "a b", "a;DROP", "x" * 201, "é"):
        with pytest.raises(ValueError):
            partitions._literal(key)


def test_a_generation_key_is_the_canonical_uuid_text():
    assert partitions.generation_key("00000000-0000-4000-8000-00000000000A") == "00000000-0000-4000-8000-00000000000a"
    with pytest.raises(ValueError):
        partitions.generation_key("not-a-uuid")


@pytest.mark.asyncio
async def test_ensure_creates_each_missing_partition_standalone_then_attaches_it():
    connection = Connection(existing={partitions.partition_name("entities", "dr_a")})
    await partitions.ensure_revision_partitions(connection, "dr_a")
    assert connection.statements[0].startswith("SELECT pg_advisory_xact_lock")
    ddl = connection.statements[1:]
    # Four of the five are missing; each is a table of its own, attached (never PARTITION OF, which
    # would lock the parent exclusively).
    assert len(ddl) == 8
    assert not any("PARTITION OF" in statement for statement in ddl)
    assert all("INCLUDING INDEXES" in create and "ATTACH PARTITION" in attach and "FOR VALUES IN ('dr_a')" in attach
               for create, attach in zip(ddl[::2], ddl[1::2]))
    assert '"' + partitions.partition_name("entities", "dr_a") + '"' not in "\n".join(ddl)
    assert '"semantic_population"."entity_identities"' in ddl[1]


@pytest.mark.asyncio
async def test_ensure_does_nothing_for_a_revision_that_has_its_partitions():
    existing = {partitions.partition_name(table.name, "dr_a") for table in partitions.REVISION_TABLES}
    connection = Connection(existing)
    await partitions.ensure_revision_partitions(connection, "dr_a")
    assert len(connection.statements) == 1


@pytest.mark.asyncio
async def test_a_generation_is_partitioned_by_its_index_id():
    index_id = "0b6f1d2e-0000-4000-8000-00000000000a"
    connection = Connection()
    await partitions.ensure_generation_partitions(connection, index_id)
    ddl = "\n".join(connection.statements)
    assert f"FOR VALUES IN ('{index_id}')" in ddl and '"semantic_graph_search"."entity_passages"' in ddl


@pytest.mark.asyncio
async def test_drop_removes_the_referencing_tables_first_then_detaches_and_drops_the_referenced_one():
    keys = ["dr_a", "dr_b"]
    existing = {partitions.partition_name(table.name, key) for table in partitions.REVISION_TABLES for key in keys}
    connection = Connection(existing)
    counts = await partitions.drop_revision_partitions(connection, ["dr_b", "dr_a", "dr_a"])
    assert counts == {table.name: 2 for table in partitions.REVISION_TABLES}
    drops = [s for s in connection.statements if s.startswith("DROP TABLE ")]
    detached = [s for s in connection.statements if "DETACH PARTITION" in s]
    assert len(drops) == 2 and len(detached) == 2
    assert all('"semantic_population"."entities"' in s for s in detached)

    def quoted(table: str, key: str) -> str:
        return '"' + partitions.partition_name(table, key) + '"'

    referencing, referenced = drops
    for table in partitions.REVISION_TABLES[:-1]:
        assert all(quoted(table.name, key) in referencing for key in keys)
    assert all(quoted("entities", key) in referenced and quoted("entities", key) not in referencing for key in keys)
    # Rows referencing a partition forbid detaching it: the referencing partitions are gone by then.
    assert connection.statements == [referencing, *detached, referenced]


@pytest.mark.asyncio
async def test_drop_skips_partitions_that_are_not_there():
    connection = Connection()
    counts = await partitions.drop_revision_partitions(connection, ["dr_a"])
    assert set(counts.values()) == {0} and connection.statements == []
    assert await partitions.drop_generation_partitions(connection, []) == {"entity_documents": 0, "entity_passages": 0}


class Pool:
    def __init__(self) -> None:
        self.transactions = 0
        self.statements: list[str] = []

    def acquire(self):  # type: ignore[no-untyped-def]
        return self

    def transaction(self):  # type: ignore[no-untyped-def]
        self.transactions += 1
        return self

    async def __aenter__(self):  # type: ignore[no-untyped-def]
        return self

    async def __aexit__(self, *_args):  # type: ignore[no-untyped-def]
        return None

    async def execute(self, sql: str, *params):  # type: ignore[no-untyped-def]
        self.statements.append(sql)


@pytest.fixture
def no_pause(monkeypatch: pytest.MonkeyPatch) -> None:
    async def no_wait(_seconds: float) -> None:
        return None

    monkeypatch.setattr(partitions.asyncio, "sleep", no_wait)


@pytest.mark.asyncio
async def test_a_lock_conflict_runs_the_whole_transaction_again(no_pause):  # type: ignore[no-untyped-def]
    pool = Pool()
    failures = [asyncpg.exceptions.LockNotAvailableError("lock"), asyncpg.exceptions.DeadlockDetectedError("dead")]

    async def work(connection):  # type: ignore[no-untyped-def]
        if failures:
            raise failures.pop(0)
        return "done"

    assert await partitions.with_partition_locks(pool, work, statement_timeout_s=60) == "done"
    assert pool.transactions == 3
    assert pool.statements[:2] == ["SET LOCAL statement_timeout = '60s'",
                                   f"SET LOCAL lock_timeout = '{partitions.LOCK_TIMEOUT_S}s'"]


@pytest.mark.asyncio
async def test_a_lock_that_stays_taken_is_reported(no_pause):  # type: ignore[no-untyped-def]
    pool = Pool()

    async def stuck(connection):  # type: ignore[no-untyped-def]
        raise asyncpg.exceptions.LockNotAvailableError("lock")

    with pytest.raises(asyncpg.exceptions.LockNotAvailableError):
        await partitions.with_partition_locks(pool, stuck)
    assert pool.transactions == partitions.LOCK_ATTEMPTS


@pytest.mark.asyncio
async def test_other_errors_are_not_retried(no_pause):  # type: ignore[no-untyped-def]
    pool = Pool()

    async def broken(connection):  # type: ignore[no-untyped-def]
        raise ValueError("no")

    with pytest.raises(ValueError):
        await partitions.with_partition_locks(pool, broken)
    assert pool.transactions == 1
