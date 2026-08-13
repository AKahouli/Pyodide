"""Client read model on Postgres — the tables ElectricSQL syncs to the client.

CQRS read side: the orchestrator projects the client-facing slice (session, plan,
per-step status, messages) here as it runs; the client reads it live via Electric.
Row-per-step so parallel work shows as many independent row updates.

"Internal" below means only that no client shape reads the table — Electric will
serve ANY table in this database to anyone holding ELECTRIC_SECRET, so it is not
an access control. Today the API is Electric's only consumer and re-emits over
SSE, so nothing internal is reachable. If a client is ever pointed at Electric
directly, the proxy in front of it must allowlist the client tables:
`mail_waits` holds live routing tokens, and a token is enough to answer someone
else's step.
"""
from __future__ import annotations

import hashlib
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
                session_id    TEXT PRIMARY KEY,
                id            TEXT NOT NULL,
                title         TEXT,
                goal          TEXT,
                status        TEXT NOT NULL DEFAULT 'pending',
                executor_id   TEXT,   -- the client's default executor for this turn
                executor_name TEXT,   -- resolved once at plan_turn; steps born later
                                       -- (create_task) read it here, not by scanning
                                       -- sibling steps, which may all be personas
                updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
            )""")
        # Idempotent migration for an existing plans table.
        await con.execute(
            f'ALTER TABLE {_q(schema,"plans")} ADD COLUMN IF NOT EXISTS executor_id TEXT')
        await con.execute(
            f'ALTER TABLE {_q(schema,"plans")} ADD COLUMN IF NOT EXISTS executor_name TEXT')
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
                result         TEXT,
                blocked_reason TEXT,
                interrupt_id   TEXT,          -- set while THIS step waits on an answer
                assignee       TEXT,          -- human_agents.py directory id, or the executor's own id
                assignee_name  TEXT,          -- resolved display name, cached at creation
                assignee_role  TEXT,          -- resolved role text, cached at creation
                is_persona     BOOLEAN NOT NULL DEFAULT FALSE,  -- true only for a human-agent persona
                is_dynamic_delegate BOOLEAN NOT NULL DEFAULT FALSE,  -- true only if created by delegate_to_human_agent
                updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
                PRIMARY KEY (session_id, step_id)
            )""")
        for col, typ in (("kind", "TEXT NOT NULL DEFAULT 'execute'"),
                         ("question", "TEXT"), ("title", "TEXT"),
                         ("interrupt_id", "TEXT"), ("assignee", "TEXT"),
                         ("assignee_name", "TEXT"), ("assignee_role", "TEXT"),
                         ("is_persona", "BOOLEAN NOT NULL DEFAULT FALSE"),
                         ("is_dynamic_delegate", "BOOLEAN NOT NULL DEFAULT FALSE")):
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
        # Internal (not published to Electric): which step is waiting on which
        # email reply. The token travels in the outbound mail and comes back on
        # the reply; this is what turns it into (session, step, interrupt).
        #
        # Two-phase, because the token has to exist before the mail goes out but
        # the interrupt id only exists once the step parks: the row is written at
        # plan projection with interrupt_id NULL, and bound when the step blocks.
        # A reply that beats the parking finds an unbound row and is not
        # deliverable — see claim_mail_wait.
        await con.execute(f"""
            CREATE TABLE IF NOT EXISTS {_q(schema,'plan_step_artifacts')} (
                session_id    TEXT NOT NULL,
                step_id       TEXT NOT NULL,   -- joins plan_steps(session_id, step_id)
                artifact_id   TEXT NOT NULL,   -- derived from (step_id, file_path); see add_step_artifact
                file_path     TEXT NOT NULL,   -- the connector's own key, stored raw
                filename      TEXT NOT NULL,
                artifact_kind TEXT,            -- document | image | data | code
                mime_type     TEXT,
                size          BIGINT,
                created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
                PRIMARY KEY (session_id, artifact_id)
            )""")
        await con.execute(f"""
            CREATE TABLE IF NOT EXISTS {_q(schema,'mail_waits')} (
                token           TEXT PRIMARY KEY,
                session_id      TEXT NOT NULL,
                step_id         TEXT NOT NULL,
                interrupt_id    TEXT,           -- NULL until the step parks
                user_id         TEXT NOT NULL,
                mailbox_app_key TEXT,
                expected_from   TEXT,
                conversation_id TEXT,          -- recovered later; not known at send
                status          TEXT NOT NULL DEFAULT 'waiting',  -- waiting|matched|expired|cancelled
                created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
                expires_at      TIMESTAMPTZ
            )""")
        # The sweeps ask "what is still waiting" (renewal, expiry, catch-up), and
        # a session teardown asks "what is still waiting for me".
        await con.execute(
            f'CREATE INDEX IF NOT EXISTS mail_waits_waiting_idx ON {_q(schema,"mail_waits")} '
            f'(status, expires_at)')
        await con.execute(
            f'CREATE INDEX IF NOT EXISTS mail_waits_session_idx ON {_q(schema,"mail_waits")} '
            f'(session_id, status)')


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
        """Set status and clear any pending interrupt — a non-waiting session is
        not answerable. Use set_waiting() to mark a session waiting on input."""
        async with self._pool.acquire() as con:
            await con.execute(
                f"UPDATE {_q(self._schema,'sessions')} "
                f"SET status=$2, interrupt_id=NULL, updated_at=now() WHERE id=$1",
                session_id, status)

    async def stop_incomplete(self, session_id: str) -> None:
        """On StopSession, move any non-terminal step + the plan to a terminal
        state so a stopped session shows no work stuck 'running' on the board.
        The session status itself is set to 'completed' by the caller."""
        async with self._pool.acquire() as con:
            await con.execute(
                f"UPDATE {_q(self._schema,'plan_steps')} "
                f"SET status='failed', blocked_reason='stopped by user', updated_at=now() "
                f"WHERE session_id=$1 AND status NOT IN ('completed','failed')",
                session_id)
            await con.execute(
                f"UPDATE {_q(self._schema,'plans')} SET status='completed', updated_at=now() "
                f"WHERE session_id=$1 AND status NOT IN ('completed','failed')",
                session_id)

    async def pause_running_steps(self, session_id: str) -> None:
        """On pause, reset in-flight (running) steps to pending so a continue
        re-runs them from the start — pause is step-granular, not mid-step."""
        async with self._pool.acquire() as con:
            await con.execute(
                f"UPDATE {_q(self._schema,'plan_steps')} SET status='pending', updated_at=now() "
                f"WHERE session_id=$1 AND status='running'",
                session_id)

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
                          goal: str, status: str, *,
                          executor_id: Optional[str] = None,
                          executor_name: Optional[str] = None) -> None:
        async with self._pool.acquire() as con:
            await con.execute(f"""
                INSERT INTO {_q(self._schema,'plans')}
                    (session_id,id,title,goal,status,executor_id,executor_name)
                VALUES ($1,$2,$3,$4,$5,$6,$7)
                ON CONFLICT (session_id) DO UPDATE
                  SET id=EXCLUDED.id, title=EXCLUDED.title, goal=EXCLUDED.goal,
                      status=EXCLUDED.status,
                      -- Set once at plan_turn and never blank afterward: a
                      -- resume/continue re-projection passes neither, and
                      -- must not erase the value the first projection wrote.
                      executor_id=COALESCE(EXCLUDED.executor_id, {_q(self._schema,'plans')}.executor_id),
                      executor_name=COALESCE(EXCLUDED.executor_name, {_q(self._schema,'plans')}.executor_name),
                      updated_at=now()
            """, session_id, plan_id, title, goal, status, executor_id, executor_name)

    async def upsert_steps(self, session_id: str,
                           steps: List[Tuple[str, int, int, str, str, str, str, str, str, str, str, str, bool, bool]]) -> None:
        """steps: (step_id, ordinal, wave, status, kind, question, title,
        description, depends_on, assignee, assignee_name, assignee_role, is_persona,
        is_dynamic_delegate)."""
        async with self._pool.acquire() as con:
            await con.executemany(f"""
                INSERT INTO {_q(self._schema,'plan_steps')}
                    (session_id,step_id,ordinal,wave,status,kind,question,title,description,depends_on,assignee,assignee_name,assignee_role,is_persona,is_dynamic_delegate)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
                ON CONFLICT (session_id,step_id) DO UPDATE
                  SET ordinal=EXCLUDED.ordinal, wave=EXCLUDED.wave,
                      kind=EXCLUDED.kind, question=EXCLUDED.question,
                      title=EXCLUDED.title, description=EXCLUDED.description,
                      depends_on=EXCLUDED.depends_on, assignee=EXCLUDED.assignee,
                      assignee_name=EXCLUDED.assignee_name, assignee_role=EXCLUDED.assignee_role,
                      is_persona=EXCLUDED.is_persona,
                      is_dynamic_delegate=EXCLUDED.is_dynamic_delegate,
                      updated_at=now()
            """, [(session_id, *s) for s in steps])

    async def set_step_status(self, session_id: str, step_id: str, status: str, *,
                              result: Optional[str] = None,
                              blocked_reason: Optional[str] = None,
                              interrupt_id: Optional[str] = None) -> None:
        """`interrupt_id` is written as given, not merged: a step that moves to any
        status without one is no longer parked, so the default clears it."""
        async with self._pool.acquire() as con:
            await con.execute(f"""
                UPDATE {_q(self._schema,'plan_steps')}
                SET status=$3,
                    result=COALESCE($4, result),
                    blocked_reason=$5,
                    interrupt_id=$6,
                    updated_at=now()
                WHERE session_id=$1 AND step_id=$2
            """, session_id, step_id, status, result, blocked_reason, interrupt_id)

    async def outstanding_interrupts(self, session_id: str) -> List[Tuple[str, str]]:
        """(interrupt_id, step_id) for every step still parked on an answer.

        ADK only emits an interrupt on the run that raises it — a step parked by
        an earlier run stays parked silently. This is the durable record of what
        is still outstanding, so a turn never completes work nobody answered.
        """
        async with self._pool.acquire() as con:
            rows = await con.fetch(
                f"SELECT interrupt_id, step_id FROM {_q(self._schema,'plan_steps')} "
                f"WHERE session_id=$1 AND interrupt_id IS NOT NULL ORDER BY ordinal",
                session_id)
        return [(r["interrupt_id"], r["step_id"]) for r in rows]

    async def add_message(self, message_id: str, session_id: str, role: str, content: str) -> None:
        async with self._pool.acquire() as con:
            await con.execute(f"""
                INSERT INTO {_q(self._schema,'messages')} (id,session_id,role,content)
                VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING
            """, message_id, session_id, role, content)

    async def add_step_artifact(self, session_id: str, step_id: str, *, file_path: str,
                                filename: str, artifact_kind: Optional[str] = None,
                                mime_type: Optional[str] = None,
                                size: Optional[int] = None) -> None:
        """Record a file a step produced, for the client to list and download.

        Append-only: rows are never updated or deleted, so the client can treat
        an arriving row as a new file and nothing else.

        `artifact_id` is a hash of (step_id, file_path) rather than a random id,
        which makes the insert idempotent. A plan is re-driven across turns and
        already-completed steps replay from their recorded events, so the same
        file can be projected more than once; a random id would show the user
        the same download twice, several times over a long plan.

        `file_path` is stored exactly as the connector returned it — an opaque
        object key, not a URL. Resolving it is the client's job (the same way
        playbook artifacts resolve), because a signed URL would expire and this
        table is read on reconnect and replay long after the run.
        """
        artifact_id = hashlib.sha1(f"{step_id}:{file_path}".encode()).hexdigest()[:12]
        async with self._pool.acquire() as con:
            await con.execute(f"""
                INSERT INTO {_q(self._schema,'plan_step_artifacts')}
                    (session_id,step_id,artifact_id,file_path,filename,
                     artifact_kind,mime_type,size)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
                ON CONFLICT (session_id, artifact_id) DO NOTHING""",
                session_id, step_id, artifact_id, file_path, filename,
                artifact_kind, mime_type, size)

    async def register_mail_wait(self, token: str, *, session_id: str, step_id: str,
                                 user_id: str, interrupt_id: Optional[str] = None,
                                 mailbox_app_key: Optional[str] = None,
                                 expected_from: Optional[str] = None,
                                 expires_at=None) -> None:
        """Record that `step_id` will wait for a reply carrying `token`.

        Written at plan projection, before the mail is sent — the token has to be
        in the outbound mail, and by the time the step parks the mail is long
        gone. `interrupt_id` is unknown until then, so it is bound later by
        bind_mail_wait_interrupt."""
        async with self._pool.acquire() as con:
            await con.execute(f"""
                INSERT INTO {_q(self._schema,'mail_waits')}
                    (token,session_id,step_id,interrupt_id,user_id,mailbox_app_key,
                     expected_from,expires_at)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
                ON CONFLICT (token) DO NOTHING
            """, token, session_id, step_id, interrupt_id, user_id, mailbox_app_key,
                 expected_from, expires_at)

    async def bind_mail_wait_interrupt(self, session_id: str, step_id: str,
                                       interrupt_id: str) -> None:
        """The step parked: from here its wait is deliverable."""
        async with self._pool.acquire() as con:
            await con.execute(
                f"UPDATE {_q(self._schema,'mail_waits')} SET interrupt_id=$3 "
                f"WHERE session_id=$1 AND step_id=$2 AND status='waiting'",
                session_id, step_id, interrupt_id)

    async def rebind_mail_wait(self, session_id: str, old_step_id: str, new_step_id: str) -> int:
        """Move a pending wait onto the real step it belongs to, returning how
        many rows moved (0 or 1).

        A step with create_task access mints its wait eagerly, the moment it
        sends mail — under a placeholder id, since the await_reply step that
        will actually wait on the reply (via create_task) doesn't exist yet at
        send time. Once/if that step is created, this retargets the token onto
        it.

        0 means nothing was pending under the placeholder, i.e. the caller never
        actually sent mail. The caller MUST treat that as an error rather than
        proceeding: a wait with no token can never be claimed by an arriving
        reply, so the step would park on an interrupt nothing can ever resume.
        Seen live (session 681a01cfcd014e80a851f2b33e2b823e), back when this
        returned None and the miss was silent."""
        async with self._pool.acquire() as con:
            res = await con.execute(
                f"UPDATE {_q(self._schema,'mail_waits')} SET step_id=$3 "
                f"WHERE session_id=$1 AND step_id=$2 AND status='waiting'",
                session_id, old_step_id, new_step_id)
        # asyncpg returns the command tag, e.g. "UPDATE 1".
        return int(res.rsplit(" ", 1)[-1]) if res else 0

    async def mail_token_for(self, session_id: str, step_id: str) -> Optional[str]:
        """The token to stamp into the mail this step is waiting on a reply to."""
        async with self._pool.acquire() as con:
            return await con.fetchval(
                f"SELECT token FROM {_q(self._schema,'mail_waits')} "
                f"WHERE session_id=$1 AND step_id=$2 AND status='waiting'",
                session_id, step_id)

    async def claim_mail_wait(self, token: str) -> Optional[dict]:
        """Atomically claim the wait for `token`: the row if this delivery is the
        first to match it, None if unknown, already matched, expired, cancelled —
        or not yet parked, since there is no interrupt to resume before then.

        Atomic because Graph retries a notification it thinks failed, and a
        duplicate must not resume the step twice — the second resume would answer
        an already-answered question and let the plan run on the reply twice.
        A single `UPDATE ... RETURNING`, so this holds across restarts and
        multiple replicas.
        """
        async with self._pool.acquire() as con:
            row = await con.fetchrow(f"""
                UPDATE {_q(self._schema,'mail_waits')} SET status='matched'
                WHERE token=$1 AND status='waiting' AND interrupt_id IS NOT NULL
                RETURNING *
            """, token)
        return dict(row) if row else None

    async def cancel_mail_waits(self, session_id: str) -> None:
        """Drop this session's outstanding waits — it stopped or finished, so no
        reply can be interesting any more. Without this a mailbox subscription is
        kept alive (and renewed forever) for a session nobody is watching."""
        async with self._pool.acquire() as con:
            await con.execute(
                f"UPDATE {_q(self._schema,'mail_waits')} SET status='cancelled' "
                f"WHERE session_id=$1 AND status='waiting'",
                session_id)

    async def expire_mail_waits(self) -> List[dict]:
        """Claim every wait past its expiry, returning them so the caller can let
        the step down gently (ask the owner instead of hanging forever)."""
        async with self._pool.acquire() as con:
            rows = await con.fetch(f"""
                UPDATE {_q(self._schema,'mail_waits')} SET status='expired'
                WHERE status='waiting' AND expires_at IS NOT NULL AND expires_at <= now()
                RETURNING *
            """)
        return [dict(r) for r in rows]

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
