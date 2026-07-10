"""Durable long-running MCP task queue on Postgres.

When an executor calls a long-running MCP tool, we persist a row here and end
the turn; a background poller reconnects to the MCP server, waits for the task,
and resumes. Multi-worker safe via `SELECT ... FOR UPDATE SKIP LOCKED` — the
canonical Postgres job-queue claim, so with N app replicas each task is handled
by exactly one worker.

`schema` is code-controlled (never user input) and interpolated into DDL/queries;
values are always passed as bound parameters.
"""
from __future__ import annotations

from typing import Optional

import asyncpg

STATUS_PENDING = "pending"
STATUS_CLAIMED = "claimed"
STATUS_DONE = "done"
STATUS_FAILED = "failed"


def _table(schema: str) -> str:
    return f'"{schema}".mcp_tasks'


async def init_schema(pool: asyncpg.Pool, schema: str = "public") -> None:
    t = _table(schema)
    async with pool.acquire() as con:
        await con.execute(f'CREATE SCHEMA IF NOT EXISTS "{schema}"')
        await con.execute(f"""
            CREATE TABLE IF NOT EXISTS {t} (
                id           BIGSERIAL PRIMARY KEY,
                session_id   TEXT NOT NULL,
                user_id      TEXT NOT NULL,
                run_id       TEXT,
                step_id      TEXT,
                tool_call_id TEXT,
                server_name  TEXT,
                server_url   TEXT,          -- reconnect target (streamable-http)
                auth_headers JSONB,         -- per-user connector auth captured at call time
                task_id      TEXT NOT NULL,
                mode         TEXT NOT NULL DEFAULT 'record',  -- record | resume
                status       TEXT NOT NULL DEFAULT 'pending',
                worker_id    TEXT,
                claimed_at   TIMESTAMPTZ,
                attempts     INT  NOT NULL DEFAULT 0,
                result       TEXT,
                created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        """)
        await con.execute(
            f"ALTER TABLE {t} ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'record'")
        await con.execute(
            f'CREATE INDEX IF NOT EXISTS mcp_tasks_status_idx ON {t}(status)'
        )


async def enqueue(pool: asyncpg.Pool, *, session_id: str, user_id: str, task_id: str,
                  server_name: str, server_url: str = "", auth_headers: Optional[dict] = None,
                  mode: str = "record", step_id: str = "", tool_call_id: str = "",
                  run_id: str = "", schema: str = "public") -> int:
    import json
    t = _table(schema)
    async with pool.acquire() as con:
        return await con.fetchval(
            f"""INSERT INTO {t} (session_id,user_id,run_id,step_id,tool_call_id,
                                 server_name,server_url,auth_headers,task_id,mode)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id""",
            session_id, user_id, run_id, step_id, tool_call_id, server_name,
            server_url, json.dumps(auth_headers or {}), task_id, mode,
        )


async def claim(pool: asyncpg.Pool, worker_id: str, schema: str = "public") -> Optional[asyncpg.Record]:
    """Atomically take one pending row. Returns None if the queue is empty.
    Safe under concurrent workers — SKIP LOCKED means no two claim the same row."""
    t = _table(schema)
    async with pool.acquire() as con:
        return await con.fetchrow(
            f"""
            UPDATE {t} SET status='claimed', worker_id=$1, claimed_at=now(), updated_at=now()
            WHERE id = (
                SELECT id FROM {t}
                WHERE status='pending'
                ORDER BY created_at
                FOR UPDATE SKIP LOCKED
                LIMIT 1
            )
            RETURNING *
            """,
            worker_id,
        )


async def mark_done(pool: asyncpg.Pool, task_row_id: int, result: str, schema: str = "public") -> None:
    t = _table(schema)
    async with pool.acquire() as con:
        await con.execute(
            f"UPDATE {t} SET status='done', result=$2, updated_at=now() WHERE id=$1",
            task_row_id, result,
        )


async def requeue(pool: asyncpg.Pool, task_row_id: int, *, max_attempts: int = 5,
                  reason: str = "", schema: str = "public") -> str:
    """Return a claimed row to the queue; mark failed once attempts are exhausted.
    Returns the resulting status ('pending' | 'failed')."""
    t = _table(schema)
    async with pool.acquire() as con:
        return await con.fetchval(
            f"""
            UPDATE {t}
            SET attempts = attempts + 1,
                status = CASE WHEN attempts + 1 >= $2 THEN 'failed' ELSE 'pending' END,
                worker_id = NULL,
                result = CASE WHEN attempts + 1 >= $2 THEN $3 ELSE result END,
                updated_at = now()
            WHERE id = $1
            RETURNING status
            """,
            task_row_id, max_attempts, reason,
        )


async def reclaim_stale(pool: asyncpg.Pool, older_than_seconds: int = 300, schema: str = "public") -> int:
    """Return rows whose claiming worker died mid-resume back to pending."""
    t = _table(schema)
    async with pool.acquire() as con:
        result = await con.execute(
            f"""UPDATE {t} SET status='pending', worker_id=NULL, updated_at=now()
                WHERE status='claimed'
                  AND claimed_at < now() - ($1 || ' seconds')::interval""",
            str(older_than_seconds),
        )
        # result like "UPDATE N"
        return int(result.split()[-1]) if result else 0
