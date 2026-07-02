"""Extended unit tests for AgentToolsManager real API paths."""

from unittest.mock import MagicMock, patch

import pytest

from src.smart_rag.agents.tools.tools_manager import AgentToolsManager


def _manager():
    repository = MagicMock()
    factory = MagicMock()
    helper = MagicMock()
    helper.sanitize_function_name.side_effect = lambda name: name.replace("-", "_")
    return AgentToolsManager(repository, factory, helper), repository, factory, helper


class TestAgentToolsManagerExtended:
    def test_extract_agent_tools_from_mentions_creates_delegate_tools(self):
        manager, repository, factory, helper = _manager()
        repository.get_agent_by_name.return_value = {"name": "searchagent", "tools": []}
        delegate = MagicMock()
        factory.make_delegate_function.return_value = delegate

        tools = manager.extract_agent_tools_from_mentions("Ask @SearchAgent to summarize")

        assert len(tools) == 1
        assert tools[0].__name__ == "delegate_to_searchagent"
        repository.get_agent_by_name.assert_called_once_with("searchagent")
        factory.make_delegate_function.assert_called_once()

    def test_extract_agent_tools_skips_unknown_mentions(self):
        manager, repository, factory, _ = _manager()
        repository.get_agent_by_name.return_value = None

        tools = manager.extract_agent_tools_from_mentions("Use @UnknownAgent please")

        assert tools == []
        factory.make_delegate_function.assert_not_called()

    def test_create_tools_from_all_agents(self):
        manager, repository, factory, _ = _manager()
        repository.get_all_agents.return_value = [
            {"name": "Search Agent"},
            {"name": "Calc-Agent"},
        ]
        factory.make_delegate_function.side_effect = [MagicMock(), MagicMock()]

        tools = manager.create_tools_from_all_agents()

        assert len(tools) == 2
        assert tools[0].__name__ == "delegate_to_search_agent"
        assert tools[1].__name__ == "delegate_to_calc_agent"

    @patch("src.smart_rag.agents.tools.tools_manager.logger")
    def test_get_agent_tools_falls_back_to_all_agents(self, mock_logger):
        manager, repository, factory, _ = _manager()
        repository.get_agent_by_name.return_value = None
        repository.get_all_agents.return_value = [{"name": "fallback_agent"}]
        factory.make_delegate_function.return_value = MagicMock()

        tools = manager.get_agent_tools("no mentions here")

        assert len(tools) == 1
        mock_logger.warning.assert_called_once()

    def test_get_agent_tools_raises_when_no_agents_available(self):
        manager, repository, factory, _ = _manager()
        repository.get_agent_by_name.return_value = None
        repository.get_all_agents.return_value = []

        with pytest.raises(ValueError, match="No agents available"):
            manager.get_agent_tools("empty prompt")

    def test_get_agent_tools_uses_mentions_when_present(self):
        manager, repository, factory, _ = _manager()
        repository.get_agent_by_name.return_value = {"name": "searchagent"}
        factory.make_delegate_function.return_value = MagicMock()

        tools = manager.get_agent_tools("delegate to @SearchAgent")

        assert len(tools) == 1
        repository.get_all_agents.assert_not_called()
