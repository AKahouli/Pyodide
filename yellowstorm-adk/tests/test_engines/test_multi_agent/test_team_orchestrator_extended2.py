"""Extended team orchestrator coverage for tool extraction and response formatting."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.smart_rag.engines.multi_agent.team_orchestrator import AutoAgentGenerationTeam


def _orchestrator():
    config = MagicMock()
    config.user_id = "user-1"
    config.session_id = "sess-1"
    config.brain_ids = ["b1"]
    config.vectorstore_name = "vs"
    config.chatbot_name = {"provider": "gpt-4o"}
    team = AutoAgentGenerationTeam(
        config=config,
        prompt_processor=MagicMock(),
        llm_factory=MagicMock(),
        agent_factory=MagicMock(),
        agent_runner=MagicMock(),
        streaming_formatter=MagicMock(),
        event_extractor=MagicMock(),
        chatbot_name={"provider": "gpt-4o"},
    )
    team.agent_repository = MagicMock()
    team.manager_factory = MagicMock()
    team.agent_tools_manager = MagicMock()
    team.streaming_processor = MagicMock()
    team.delegation_factory = MagicMock()
    return team


class TestTeamOrchestratorExtended2:
    def test_extract_tool_data_from_callable(self):
        team = _orchestrator()

        def delegate_search():
            """Delegate to search agent."""

        result = team._extract_tool_data(delegate_search)
        assert result["name"] == "delegate_search"
        assert "Delegate" in result["description"]

    def test_extract_tool_data_from_object(self):
        team = _orchestrator()
        tool = SimpleNamespace(name="search_tool", description="Search docs", prompt="find")
        result = team._extract_tool_data(tool)
        assert result["name"] == "search_tool"
        assert result["prompt"] == "find"

    def test_extract_tool_data_fallback(self):
        team = _orchestrator()
        result = team._extract_tool_data(123)
        assert result["name"] == "int"

    def test_format_inter_agent_message(self):
        team = _orchestrator()
        sender = SimpleNamespace(name="manager")
        receiver = SimpleNamespace(name="search_agent")
        message = team._format_inter_agent_message(sender, receiver, "find revenue", {"step": 1})
        assert "manager" in message
        assert "search_agent" in message
        assert "find revenue" in message

    def test_format_team_response(self):
        team = _orchestrator()
        formatted = team._format_team_response(
            [
                {"agent": "Search", "response": "Found docs"},
                {"agent": "Writer", "response": "Draft ready"},
            ]
        )
        assert "Search: Found docs" in formatted
        assert "Writer: Draft ready" in formatted

    def test_make_delegate_function_delegates(self):
        team = _orchestrator()
        delegate = MagicMock()
        team.delegation_factory.make_delegate_function.return_value = delegate
        result = team.make_delegate_function("SearchAgent", AsyncMock(), False)
        assert result is delegate
        team.delegation_factory.make_delegate_function.assert_called_once()

    @pytest.mark.asyncio
    async def test_monitor_team_health(self):
        team = _orchestrator()
        mock_team = MagicMock()
        mock_team.agents = [MagicMock(), MagicMock()]
        health = await team._monitor_team_health(mock_team)
        assert health["agent_count"] == 2
        assert health["overall_status"] == "healthy"

    @pytest.mark.asyncio
    async def test_create_agent_team_search_agent_branch(self):
        team = _orchestrator()
        search_config = MagicMock()
        search_config.type = "search"
        search_config.name = "SearchAgent"
        search_config.tools = [
            {"name": "search", "top_k": 5},
            {
                "name": "generate_web_preview",
                "prompt": "Use previews.",
                "instructions": "Return HTML.",
            },
        ]
        search_config.prompt = "find docs"
        search_config.agent_params = {}
        team_config = MagicMock()
        team_config.agents = [search_config]
        team_config.manager_prompt = "coordinate"
        with patch(
            "src.smart_rag.agents.factories.base_factory.AgentFactory"
        ) as mock_factory_cls:
            mock_factory = MagicMock()
            mock_factory.create_search_agent.return_value = (
                MagicMock(),
                MagicMock(),
                "search instructions",
            )
            mock_factory.create_manager_agent.return_value = MagicMock()
            mock_factory_cls.return_value = mock_factory
            created = await team._create_agent_team(team_config, "sess-1")
        assert created.manager is not None
        assert len(created.agents) == 1
        mock_factory.set_web_preview_tool_config.assert_called_once_with(search_config.tools[1])
        assert mock_factory.create_search_agent.call_args.kwargs["generate_web_preview"] is True
