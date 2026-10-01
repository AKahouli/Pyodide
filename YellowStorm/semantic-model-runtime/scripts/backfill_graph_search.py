"""Request the search index of every bound data revision that does not have one.

For models populated before graph search existed. Only admits durable index
jobs (the search worker builds them); nothing is re-read or repopulated.

  conda run -n meta python scripts/backfill_graph_search.py            # every model
  conda run -n meta python scripts/backfill_graph_search.py <model-id>
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

import asyncpg
from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.graph_search.indexer import IndexUnavailable, request_index  # noqa: E402
from app.jobs.service import JobService  # noqa: E402
from app.persistence.postgres_jobs import PostgresJobRepository  # noqa: E402


async def backfill(model_id: str | None) -> None:
    pool = await asyncpg.create_pool(os.environ["SEMANTIC_RUNTIME_DATABASE_URL"], min_size=1, max_size=2)
    try:
        admit = JobService(PostgresJobRepository(pool)).admit
        revisions = await pool.fetch(
            "SELECT DISTINCT model_id, data_revision_id FROM semantic_runtime.active_bindings "
            "WHERE environment IN ('draft', 'production') AND ($1::text IS NULL OR model_id = $1) "
            "ORDER BY model_id, data_revision_id", model_id)
        for row in revisions:
            try:
                requested = await request_index(pool, admit, revision_id=row["data_revision_id"])
            except IndexUnavailable as exc:
                print(f"{row['model_id']} {row['data_revision_id']}: skipped ({exc.code})")
                continue
            generation = requested["generation"] or {}
            print(f"{row['model_id']} {row['data_revision_id']}: {generation.get('state')}")
    finally:
        await pool.close()


if __name__ == "__main__":
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
    asyncio.run(backfill(sys.argv[1] if len(sys.argv) > 1 else None))
