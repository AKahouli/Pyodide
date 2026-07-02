"""Extended AgentRepository coverage for real repository methods."""

from unittest.mock import MagicMock

import pytest

from src.smart_rag.agents.core.repository import AgentRepository


@pytest.fixture
def repository():
    helper = MagicMock()
    helper.normalize_agent_name.side_effect = lambda name: str(name or "").lower().replace(" ", "_")
    return AgentRepository(helper)


class TestAgentRepositoryExtended:
    def test_set_agents_replaces_collection(self, repository):
        repository.set_agents([{"name": "Agent1"}, {"name": "Agent2"}])
        assert len(repository.get_all_agents()) == 2

    def test_get_agent_id_by_name_returns_id(self, repository):
        repository.add_agent({"name": "Search Agent", "id": "agent-123"})
        assert repository.get_agent_id_by_name("Search Agent") == "agent-123"

    def test_get_agent_id_by_name_missing_agent(self, repository):
        assert repository.get_agent_id_by_name("Missing") == "no_id"

    def test_has_search_agents_detects_string_and_dict_tools(self, repository):
        repository.set_agents(
            [
                {"name": "Calc", "tools": ["calculator"]},
                {"name": "Search", "tools": ["search"]},
            ]
        )
        assert repository.has_search_agents() is True

        repository.set_agents(
            [{"name": "Search", "tools": [{"name": "search", "description": "docs"}]}]
        )
        assert repository.has_search_agents() is True

        repository.set_agents([{"name": "Calc", "tools": ["calculator"]}])
        assert repository.has_search_agents() is False

    def test_has_code_interpreter_detects_tool(self, repository):
        repository.set_agents(
            [{"name": "Operator", "tools": ["code interpreter"]}]
        )
        assert repository.has_code_interpreter() is True

        repository.set_agents(
            [{"name": "Operator", "tools": [{"name": "code interpreter"}]}]
        )
        assert repository.has_code_interpreter() is True

    def test_get_normalized_agent_name_from_object(self, repository):
        agent_obj = MagicMock()
        agent_obj.name = "Report Writer"
        repository._helper.normalize_agent_name.return_value = "report_writer"
        assert repository._get_normalized_agent_name(agent_obj) == "report_writer"

    def test_get_agent_by_name_uses_normalization(self, repository):
        repository.add_agent({"name": "Search Agent", "prompt": "find docs"})
        found = repository.get_agent_by_name("search_agent")
        assert found is not None
        assert found["prompt"] == "find docs"
