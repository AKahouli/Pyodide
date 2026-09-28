"""Manual source snapshots: rows and explicit links people entered by hand.

A snapshot is written in batches, then committed with its expected counts;
committed snapshots are immutable and are what population runs read.
"""

from __future__ import annotations

import json
from typing import Any

MAX_BATCH_ROWS = 500


class ManualSnapshotError(ValueError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


async def append_batch(pool: Any, *, model_id: str, snapshot_id: str,
                       rows: list[dict[str, Any]], links: list[dict[str, Any]]) -> None:
    async with pool.acquire() as connection:
        async with connection.transaction():
            await connection.execute(
                "INSERT INTO semantic_population.manual_snapshots (id, model_id) VALUES ($1, $2) "
                "ON CONFLICT (id) DO NOTHING", snapshot_id, model_id)
            current = await connection.fetchrow(
                "SELECT model_id, committed_at FROM semantic_population.manual_snapshots "
                "WHERE id = $1 FOR UPDATE", snapshot_id)
            if current["model_id"] != model_id:
                raise ManualSnapshotError("snapshot_model_mismatch")
            # The id hashes the content, so a sealed snapshot already holds these rows.
            if current["committed_at"] is not None:
                return
            if rows:
                await connection.executemany(
                    'INSERT INTO semantic_population.manual_rows (snapshot_id, concept_id, row_key, label, "values") '
                    "VALUES ($1, $2, $3, $4, $5::jsonb) ON CONFLICT (snapshot_id, row_key) DO UPDATE "
                    'SET concept_id = EXCLUDED.concept_id, label = EXCLUDED.label, "values" = EXCLUDED."values"',
                    [(snapshot_id, row["conceptId"], row["rowKey"], row.get("label") or "",
                      json.dumps(row.get("values") or {})) for row in rows])
            if links:
                await connection.executemany(
                    "INSERT INTO semantic_population.manual_links "
                    "(snapshot_id, relation_id, source_row_key, target_row_key) VALUES ($1, $2, $3, $4) "
                    "ON CONFLICT DO NOTHING",
                    [(snapshot_id, link["relationId"], link["sourceRowKey"], link["targetRowKey"])
                     for link in links])


async def commit_snapshot(pool: Any, *, model_id: str, snapshot_id: str,
                          row_count: int, link_count: int) -> bool:
    """Seal the snapshot when its stored counts match; False when it was already sealed."""
    async with pool.acquire() as connection:
        async with connection.transaction():
            current = await connection.fetchrow(
                "SELECT model_id, committed_at, row_count, link_count "
                "FROM semantic_population.manual_snapshots WHERE id = $1 FOR UPDATE", snapshot_id)
            if current is None:
                if row_count == 0 and link_count == 0:
                    await connection.execute(
                        "INSERT INTO semantic_population.manual_snapshots "
                        "(id, model_id, row_count, link_count, committed_at) VALUES ($1, $2, 0, 0, now())",
                        snapshot_id, model_id)
                    return True
                raise ManualSnapshotError("snapshot_not_found")
            if current["model_id"] != model_id:
                raise ManualSnapshotError("snapshot_model_mismatch")
            if current["committed_at"] is not None:
                if (current["row_count"], current["link_count"]) != (row_count, link_count):
                    raise ManualSnapshotError("snapshot_count_mismatch")
                return False
            stored_rows = await connection.fetchval(
                "SELECT count(*) FROM semantic_population.manual_rows WHERE snapshot_id = $1", snapshot_id)
            stored_links = await connection.fetchval(
                "SELECT count(*) FROM semantic_population.manual_links WHERE snapshot_id = $1", snapshot_id)
            if (int(stored_rows), int(stored_links)) != (row_count, link_count):
                raise ManualSnapshotError("snapshot_count_mismatch")
            await connection.execute(
                "UPDATE semantic_population.manual_snapshots SET row_count = $2, link_count = $3, "
                "committed_at = now() WHERE id = $1", snapshot_id, row_count, link_count)
            return True


async def is_committed(pool: Any, snapshot_id: str) -> bool:
    return bool(await pool.fetchval(
        "SELECT committed_at IS NOT NULL FROM semantic_population.manual_snapshots WHERE id = $1",
        snapshot_id))


async def read_snapshot_rows(pool: Any, snapshot_id: str, concept_id: str) -> list[dict[str, Any]]:
    rows = await pool.fetch(
        'SELECT row_key, label, "values" FROM semantic_population.manual_rows '
        "WHERE snapshot_id = $1 AND concept_id = $2 ORDER BY row_key", snapshot_id, concept_id)
    return [{"rowKey": row["row_key"], "label": row["label"],
             "values": json.loads(row["values"]) if isinstance(row["values"], str)
             else dict(row["values"] or {})} for row in rows]


async def read_snapshot_links(pool: Any, snapshot_id: str) -> list[dict[str, Any]]:
    rows = await pool.fetch(
        "SELECT relation_id, source_row_key, target_row_key FROM semantic_population.manual_links "
        "WHERE snapshot_id = $1 ORDER BY relation_id, source_row_key, target_row_key", snapshot_id)
    return [{"relationId": row["relation_id"], "sourceRowKey": row["source_row_key"],
             "targetRowKey": row["target_row_key"]} for row in rows]
