"""Orchestrator runtime wiring — one object the gRPC server starts/stops.

Owns the read-model connection pool, initializes the companion_ai schema, builds
the OrchestratorService + servicer, and (when enabled) runs the MCP task poller.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Optional

import asyncpg
from google.adk.runners import Runner
from google.adk.sessions import DatabaseSessionService

from src.grpc_server.companion_ai_servicer import CompanionAiServicer
from src.companion_ai import mcp_tasks, readmodel
from src.companion_ai.config import OrchestratorSettings, get_orchestrator_settings
from src.companion_ai.poller import MCPTaskPoller
from src.companion_ai.adk.service import OrchestratorService

logger = logging.getLogger(__name__)


class OrchestratorRuntime:
    def __init__(self, settings: Optional[OrchestratorSettings] = None):
        self._s = settings or get_orchestrator_settings()
        self._pool: Optional[asyncpg.Pool] = None
        self._session_service: Optional[DatabaseSessionService] = None
        self._checkpointer_cm = None  # AsyncPostgresSaver context manager (langgraph)
        self._poller: Optional[MCPTaskPoller] = None
        self._mail_sweep: Optional[asyncio.Task] = None
        self.servicer: Optional[CompanionAiServicer] = None

    async def start(self) -> "OrchestratorRuntime":
        try:
            return await self._start()
        except BaseException:
            await self.stop()
            raise

    async def _start(self) -> "OrchestratorRuntime":
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
        self._session_service = DatabaseSessionService(
            db_url=s.session_service_url(),
            connect_args={"server_settings": {"search_path": s.ORCHESTRATOR_ADK_SCHEMA}})

        def runner_factory(node, app_name):
            return Runner(node=node, app_name=app_name, session_service=self._session_service)

        service = OrchestratorService(
            runner_factory, read_model=rm,
            planner_model=s.ORCHESTRATOR_PLANNER_MODEL,
            max_concurrency=s.ORCHESTRATOR_MAX_CONCURRENCY,
            pool=self._pool, schema=schema,
            mail_wait_timeout_hours=s.MAIL_WAIT_TIMEOUT_HOURS)

        # LangGraph engine (opt-in): reuse the ADK service for planning/projection,
        # execute/resume on a StateGraph checkpointed to Postgres. The saver owns
        # its own psycopg pool + tables; created here and closed in stop().
        if s.ORCHESTRATOR_ENGINE.lower() == "langgraph":
            from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
            from src.companion_ai.langgraph.service import LgService
            self._checkpointer_cm = AsyncPostgresSaver.from_conn_string(s.readmodel_dsn())
            checkpointer = await self._checkpointer_cm.__aenter__()
            await checkpointer.setup()
            service = LgService(service, rm, checkpointer)
            logger.info("[orchestrator] engine=langgraph (checkpointer=AsyncPostgresSaver)")
        else:
            logger.info("[orchestrator] engine=adk")

        self.servicer = CompanionAiServicer(service, rm)

        # Nothing else notices a reply that never comes: the step is parked on an
        # interrupt no incoming mail will ever match, so without this sweep the
        # plan waits forever and the owner is never told why.
        self._mail_sweep = asyncio.create_task(
            self._sweep_mail_waits(service, s.MAIL_WAIT_SWEEP_INTERVAL_S))

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

        logger.info("[orchestrator] runtime started (%s)", self.describe())
        return self

    def describe(self) -> str:
        """One-line operational summary for startup/registration logs — schema,
        planner model, and the config that varies silently across environments
        (mail-wait timeout, whether the MCP task poller is actually running)."""
        s = self._s
        return (f"schema={s.ORCHESTRATOR_READMODEL_SCHEMA} "
                f"planner={s.ORCHESTRATOR_PLANNER_MODEL} "
                f"max_concurrency={s.ORCHESTRATOR_MAX_CONCURRENCY} "
                f"mail_wait_timeout={s.MAIL_WAIT_TIMEOUT_HOURS}h "
                f"mcp_tasks={'on' if self._poller else 'off'}")

    @staticmethod
    async def _sweep_mail_waits(service: OrchestratorService, interval_s: float) -> None:
        """Periodically let down the steps whose reply never arrived."""
        while True:
            try:
                await asyncio.sleep(interval_s)
                expired = await service.expire_mail_waits()
                if expired:
                    logger.info("[orchestrator] %d mail wait(s) expired → asked the owner",
                                expired)
            except asyncio.CancelledError:
                raise
            except Exception:  # a bad sweep must not kill the loop for good
                logger.exception("[orchestrator] mail wait sweep failed")

    async def stop(self) -> None:
        if self._mail_sweep:
            self._mail_sweep.cancel()
            try:
                await self._mail_sweep
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
            self._mail_sweep = None
        cleanup_error: Optional[BaseException] = None
        if self._poller:
            poller, self._poller = self._poller, None
            try:
                await poller.stop()
            except BaseException as error:
                self._poller = poller
                cleanup_error = error
        if getattr(self, "_checkpointer_cm", None):
            cm, self._checkpointer_cm = self._checkpointer_cm, None
            try:
                await cm.__aexit__(None, None, None)
            except BaseException as error:
                self._checkpointer_cm = cm
                cleanup_error = cleanup_error or error
        if self._session_service:
            session_service, self._session_service = self._session_service, None
            try:
                await session_service.close()
            except BaseException as error:
                self._session_service = session_service
                cleanup_error = cleanup_error or error
        if self._pool:
            pool, self._pool = self._pool, None
            try:
                await pool.close()
            except BaseException as error:
                self._pool = pool
                cleanup_error = cleanup_error or error
        if cleanup_error:
            raise cleanup_error
        logger.info("[orchestrator] runtime stopped")
