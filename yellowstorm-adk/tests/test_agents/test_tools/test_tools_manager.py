"""Unit tests for AgentToolsManager and AgentRepository."""

from unittest.mock import MagicMock

import pytest

from src.smart_rag.agents.core.repository import AgentRepository
from src.smart_rag.agents.tools.tools_manager import AgentToolsManager


class TestAgentRepository:
    def test_add_get_and_set_agents(self):
        helper = MagicMock()
        helper.normalize_agent_name.side_effect = lambda n: n.lower()
        repo = AgentRepository(helper)
        repo.add_agent({"name": "Search Agent", "tools": ["search"]})
        assert repo.get_agent_by_name("search agent")["name"] == "Search Agent"
        repo.set_agents([{"name": "Writer", "tools": []}])
        assert len(repo.get_all_agents()) == 1

    def test_has_search_agents_and_code_interpreter(self):
        helper = MagicMock()
        helper.normalize_agent_name.side_effect = lambda n: n
        repo = AgentRepository(helper)
        repo.set_agents([
            {"name": "search", "tools": ["search"]},
            {"name": "ops", "tools": ["code interpreter"]},
        ])
        assert repo.has_search_agents() is True
        assert repo.has_code_interpreter() is True

    def test_get_agent_id_by_name(self):
        helper = MagicMock()
        helper.normalize_agent_name.side_effect = lambda n: n
        repo = AgentRepository(helper)
        repo.set_agents([{"id": "a1", "name": "search"}])
        assert repo.get_agent_id_by_name("search") == "a1"


class TestAgentToolsManager:
    def test_extract_agent_tools_from_mentions(self):
        repo = MagicMock()
        repo.get_agent_by_name.return_value = {"name": "search"}
        factory = MagicMock()
        delegate = MagicMock()
        factory.make_delegate_function.return_value = delegate
        helper = MagicMock()
        helper.sanitize_function_name.return_value = "search"
        manager = AgentToolsManager(repo, factory, helper)
        tools = manager.extract_agent_tools_from_mentions("Ask @search_agent to find docs")
        assert len(tools) == 1
        assert tools[0].__name__ == "delegate_to_search"

    def test_create_tools_from_all_agents(self):
        repo = MagicMock()
        repo.get_all_agents.return_value = [{"name": "Search Agent"}, {"name": "Writer"}]
        factory = MagicMock()
        factory.make_delegate_function.return_value = MagicMock()
        helper = MagicMock()
        helper.sanitize_function_name.side_effect = lambda n: n
        manager = AgentToolsManager(repo, factory, helper)
        tools = manager.create_tools_from_all_agents()
        assert len(tools) == 2

    def test_get_agent_tools_falls_back_to_all_agents(self):
        repo = MagicMock()
        repo.get_agent_by_name.return_value = None
        repo.get_all_agents.return_value = [{"name": "search"}]
        factory = MagicMock()
        factory.make_delegate_function.return_value = MagicMock()
        helper = MagicMock()
        helper.sanitize_function_name.return_value = "search"
        manager = AgentToolsManager(repo, factory, helper)
        tools = manager.get_agent_tools("no mentions here")
        assert len(tools) == 1

    def test_get_agent_tools_raises_when_empty(self):
        repo = MagicMock()
        repo.get_agent_by_name.return_value = None
        repo.get_all_agents.return_value = []
        manager = AgentToolsManager(repo, MagicMock(), MagicMock())
        with pytest.raises(ValueError, match="No agents available"):
            manager.get_agent_tools("hello")
