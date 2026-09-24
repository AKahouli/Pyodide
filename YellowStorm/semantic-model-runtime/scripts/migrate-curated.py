"""Apply the idempotent PostgREST curated schema to the configured database."""

from __future__ import annotations

import asyncio
import os
from pathlib import Path

import asyncpg

SQL = (
    Path(__file__).resolve().parents[1]
    / "deploy"
    / "data-plane"
    / "sql"
    / "001_curated_api.sql"
)


async def migrate() -> None:
    dsn = os.environ.get("SEMANTIC_RUNTIME_DATABASE_URL")
    if not dsn:
        raise SystemExit("SEMANTIC_RUNTIME_DATABASE_URL is required")
    connection = await asyncpg.connect(dsn, command_timeout=30)
    try:
        await connection.execute(SQL.read_text(encoding="utf-8"))
    finally:
        await connection.close()


if __name__ == "__main__":
    asyncio.run(migrate())
