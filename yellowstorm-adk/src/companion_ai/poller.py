"""Background poller that resumes turns suspended on a long-running MCP task.

Claims a pending row (multi-worker safe via mcp_tasks.claim -> SKIP LOCKED),
reconnects to the MCP server on a fresh streamable-http connection, reads the
task, and on completion hands the result to a `resume` callback (the piece that
re-enters the orchestrator). Still-running tasks are re-queued; failures retry
up to the attempt budget.

The reconnect uses the server_url + auth_headers captured on the row at call
time, so per-user connector tasks work as long as that auth is still valid.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import socket
import uuid
from typing import Awaitable, Callable, Optional, Tuple

import asyncpg

from . import mcp_tasks

logger = logging.getLogger(__name__)

# resume(row, outcome, text) -> awaitable[bool]: True if the turn was resumed
# (mark done), False to retry/fail. outcome is "completed" | "failed".
ResumeCallback = Callable[[asyncpg.Record, str, Optional[str]], Awaitable[bool]]


class MCPTaskPoller:
    def __init__(self, pool: asyncpg.Pool, resume: ResumeCallback, *, schema: str = "public",
                 interval_s: float = 5.0, claim_timeout_s: int = 300, max_attempts: int = 5):
        self._pool = pool
        self._resume = resume
        self._schema = schema
        self._interval = interval_s
        self._claim_timeout = claim_timeout_s
        self._max_attempts = max_attempts
        self._worker_id = f"{socket.gethostname()}:{os.getpid()}:{uuid.uuid4().hex[:8]}"
        self._task: Optional[asyncio.Task] = None
        self._stopped = asyncio.Event()

    async def start(self) -> None:
        if self._task is None:
            self._stopped.clear()
            self._task = asyncio.create_task(self._loop())
            logger.info("MCP task poller started (worker=%s)", self._worker_id)

    async def stop(self) -> None:
        self._stopped.set()
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    async def _loop(self) -> None:
        while not self._stopped.is_set():
            try:
                await self._tick()
            except Exception:
                logger.exception("MCP task poller tick failed")
            try:
                await asyncio.wait_for(self._stopped.wait(), timeout=self._interval)
            except asyncio.TimeoutError:
                pass

    async def _tick(self) -> None:
        await mcp_tasks.reclaim_stale(self._pool, self._claim_timeout, schema=self._schema)
        while not self._stopped.is_set():
            row = await mcp_tasks.claim(self._pool, self._worker_id, schema=self._schema)
            if row is None:
                break
            await self._process(row)

    async def _process(self, row: asyncpg.Record) -> None:
        try:
            outcome, text = await self._poll_task(row)
        except Exception as e:
            logger.warning("MCP poll failed for task %s: %s", row["task_id"], e)
            await mcp_tasks.requeue(self._pool, row["id"], max_attempts=self._max_attempts,
                                    reason=f"poll error: {e}", schema=self._schema)
            return

        if outcome == "working":
            await mcp_tasks.requeue(self._pool, row["id"], max_attempts=10**9,
                                    schema=self._schema)  # never fail just for being slow
            return

        # mode=record (Option A, set-and-forget): just store the fired result,
        # nothing to resume — the turn already completed when the task started.
        if row["mode"] == "record":
            if outcome == "completed":
                await mcp_tasks.mark_done(self._pool, row["id"], text or "", schema=self._schema)
            else:
                await mcp_tasks.requeue(self._pool, row["id"], max_attempts=self._max_attempts,
                                        reason=text or "failed", schema=self._schema)
            return

        try:
            resumed = await self._resume(row, outcome, text)
        except Exception as e:
            logger.exception("resume failed for task %s: %s", row["task_id"], e)
            resumed = False

        if resumed:
            await mcp_tasks.mark_done(self._pool, row["id"], text or "", schema=self._schema)
        else:
            await mcp_tasks.requeue(self._pool, row["id"], max_attempts=self._max_attempts,
                                    reason="resume failed", schema=self._schema)

    async def _poll_task(self, row: asyncpg.Record) -> Tuple[str, Optional[str]]:
        """Reconnect and read the MCP task. -> ("completed", text) | ("failed", msg) | ("working", None)."""
        url = row["server_url"]
        if not url:
            return "failed", f"no server_url stored for task {row['task_id']}"
        headers = row["auth_headers"]
        if isinstance(headers, str):
            headers = json.loads(headers or "{}")

        from mcp import ClientSession
        from mcp.client.streamable_http import streamablehttp_client
        from mcp.client.experimental.task_handlers import ExperimentalTaskHandlers
        from mcp.types import CallToolResult

        params = {"url": url}
        if headers:
            params["headers"] = headers
        async with streamablehttp_client(**params) as (r, w, _):
            async with ClientSession(r, w, experimental_task_handlers=ExperimentalTaskHandlers()) as s:
                await s.initialize()
                status = str((await s.experimental.get_task(row["task_id"])).status)
                if status == "completed":
                    final = await s.experimental.get_task_result(row["task_id"], CallToolResult)
                    text = "\n".join(
                        p.text for p in (final.content or []) if getattr(p, "text", None)
                    )
                    return "completed", text
                if status in ("failed", "cancelled"):
                    return "failed", f"MCP task {status}"
                return "working", None
