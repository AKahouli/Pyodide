import pytest

from src.smart_rag.agents.tools.temporary_child_agent import (
    make_temporary_child_agent_tool,
    should_enable_temporary_child_agent_tool,
)


class _Helper:
    @staticmethod
    def normalize_agent_name(name: str) -> str:
        return name.lower().replace(" ", "_")


class _DelegationFactory:
    def __init__(self):
        self.created_configs = []
        self.executed_configs = []

    async def _create_agent_with_error_handling(
        self,
        agent_config,
        agent_name,
        normalized_agent_name,
        expected_output,
        delegation_span,
        search_web,
        citation_manager,
    ):
        self.created_configs.append(agent_config)
        return object(), object()

    async def _execute_agent_with_error_handling(
        self,
        agent,
        agent_config,
        task_description,
        expected_output,
        task_order,
        delegation_span,
        q,
        agent_name,
        agent_id="no_id",
        toolkit=None,
        image_input=None,
    ):
        self.executed_configs.append(agent_config)
        return f"child result: {task_description}"


class _Team:
    def __init__(self):
        self.config = type("Config", (), {"session_id": "session-1"})()
        self.agent_helper = _Helper()
        self.delegation_factory = _DelegationFactory()
        self.citation_manager = object()


@pytest.mark.asyncio
async def test_temporary_child_agent_tool_inherits_parent_runtime_config():
    parent_config = {
        "id": "parent",
        "name": "SearchV2",
        "prompt": "parent prompt",
        "tools": [{"name": "search"}],
        "skills": [{"name": "skill"}],
        "agent_params": {
            "connector_bindings_json": "[{}]",
            "enable_temporary_child_agents": "true",
            "max_temporary_child_agents": "1",
        },
    }
    team = _Team()
    tool = make_temporary_child_agent_tool(team, parent_config, parent_span=None)

    result = await tool("Find the deadline", "Return cited facts")
    second_result = await tool("Find the payment schedule", "Return cited facts")

    child_config = team.delegation_factory.created_configs[0]
    assert result == "child result: Find the deadline"
    assert "limit reached" in second_result
    assert child_config["tools"] == parent_config["tools"]
    assert child_config["skills"] == parent_config["skills"]
    assert child_config["agent_params"]["connector_bindings_json"] == "[{}]"
    assert child_config["agent_params"]["enable_temporary_child_agents"] == "false"
    assert child_config["_is_temporary_child_agent"] is True
    assert child_config["save_memory"] is False
    assert child_config["id"].startswith("parent_tmp_")


def test_temporary_child_agent_tool_requires_explicit_enable_flag():
    assert should_enable_temporary_child_agent_tool({"agent_params": {}}) is False
    assert should_enable_temporary_child_agent_tool(
        {"agent_params": {"connector_bindings_json": "[{}]"}}
    ) is False
    assert should_enable_temporary_child_agent_tool(
        {"agent_params": {"enable_temporary_child_agents": "true"}}
    ) is True
    assert should_enable_temporary_child_agent_tool(
        {
            "_is_temporary_child_agent": True,
            "agent_params": {
                "enable_temporary_child_agents": "true",
            }
        }
    ) is False


@pytest.mark.asyncio
async def test_temporary_child_agent_tool_uses_default_for_invalid_limit():
    parent_config = {
        "id": "parent",
        "name": "SearchV2",
        "prompt": "parent prompt",
        "agent_params": {
            "enable_temporary_child_agents": "true",
            "max_temporary_child_agents": "invalid",
        },
    }
    tool = make_temporary_child_agent_tool(_Team(), parent_config, parent_span=None)

    result = await tool("Find the deadline")

    assert result == "child result: Find the deadline"
