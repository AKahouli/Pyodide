"""Partitions of the tables a data revision or a search index generation owns (migration 031).

The big per-revision tables are LIST-partitioned, one partition per key value, so clearing a
model's data drops partitions (a catalog change) instead of deleting every row through the
ON DELETE CASCADE chain. A partition is created in the transaction that creates its revision or
generation, and dropped in the transaction that deletes it. Rows cannot be written for a key
without a partition (there is no default partition on purpose).

Locks. A partition is created as a standalone table and attached (``ATTACH PARTITION`` takes
SHARE UPDATE EXCLUSIVE on the parent, and the foreign keys it adds SHARE ROW EXCLUSIVE on the
tables they point at: other models' writers wait for those few milliseconds, readers do not;
``CREATE TABLE ... PARTITION OF`` would take ACCESS EXCLUSIVE and stop the readers too). Dropping or detaching one takes ACCESS EXCLUSIVE on the parent for the rest of the
transaction, so every caller runs through ``with_partition_locks``: a short ``lock_timeout`` and a
few retries instead of queueing every other query on the table behind a long reader.
``DETACH ... CONCURRENTLY`` is not used: it cannot run inside a transaction, so the drops could no
longer be atomic with the deletion of the small parent rows.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import re
import uuid
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Iterable, TypeVar

import asyncpg

logger = logging.getLogger(__name__)

T = TypeVar("T")

# How long a statement of a partition operation may wait for a lock, and how many times the whole
# transaction is tried again after a lock timeout or a deadlock.
LOCK_TIMEOUT_S = 5
LOCK_ATTEMPTS = 5
_RETRY_PAUSE_S = 0.5

_KEY = re.compile(r"^[A-Za-z0-9_.:-]{1,200}$")


@dataclass(frozen=True)
class PartitionedTable:
    schema: str
    name: str
    # Other partitioned tables reference its partitions: they are dropped first, and it is detached
    # (which checks that no row still references the partition) before it is dropped.
    referenced: bool = False


# The order is the lock order of every operation, creation and drop alike (the referencing tables
# first, the referenced one last), so two of them cannot wait for each other.
REVISION_TABLES = (
    PartitionedTable("semantic_population", "entity_identities"),
    PartitionedTable("semantic_population", "assertions"),
    PartitionedTable("semantic_population", "assertion_candidates"),
    PartitionedTable("semantic_population", "relationships"),
    PartitionedTable("semantic_population", "entities", referenced=True),
)
GENERATION_TABLES = (
    PartitionedTable("semantic_graph_search", "entity_passages"),
    PartitionedTable("semantic_graph_search", "entity_documents", referenced=True),
)


def partition_name(table: str, key: str) -> str:
    """Deterministic name of the partition of ``table`` holding ``key``: a hash, so any key gives a
    valid identifier of bounded length."""
    return f"{table}_{hashlib.sha256(key.encode('utf-8')).hexdigest()[:16]}"


def _quote(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def _qualified(schema: str, name: str) -> str:
    return f"{_quote(schema)}.{_quote(name)}"


def _literal(key: str) -> str:
    # Partition bounds take a literal, not a parameter. Keys are generated ids; refuse any other.
    if not _KEY.match(key):
        raise ValueError(f"not a valid partition key: {key!r}")
    return "'" + key.replace("'", "''") + "'"


def generation_key(index_id: Any) -> str:
    """The canonical text of a generation id (what its partitions are named and bounded by)."""
    return str(uuid.UUID(str(index_id)))


async def with_partition_locks(pool: Any, work: Callable[[Any], Awaitable[T]], *,
                               statement_timeout_s: int | None = None) -> T:
    """Run ``work(connection)`` in one transaction that waits at most ``LOCK_TIMEOUT_S`` for each lock,
    and run it again (a new transaction) after a lock timeout or a deadlock."""
    for attempt in range(1, LOCK_ATTEMPTS + 1):
        try:
            async with pool.acquire() as connection:
                async with connection.transaction():
                    if statement_timeout_s is not None:
                        await connection.execute(f"SET LOCAL statement_timeout = '{int(statement_timeout_s)}s'")
                    await connection.execute(f"SET LOCAL lock_timeout = '{LOCK_TIMEOUT_S}s'")
                    return await work(connection)
        except (asyncpg.exceptions.LockNotAvailableError, asyncpg.exceptions.DeadlockDetectedError) as error:
            if attempt == LOCK_ATTEMPTS:
                raise
            logger.warning("partition lock conflict (%s); attempt %d of %d", type(error).__name__,
                           attempt, LOCK_ATTEMPTS)
            await asyncio.sleep(_RETRY_PAUSE_S * attempt)
    raise AssertionError("unreachable")


async def _existing(connection: Any, schema: str, names: Iterable[str]) -> set[str]:
    rows = await connection.fetch(
        "SELECT relname FROM pg_class WHERE relnamespace = $1::text::regnamespace AND relname = ANY($2::text[])",
        schema, sorted(set(names)))
    return {row["relname"] for row in rows}


async def _ensure(connection: Any, tables: tuple[PartitionedTable, ...], key: str) -> None:
    bound = _literal(key)
    # Two creators of the same key (a retried task) take turns instead of failing on the name.
    await connection.execute("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", f"partitions:{key}")
    present = await _existing(connection, tables[0].schema,
                              (partition_name(table.name, key) for table in tables))
    for table in tables:
        name = partition_name(table.name, key)
        if name in present:
            continue
        parent, child = _qualified(table.schema, table.name), _qualified(table.schema, name)
        await connection.execute(
            f"CREATE TABLE {child} (LIKE {parent} INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)")
        await connection.execute(f"ALTER TABLE {parent} ATTACH PARTITION {child} FOR VALUES IN ({bound})")


async def ensure_revision_partitions(connection: Any, revision_id: str) -> None:
    """Create the partitions of a data revision (a no-op for those that exist). Call it before the
    revision row is inserted: attaching them locks the revisions table against other writers, which
    must not be a lock upgrade of one already held."""
    await _ensure(connection, REVISION_TABLES, revision_id)


async def ensure_generation_partitions(connection: Any, index_id: Any) -> None:
    """Create the partitions of a search index generation (before its row is inserted, as above)."""
    await _ensure(connection, GENERATION_TABLES, generation_key(index_id))


async def _drop(connection: Any, tables: tuple[PartitionedTable, ...], keys: list[str],
                timeout: float | None = None) -> dict[str, int]:
    """Drop the partitions of ``keys``: the referencing tables' first, in one statement, then the
    referenced table's, detached before they are dropped (a drop would need ``CASCADE`` to remove the
    foreign keys that point at the partition; a detach removes exactly those)."""
    if not keys:
        return {table.name: 0 for table in tables}
    options = {} if timeout is None else {"timeout": timeout}
    schema = tables[0].schema
    wanted = {table.name: {partition_name(table.name, key) for key in keys} for table in tables}
    present = await _existing(connection, schema, (name for names in wanted.values() for name in names))
    found = {table.name: sorted(wanted[table.name] & present) for table in tables}
    referencing = [_qualified(schema, name) for table in tables if not table.referenced
                   for name in found[table.name]]
    if referencing:
        await connection.execute("DROP TABLE " + ", ".join(referencing), **options)
    for table in tables:
        if table.referenced and found[table.name]:
            for name in found[table.name]:
                await connection.execute(
                    f"ALTER TABLE {_qualified(schema, table.name)} DETACH PARTITION {_qualified(schema, name)}",
                    **options)
            await connection.execute(
                "DROP TABLE " + ", ".join(_qualified(schema, name) for name in found[table.name]), **options)
    return {table.name: len(found[table.name]) for table in tables}


async def drop_revision_partitions(connection: Any, revision_ids: Iterable[str],
                                   timeout: float | None = None) -> dict[str, int]:
    """Drop the partitions of data revisions, inside the caller's ``with_partition_locks``
    transaction; returns how many were dropped per table. Missing partitions are skipped."""
    return await _drop(connection, REVISION_TABLES, sorted(set(revision_ids)), timeout)


async def drop_generation_partitions(connection: Any, index_ids: Iterable[Any],
                                     timeout: float | None = None) -> dict[str, int]:
    """Drop the partitions of search index generations (same rules as for revisions)."""
    return await _drop(connection, GENERATION_TABLES, sorted({generation_key(i) for i in index_ids}), timeout)
