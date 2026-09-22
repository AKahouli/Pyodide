import asyncio
import importlib
import sys
from types import SimpleNamespace
from types import ModuleType
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.companion_ai.bootstrap import OrchestratorRuntime


@pytest.mark.asyncio
async def test_stop_closes_all_owned_postgres_pools():
    runtime = OrchestratorRuntime.__new__(OrchestratorRuntime)
    runtime._mail_sweep = None
    runtime._poller = None
    runtime._session_service = AsyncMock()
    runtime._pool = AsyncMock()

    session_service = runtime._session_service
    pool = runtime._pool
    await runtime.stop()

    session_service.close.assert_awaited_once()
    pool.close.assert_awaited_once()
    assert runtime._session_service is None
    assert runtime._pool is None


@pytest.mark.asyncio
async def test_stop_closes_asyncpg_pool_when_session_service_close_fails():
    runtime = OrchestratorRuntime.__new__(OrchestratorRuntime)
    runtime._mail_sweep = None
    runtime._poller = None
    runtime._session_service = AsyncMock()
    runtime._session_service.close.side_effect = [RuntimeError("close failed"), None]
    runtime._pool = AsyncMock()

    pool = runtime._pool
    with pytest.raises(RuntimeError, match="close failed"):
        await runtime.stop()

    pool.close.assert_awaited_once()
    assert runtime._session_service is not None

    await runtime.stop()
    assert runtime._session_service is None


@pytest.mark.asyncio
async def test_cancelled_partial_start_closes_created_pool():
    settings = SimpleNamespace(
        ORCHESTRATOR_READMODEL_SCHEMA="readmodel",
        ORCHESTRATOR_ADK_SCHEMA="adk",
        readmodel_dsn=lambda: "postgresql://example/db",
        session_service_url=lambda: "postgresql+asyncpg://example/db",
    )
    runtime = OrchestratorRuntime(settings)
    pool = AsyncMock()
    connection = AsyncMock()
    pool.acquire.return_value.__aenter__.return_value = connection

    with patch(
        "src.companion_ai.bootstrap.asyncpg.create_pool",
        new=AsyncMock(return_value=pool),
    ), patch(
        "src.companion_ai.bootstrap.readmodel.init_schema",
        new=AsyncMock(),
    ), patch(
        "src.companion_ai.bootstrap.mcp_tasks.init_schema",
        new=AsyncMock(side_effect=asyncio.CancelledError),
    ):
        with pytest.raises(asyncio.CancelledError):
            await runtime.start()

    pool.close.assert_awaited_once()
    assert runtime._pool is None


@pytest.mark.asyncio
async def test_grpc_start_failure_stops_orchestrator_runtime():
    grpc_service = ModuleType("src.flow_engine.grpc_service")
    grpc_service.PlaybookFlowRuntimeServicer = MagicMock()
    with patch.dict(sys.modules, {"src.flow_engine.grpc_service": grpc_service}):
        server_module = importlib.import_module("src.grpc_server.server")

    grpc_server = MagicMock()
    grpc_server.start = AsyncMock(side_effect=RuntimeError("bind failed"))
    runtime = MagicMock()
    runtime.start = AsyncMock(return_value=runtime)
    runtime.stop = AsyncMock()
    runtime.describe.return_value = "test runtime"

    with patch.object(server_module, "get_settings", return_value=MagicMock()), patch.object(
        server_module, "build_server_credentials", return_value=None
    ), patch.object(server_module, "resolve_api_key", return_value=None), patch.object(
        server_module.grpc.aio, "server", return_value=grpc_server
    ), patch.object(server_module, "get_agent_team_service", return_value=MagicMock()), patch.object(
        server_module, "ChatbotServicer", return_value=MagicMock()
    ), patch.object(server_module, "chatbot_pb2_grpc", MagicMock()), patch.object(
        server_module, "pf_grpc", None
    ), patch.object(server_module, "close_checkpointer", new=AsyncMock()), patch(
        "src.companion_ai.bootstrap.OrchestratorRuntime", return_value=runtime
    ):
        with pytest.raises(RuntimeError, match="bind failed"):
            await server_module.start_grpc_server()

    runtime.stop.assert_awaited_once()
