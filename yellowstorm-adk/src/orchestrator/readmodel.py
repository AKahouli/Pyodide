"""Client read model on Postgres — the tables ElectricSQL syncs to the client.

CQRS read side: the orchestrator projects the client-facing slice (session, plan,
per-step status, messages) here as it runs; the client reads it live via Electric.
Row-per-step so parallel work shows as many independent row updates.

Only these tables are published to Electric — ADK's own session tables and the
mcp_tasks queue stay internal.
"""
from __future__ import annotations

from typing import List, Optional, Tuple

import asyncpg


def _q(schema: str, name: str) -> str:
    return f'"{schema}".{name}'


async def init_schema(pool: asyncpg.Pool, schema: str = "public") -> None:
    async with pool.acquire() as con:
        await con.execute(f'CREATE SCHEMA IF NOT EXISTS "{schema}"')
        await con.execute(f"""
            CREATE TABLE IF NOT EXISTS {_q(schema,'sessions')} (
                id         TEXT PRIMARY KEY,
                user_id    TEXT NOT NULL,
                title      TEXT,
                status     TEXT NOT NULL DEFAULT 'pending',
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )""")
        await con.execute(f"""
            CREATE TABLE IF NOT EXISTS {_q(schema,'plans')} (
                session_id TEXT PRIMARY KEY,
                id         TEXT NOT NULL,
                title      TEXT,
                goal       TEXT,
                status     TEXT NOT NULL DEFAULT 'pending',
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )""")
        await con.execute(f"""
            CREATE TABLE IF NOT EXISTS {_q(schema,'plan_steps')} (
                session_id     TEXT NOT NULL,
                step_id        TEXT NOT NULL,
                ordinal        INT  NOT NULL,
                wave           INT  NOT NULL DEFAULT 0,
                status         TEXT NOT NULL DEFAULT 'pending',
                description    TEXT,
                depends_on     TEXT,          -- comma-joined step ids
                agent          TEXT,
                result         TEXT,
                blocked_reason TEXT,
                updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
                PRIMARY KEY (session_id, step_id)
            )""")
        await con.execute(f"""
            CREATE TABLE IF NOT EXISTS {_q(schema,'messages')} (
                id         TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                role       TEXT NOT NULL,
                content    TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )""")


class ReadModel:
    """Best-effort projection — callers wrap in try/except so a read-model write
    never breaks the agent run."""

    def __init__(self, pool: asyncpg.Pool, schema: str = "public"):
        self._pool = pool
        self._schema = schema

    async def ensure_session(self, session_id: str, user_id: str,
                             title: Optional[str], status: str) -> None:
        async with self._pool.acquire() as con:
            await con.execute(f"""
                INSERT INTO {_q(self._schema,'sessions')} (id,user_id,title,status)
                VALUES ($1,$2,$3,$4)
                ON CONFLICT (id) DO UPDATE
                  SET title=COALESCE(EXCLUDED.title, {_q(self._schema,'sessions')}.title),
                      status=EXCLUDED.status, updated_at=now()
            """, session_id, user_id, title, status)

    async def set_session_status(self, session_id: str, status: str) -> None:
        async with self._pool.acquire() as con:
            await con.execute(
                f"UPDATE {_q(self._schema,'sessions')} SET status=$2, updated_at=now() WHERE id=$1",
                session_id, status)

    async def upsert_plan(self, session_id: str, plan_id: str, title: str,
                          goal: str, status: str) -> None:
        async with self._pool.acquire() as con:
            await con.execute(f"""
                INSERT INTO {_q(self._schema,'plans')} (session_id,id,title,goal,status)
                VALUES ($1,$2,$3,$4,$5)
                ON CONFLICT (session_id) DO UPDATE
                  SET id=EXCLUDED.id, title=EXCLUDED.title, goal=EXCLUDED.goal,
                      status=EXCLUDED.status, updated_at=now()
            """, session_id, plan_id, title, goal, status)

    async def upsert_steps(self, session_id: str,
                           steps: List[Tuple[str, int, int, str, str, str, str]]) -> None:
        """steps: (step_id, ordinal, wave, status, description, depends_on, agent)."""
        async with self._pool.acquire() as con:
            await con.executemany(f"""
                INSERT INTO {_q(self._schema,'plan_steps')}
                    (session_id,step_id,ordinal,wave,status,description,depends_on,agent)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
                ON CONFLICT (session_id,step_id) DO UPDATE
                  SET ordinal=EXCLUDED.ordinal, wave=EXCLUDED.wave,
                      description=EXCLUDED.description, depends_on=EXCLUDED.depends_on,
                      updated_at=now()
            """, [(session_id, *s) for s in steps])

    async def set_step_status(self, session_id: str, step_id: str, status: str, *,
                              agent: Optional[str] = None, result: Optional[str] = None,
                              blocked_reason: Optional[str] = None) -> None:
        async with self._pool.acquire() as con:
            await con.execute(f"""
                UPDATE {_q(self._schema,'plan_steps')}
                SET status=$3,
                    agent=COALESCE($4, agent),
                    result=COALESCE($5, result),
                    blocked_reason=$6,
                    updated_at=now()
                WHERE session_id=$1 AND step_id=$2
            """, session_id, step_id, status, agent, result, blocked_reason)

    async def add_message(self, message_id: str, session_id: str, role: str, content: str) -> None:
        async with self._pool.acquire() as con:
            await con.execute(f"""
                INSERT INTO {_q(self._schema,'messages')} (id,session_id,role,content)
                VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING
            """, message_id, session_id, role, content)
