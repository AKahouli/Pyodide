"""Apply runtime-owned SQL migrations with checksum verification.

Run only through the required environment:
  conda run -n meta python scripts/migrate.py
"""

from __future__ import annotations

import asyncio
import hashlib
import os
from pathlib import Path

import asyncpg

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "migrations"


async def migrate() -> None:
    dsn = os.environ.get("SEMANTIC_RUNTIME_DATABASE_URL")
    if not dsn:
        raise SystemExit("SEMANTIC_RUNTIME_DATABASE_URL is required")
    connection = await asyncpg.connect(dsn, command_timeout=30)
    try:
        await connection.execute("CREATE SCHEMA IF NOT EXISTS semantic_jobs")
        await connection.execute(
            """
            CREATE TABLE IF NOT EXISTS semantic_jobs.schema_migrations (
              version TEXT PRIMARY KEY,
              checksum TEXT NOT NULL,
              applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
            """
        )
        for path in sorted(MIGRATIONS.glob("*.sql")):
            sql = path.read_text(encoding="utf-8")
            checksum = hashlib.sha256(sql.encode()).hexdigest()
            existing = await connection.fetchval(
                "SELECT checksum FROM semantic_jobs.schema_migrations WHERE version = $1",
                path.name,
            )
            if existing:
                if existing != checksum:
                    raise RuntimeError(f"migration checksum mismatch: {path.name}")
                continue
            async with connection.transaction():
                await connection.execute(sql)
                await connection.execute(
                    "INSERT INTO semantic_jobs.schema_migrations (version, checksum) VALUES ($1, $2)",
                    path.name,
                    checksum,
                )
    finally:
        await connection.close()


if __name__ == "__main__":
    asyncio.run(migrate())
