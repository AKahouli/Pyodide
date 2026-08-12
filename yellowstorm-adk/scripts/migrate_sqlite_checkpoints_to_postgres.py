"""One-time migration of Flow Engine checkpoints from SQLite to PostgreSQL."""

from __future__ import annotations

import argparse
import asyncio
import os
from collections import defaultdict
from pathlib import Path
from typing import Any

from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

from src.config.settings import get_settings
from src.flow_engine.runtime.checkpointer import close_checkpointer, init_checkpointer


async def migrate(
    sqlite_path: Path,
    schema: str,
    connection_string: str | None = None,
) -> tuple[int, int]:
    if not sqlite_path.is_file():
        raise FileNotFoundError(f"SQLite checkpoint database not found: {sqlite_path}")

    target = await init_checkpointer(connection_string, schema=schema)
    checkpoint_count = 0
    write_count = 0
    try:
        async with AsyncSqliteSaver.from_conn_string(str(sqlite_path)) as source:
            async for item in source.alist(None):
                configurable = item.config["configurable"]
                parent_config = item.parent_config or {
                    "configurable": {
                        "thread_id": configurable["thread_id"],
                        "checkpoint_ns": configurable.get("checkpoint_ns", ""),
                    }
                }
                await target.aput(
                    parent_config,
                    item.checkpoint,
                    item.metadata,
                    item.checkpoint["channel_versions"],
                )
                checkpoint_count += 1
                if checkpoint_count % 100 == 0:
                    print(f"Migrated {checkpoint_count} checkpoints", flush=True)

                writes_by_task: dict[str, list[tuple[str, Any]]] = defaultdict(list)
                for task_id, channel, value in item.pending_writes:
                    writes_by_task[task_id].append((channel, value))
                    write_count += 1
                for task_id, writes in writes_by_task.items():
                    await target.aput_writes(item.config, writes, task_id)
    finally:
        await close_checkpointer()

    return checkpoint_count, write_count


def main() -> None:
    if os.name == "nt":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    settings = get_settings()
    parser = argparse.ArgumentParser()
    parser.add_argument("sqlite_path", type=Path)
    parser.add_argument(
        "--schema",
        default=settings.LANGGRAPH_CHECKPOINT_SCHEMA,
        help="Validated target PostgreSQL schema",
    )
    args = parser.parse_args()
    checkpoints, writes = asyncio.run(migrate(args.sqlite_path, args.schema))
    print(f"Migrated {checkpoints} checkpoints and {writes} pending writes")


if __name__ == "__main__":
    main()
