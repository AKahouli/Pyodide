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
                id           TEXT PRIMARY KEY,
                user_id      TEXT NOT NULL,
                title        TEXT,
                status       TEXT NOT NULL DEFAULT 'pending',
                interrupt_id TEXT,     -- set while waiting on ask-the-user
                created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
            )""")
        # Idempotent migration for an existing sessions table.
        await con.execute(
            f'ALTER TABLE {_q(schema,"sessions")} ADD COLUMN IF NOT EXISTS interrupt_id TEXT')
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
                kind           TEXT NOT NULL DEFAULT 'execute',   -- execute | ask
                question       TEXT,          -- for kind = ask
                title          TEXT,          -- short label for the UI card
                description    TEXT,          -- full instruction / detail
                depends_on     TEXT,          -- comma-joined step ids
                agent          TEXT,
                result         TEXT,
                blocked_reason TEXT,
                updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
                PRIMARY KEY (session_id, step_id)
            )""")
        for col, typ in (("kind", "TEXT NOT NULL DEFAULT 'execute'"),
                         ("question", "TEXT"), ("title", "TEXT")):
            await con.execute(
                f'ALTER TABLE {_q(schema,"plan_steps")} ADD COLUMN IF NOT EXISTS {col} {typ}')
        await con.execute(f"""
            CREATE TABLE IF NOT EXISTS {_q(schema,'messages')} (
                id         TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                role       TEXT NOT NULL,
                content    TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )""")
        # Internal (not published to Electric): durable RunTask idempotency so a
        # retried command runs at most once per session, across restarts/replicas.
        await con.execute(f"""
            CREATE TABLE IF NOT EXISTS {_q(schema,'run_idempotency')} (
                session_id      TEXT NOT NULL,
                idempotency_key TEXT NOT NULL,
                run_id          TEXT NOT NULL,
                created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
                PRIMARY KEY (session_id, idempotency_key)
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

    async def set_waiting(self, session_id: str, interrupt_id: Optional[str]) -> None:
        """Mark the session waiting on user input (interrupt_id set), or clear it
        (pass None) when resuming."""
        status = "waiting" if interrupt_id else "running"
        async with self._pool.acquire() as con:
            await con.execute(
                f"UPDATE {_q(self._schema,'sessions')} SET status=$2, interrupt_id=$3, "
                f"updated_at=now() WHERE id=$1",
                session_id, status, interrupt_id)

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
                           steps: List[Tuple[str, int, int, str, str, str, str, str, str, str]]) -> None:
        """steps: (step_id, ordinal, wave, status, kind, question, title,
        description, depends_on, agent)."""
        async with self._pool.acquire() as con:
            await con.executemany(f"""
                INSERT INTO {_q(self._schema,'plan_steps')}
                    (session_id,step_id,ordinal,wave,status,kind,question,title,description,depends_on,agent)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
                ON CONFLICT (session_id,step_id) DO UPDATE
                  SET ordinal=EXCLUDED.ordinal, wave=EXCLUDED.wave,
                      kind=EXCLUDED.kind, question=EXCLUDED.question,
                      title=EXCLUDED.title, description=EXCLUDED.description,
                      depends_on=EXCLUDED.depends_on, updated_at=now()
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

    async def claim_run(self, session_id: str, idempotency_key: str, run_id: str) -> bool:
        """Atomically claim an idempotency key. True if this is the first time the
        key is seen (proceed), False if a duplicate (skip). Multi-replica safe."""
        async with self._pool.acquire() as con:
            got = await con.fetchval(f"""
                INSERT INTO {_q(self._schema,'run_idempotency')} (session_id,idempotency_key,run_id)
                VALUES ($1,$2,$3)
                ON CONFLICT (session_id,idempotency_key) DO NOTHING
                RETURNING run_id
            """, session_id, idempotency_key, run_id)
        return got is not None

    async def snapshot(self, session_id: str) -> Optional[dict]:
        """Session + plan + ordered steps, for GetSession. None if unknown."""
        async with self._pool.acquire() as con:
            sess = await con.fetchrow(
                f"SELECT * FROM {_q(self._schema,'sessions')} WHERE id=$1", session_id)
            if not sess:
                return None
            plan = await con.fetchrow(
                f"SELECT * FROM {_q(self._schema,'plans')} WHERE session_id=$1", session_id)
            steps = await con.fetch(
                f"SELECT * FROM {_q(self._schema,'plan_steps')} WHERE session_id=$1 ORDER BY ordinal",
                session_id)
        return {"session": dict(sess),
                "plan": dict(plan) if plan else None,
                "steps": [dict(s) for s in steps]}
