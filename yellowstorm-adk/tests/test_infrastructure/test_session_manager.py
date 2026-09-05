"""Extended unit tests for session manager module."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.smart_rag.infrastructure.session.manager import (
    SessionHelper,
    dispose_shared_engine,
    get_shared_engine,
)


@pytest.fixture
def session_helper():
    return SessionHelper(user_id="user-42")


@pytest.fixture
def mock_agent():
    agent = MagicMock()
    agent.name = "SearchAgent"
    agent.instruction = "Search docs"
    agent.tools = []
    return agent


class TestSessionStateHelpers:
    def test_build_session_state(self, session_helper):
        session_helper.session_id = "sess-1"
        state = session_helper._build_session_state(
            "system prompt",
            "SearchAgent",
            [{"name": "search", "description": "d", "prompt": ""}],
        )
        assert state["system_prompt"] == "system prompt"
        assert state["agent_name"] == "SearchAgent"
        assert len(state["tools_info"]) == 1

    @pytest.mark.asyncio
    async def test_find_existing_session_returns_session(self, session_helper):
        session_helper.session_id = "sess-1"
        session_helper.session_service = MagicMock()
        existing = MagicMock()
        session_helper.session_service.get_session = AsyncMock(return_value=existing)
        result = await session_helper._find_existing_session()
        assert result is existing

    @pytest.mark.asyncio
    async def test_find_existing_session_handles_error(self, session_helper):
        session_helper.session_id = "sess-1"
        session_helper.session_service = MagicMock()
        session_helper.session_service.get_session = AsyncMock(side_effect=RuntimeError("db"))
        assert await session_helper._find_existing_session() is None

    @pytest.mark.asyncio
    async def test_set_session_reuses_existing(self, session_helper):
        session_helper.session_id = "sess-1"
        existing = MagicMock()
        session_helper._find_existing_session = AsyncMock(return_value=existing)
        result = await session_helper.set_session(system_prompt="p", agent_name="A")
        assert result is existing

    @pytest.mark.asyncio
    async def test_set_session_creates_new_with_extra_state(self, session_helper):
        session_helper.session_id = "sess-2"
        created = MagicMock()
        session_helper._find_existing_session = AsyncMock(return_value=None)
        session_helper.session_service = MagicMock()
        session_helper.session_service.create_session = AsyncMock(return_value=created)
        result = await session_helper.set_session(
            system_prompt="p",
            agent_name="A",
            tools_info=[],
            extra_state={"_mcp_search_user_id": "u1"},
        )
        assert result is created
        kwargs = session_helper.session_service.create_session.await_args.kwargs
        assert kwargs["state"]["_mcp_search_user_id"] == "u1"

    @pytest.mark.asyncio
    async def test_get_system_prompt_and_tools_info(self, session_helper):
        session_helper.session = MagicMock()
        session_helper.session.state = {
            "system_prompt": "prompt",
            "agent_name": "Agent",
            "tools_info": [{"name": "search"}],
        }
        prompt = await session_helper.get_system_prompt()
        tools = await session_helper.get_tools_info()
        assert prompt["system_prompt"] == "prompt"
        assert tools[0]["name"] == "search"

    @pytest.mark.asyncio
    async def test_get_system_prompt_missing_state(self, session_helper):
        session_helper.session = None
        assert await session_helper.get_system_prompt() is None
        assert await session_helper.get_tools_info() is None

    @pytest.mark.asyncio
    async def test_cleanup_closes_exit_stacks(self, session_helper):
        stack = AsyncMock()
        session_helper.exit_stacks = [stack]
        session_helper.session_service = MagicMock()
        session_helper.session = MagicMock()
        session_helper.runner = MagicMock()
        await session_helper.cleanup()
        stack.aclose.assert_awaited_once()
        assert session_helper.session_service is None


class TestSharedEngine:
    @pytest.mark.asyncio
    async def test_get_shared_engine_creates_once(self):
        import src.smart_rag.infrastructure.session.manager as manager_mod

        manager_mod._shared_engine = None
        mock_engine = MagicMock()
        with patch(
            "src.smart_rag.infrastructure.session.manager.create_async_engine",
            return_value=mock_engine,
        ) as mock_create:
            first = await get_shared_engine("postgresql://localhost/db")
            second = await get_shared_engine("postgresql://localhost/db")
        assert first is second
        mock_create.assert_called_once()
        manager_mod._shared_engine = None

    @pytest.mark.asyncio
    async def test_dispose_shared_engine(self):
        import src.smart_rag.infrastructure.session.manager as manager_mod

        engine = AsyncMock()
        manager_mod._shared_engine = engine
        await dispose_shared_engine()
        engine.dispose.assert_awaited_once()
        assert manager_mod._shared_engine is None

    @pytest.mark.asyncio
    async def test_init_session_success(self, session_helper, mock_agent):
        session_helper.set_session = AsyncMock(return_value=MagicMock())
        with patch(
            "src.smart_rag.infrastructure.session.manager.get_shared_database_session_service",
            new_callable=AsyncMock,
            return_value=MagicMock(),
        ) as mock_provider, patch(
            "src.smart_rag.infrastructure.session.manager.Runner",
        ) as mock_runner_cls:
            mock_runner_cls.return_value = MagicMock()
            session_id = await session_helper.init_session(mock_agent, "sess-init")
        assert session_id == "sess-init"
        session_helper.set_session.assert_awaited_once()
        assert session_helper.session_service is mock_provider.return_value
