"""Extended unit tests for DelegationTools delegate functions."""

from unittest.mock import AsyncMock, MagicMock

import pytest

from src.smart_rag.agents.tools.delegation_tools import DelegationTools


def _delegation_tools():
    user_request = MagicMock()
    user_request.user_id = "user-1"
    user_request.chatbot_name = "bot"
    user_request.brain_ids = ["b1"]
    user_request.session_id = "sess-1"
    user_request.brain_documents = []
    user_request.search_web = True
    user_request.top_k = 4
    user_request.vectorstore_name = "vs"
    agent_factory = MagicMock()
    agent_runner = MagicMock()
    agent_runner.run_agent_tool = AsyncMock(
        return_value=("result", [], {"execution_flow": [], "execution_statistics": {"execution_success": True}}, [])
    )
    return DelegationTools(
        streaming_formatter=MagicMock(),
        user_request=user_request,
        agent_factory=agent_factory,
        mcp_helper=MagicMock(),
        agent_runner=agent_runner,
        session_helper=MagicMock(),
        documents_tree=[],
        brain_tree=[],
        q=AsyncMock(),
        citation_manager=MagicMock(),
    ), agent_factory


class TestDelegationToolsExtended:
    @pytest.mark.asyncio
    async def test_delegate_to_search_agent_success(self):
        tools, agent_factory = _delegation_tools()
        agent_factory.create_search_agent.return_value = (MagicMock(), MagicMock(), "prompt")
        report_fn, operator_fn, search_fn, html_fn = tools.get_agents("viz", "ops", "report", "search")
        result = await search_fn("find revenue", "1")
        assert result == "result"

    @pytest.mark.asyncio
    async def test_delegate_to_search_agent_creation_failure(self):
        tools, agent_factory = _delegation_tools()
        agent_factory.create_search_agent.side_effect = RuntimeError("fail")
        _, _, search_fn, _ = tools.get_agents("viz", "ops", "report", "search")
        result = await search_fn("task", "1")
        assert result is None

    @pytest.mark.asyncio
    async def test_delegate_to_operator_agent_success(self):
        tools, agent_factory = _delegation_tools()
        agent_factory.create_html_agent.return_value = MagicMock()
        agent_factory.create_operator_agent.return_value = MagicMock()
        agent_factory.create_report_writer_agent.return_value = MagicMock()
        _, operator_fn, _, _ = tools.get_agents("viz", "ops", "report", "search")
        result = await operator_fn("compute", "1")
        assert result == "result"

    @pytest.mark.asyncio
    async def test_delegate_to_report_writer_success(self):
        tools, agent_factory = _delegation_tools()
        agent_factory.create_html_agent.return_value = MagicMock()
        agent_factory.create_operator_agent.return_value = MagicMock()
        agent_factory.create_report_writer_agent.return_value = MagicMock()
        report_fn, _, _, _ = tools.get_agents("viz", "ops", "report", "search")
        result = await report_fn("write report", "1")
        assert result == "result"

    @pytest.mark.asyncio
    async def test_delegate_to_html_agent_success(self):
        tools, agent_factory = _delegation_tools()
        agent_factory.create_html_agent.return_value = MagicMock()
        agent_factory.create_operator_agent.return_value = MagicMock()
        agent_factory.create_report_writer_agent.return_value = MagicMock()
        _, _, _, html_fn = tools.get_agents("viz", "ops", "report", "search")
        result = await html_fn("build ui", "1")
        assert result == "result"

    def test_get_agents_creation_error_returns_none(self):
        tools, agent_factory = _delegation_tools()
        agent_factory.create_html_agent.side_effect = RuntimeError("boom")
        assert tools.get_agents("viz", "ops", "report", "search") is None
