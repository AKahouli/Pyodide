"""Apply the idempotent PostgREST curated schema to the configured database.

Every ``deploy/data-plane/sql/*.sql`` file is applied in numeric-prefix order. The runner
deliberately discovers the files instead of naming one: a migration that exists in Git but
is never executed leaves a deployment looking correct while it runs weaker RLS than the
repository describes.
"""

from __future__ import annotations

import asyncio
import os
import re
from pathlib import Path

import asyncpg

SQL_DIR = Path(__file__).resolve().parents[1] / "deploy" / "data-plane" / "sql"

_PREFIX = re.compile(r"^(\d+)")


def _order(path: Path) -> tuple[int, str]:
    """Sort by the numeric prefix so 002 follows 001 and 010 does not precede 002."""
    match = _PREFIX.match(path.name)
    if not match:
        raise SystemExit(f"{path.name} has no numeric prefix; migration order would be ambiguous")
    return int(match.group(1)), path.name


def migrations() -> list[Path]:
    files = sorted(SQL_DIR.glob("*.sql"), key=_order)
    if not files:
        raise SystemExit(f"No migrations found in {SQL_DIR}")
    return files


async def migrate() -> None:
    dsn = os.environ.get("SEMANTIC_RUNTIME_DATABASE_URL")
    if not dsn:
        raise SystemExit("SEMANTIC_RUNTIME_DATABASE_URL is required")
    files = migrations()
    connection = await asyncpg.connect(dsn, command_timeout=30)
    try:
        for path in files:
            print(f"applying {path.name}", flush=True)
            # One transaction per file: a failure leaves the earlier migrations applied and
            # the failing one whole, rather than half of it.
            async with connection.transaction():
                await connection.execute(path.read_text(encoding="utf-8"))
        print(f"applied {len(files)} migration(s)", flush=True)
    finally:
        await connection.close()


if __name__ == "__main__":
    asyncio.run(migrate())
