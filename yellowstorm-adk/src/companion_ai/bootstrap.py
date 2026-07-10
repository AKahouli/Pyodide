"""Orchestrator runtime wiring — one object the gRPC server starts/stops.

Owns the read-model connection pool, initializes the companion_ai schema, builds
the OrchestratorService + servicer, and (when enabled) runs the MCP task poller.
Gated by ORCHESTRATOR_ENABLED so the rest of the app is unaffected when off.
"""
from __future__ import annotations

import logging
from typing import Optional

import asyncpg
from google.adk.runners import Runner
from google.adk.sessions import DatabaseSessionService

from src.grpc_server.orchestrator_servicer import AgentOrchestratorServicer
from src.companion_ai import mcp_tasks, readmodel
from src.companion_ai.config import OrchestratorSettings, get_orchestrator_settings
from src.companion_ai.poller import MCPTaskPoller
from src.companion_ai.service import OrchestratorService

logger = logging.getLogger(__name__)


class OrchestratorRuntime:
    def __init__(self, settings: Optional[OrchestratorSettings] = None):
        self._s = settings or get_orchestrator_settings()
        self._pool: Optional[asyncpg.Pool] = None
        self._poller: Optional[MCPTaskPoller] = None
        self.servicer: Optional[AgentOrchestratorServicer] = None

    async def start(self) -> "OrchestratorRuntime":
        s = self._s
        schema = s.ORCHESTRATOR_READMODEL_SCHEMA
        self._pool = await asyncpg.create_pool(
            s.readmodel_dsn(), min_size=1, max_size=10)
        await readmodel.init_schema(self._pool, schema)
        await mcp_tasks.init_schema(self._pool, schema)
        async with self._pool.acquire() as con:  # ADK's own tables live here
            await con.execute(f'CREATE SCHEMA IF NOT EXISTS "{s.ORCHESTRATOR_ADK_SCHEMA}"')
        rm = readmodel.ReadModel(self._pool, schema=schema)

        # Durable ADK sessions on Postgres (companion_ai) so a turn blocked on
        # ask-the-user resumes in a later RunTask / another replica. ADK's tables
        # go in a separate schema (search_path) to avoid the read model's names.
        session_service = DatabaseSessionService(
            db_url=s.session_service_url(),
            connect_args={"server_settings": {"search_path": s.ORCHESTRATOR_ADK_SCHEMA}})

        def runner_factory(node, app_name):
            return Runner(node=node, app_name=app_name, session_service=session_service)

        service = OrchestratorService(
            runner_factory, read_model=rm,
            planner_model=s.ORCHESTRATOR_PLANNER_MODEL,
            max_concurrency=s.ORCHESTRATOR_MAX_CONCURRENCY,
            pool=self._pool, schema=schema)
        self.servicer = AgentOrchestratorServicer(
            service, rm, default_model=s.ORCHESTRATOR_PLANNER_MODEL)

        if s.MCP_TASKS_ENABLED:
            async def _resume(row, outcome, text):
                # ponytail: MCP resume-into-workflow is the remaining HITL spike;
                # returning False keeps the task pending (retried) rather than
                # silently dropping it. Gated off by default (MCP_TASKS_ENABLED).
                logger.warning("MCP task resume not yet wired (session=%s task=%s)",
                               row["session_id"], row["task_id"])
                return False
            self._poller = MCPTaskPoller(
                self._pool, _resume, schema=schema,
                interval_s=s.MCP_TASK_POLL_INTERVAL_S,
                claim_timeout_s=s.MCP_TASK_CLAIM_TIMEOUT_S)
            await self._poller.start()

        logger.info("[orchestrator] runtime started (schema=%s, poller=%s)",
                    schema, bool(self._poller))
        return self

    async def stop(self) -> None:
        if self._poller:
            await self._poller.stop()
        if self._pool:
            await self._pool.close()
        logger.info("[orchestrator] runtime stopped")
