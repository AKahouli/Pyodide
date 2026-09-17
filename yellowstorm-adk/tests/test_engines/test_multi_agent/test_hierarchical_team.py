from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from src.grpc_generated import chatbot_pb2
from src.grpc_server.chatbot_servicer import ChatbotServicer
from src.schema.chatbot_schema import RunAgentTeamRequest
from src.smart_rag.engines.multi_agent.hierarchical_agents import validate_hierarchical_request


def request(nodes=None, agents=None, mode="hierarchical"):
    return RunAgentTeamRequest(
        user_id="user-1",
        session_id="session-1",
        message="solve it",
        chatbot_name={"provider": "fake"},
        agent_mode=mode,
        agents=agents or [
            {"id": "root", "name": "Root", "description": "root", "prompt": "root", "agent_type": "manager"},
            {"id": "nested", "name": "Nested", "description": "nested", "prompt": "nested", "agent_type": "manager"},
            {"id": "leaf", "name": "Leaf", "description": "leaf", "prompt": "leaf", "agent_type": "worker"},
        ],
        team_definition={
            "team_id": "team-1",
            "nodes": nodes or [
                {"agent_id": "root", "parent_agent_id": None, "order": 0},
                {"agent_id": "nested", "parent_agent_id": "root", "order": 0},
                {"agent_id": "leaf", "parent_agent_id": "nested", "order": 0},
            ],
        },
    )


def test_validates_root_nested_manager_and_direct_children():
    root, children = validate_hierarchical_request(request())
    assert root.id == "root"
    assert children == {"root": ["nested"], "nested": ["leaf"]}


@pytest.mark.parametrize("broken", [
    [{"agent_id": "root", "parent_agent_id": None}, {"agent_id": "nested", "parent_agent_id": None}, {"agent_id": "leaf", "parent_agent_id": "nested"}],
    [{"agent_id": "root", "parent_agent_id": None}, {"agent_id": "nested", "parent_agent_id": "missing"}, {"agent_id": "leaf", "parent_agent_id": "nested"}],
])
def test_rejects_malformed_topology(broken):
    with pytest.raises(ValueError):
        validate_hierarchical_request(request(nodes=broken))


def test_rejects_non_manager_parent_duplicate_agents_and_limits():
    non_manager_parent = request(agents=[
        {"id": "root", "name": "Root", "description": "root", "prompt": "root", "agent_type": "manager"},
        {"id": "nested", "name": "Nested", "description": "nested", "prompt": "nested", "agent_type": "worker"},
        {"id": "leaf", "name": "Leaf", "description": "leaf", "prompt": "leaf", "agent_type": "worker"},
    ])
    with pytest.raises(ValueError, match="every parent"):
        validate_hierarchical_request(non_manager_parent)

    duplicate = request(agents=[request().agents[0], request().agents[0]])
    with pytest.raises(ValueError, match="identical IDs"):
        validate_hierarchical_request(duplicate)

    deep_nodes = [
        {"agent_id": f"m{i}", "parent_agent_id": f"m{i - 1}" if i else None}
        for i in range(6)
    ]
    deep_agents = [
        {"id": f"m{i}", "name": f"M{i}", "description": "manager", "prompt": "manager", "agent_type": "manager"}
        for i in range(6)
    ]
    with pytest.raises(ValueError, match="maximum depth"):
        validate_hierarchical_request(request(nodes=deep_nodes, agents=deep_agents))

    wide_nodes = [{"agent_id": "root", "parent_agent_id": None}] + [
        {"agent_id": f"leaf{i}", "parent_agent_id": "root"} for i in range(25)
    ]
    wide_agents = [{"id": "root", "name": "Root", "description": "root", "prompt": "root", "agent_type": "manager"}] + [
        {"id": f"leaf{i}", "name": f"Leaf{i}", "description": "leaf", "prompt": "leaf", "agent_type": "worker"}
        for i in range(25)
    ]
    with pytest.raises(ValueError, match="team size"):
        validate_hierarchical_request(request(nodes=wide_nodes, agents=wide_agents))


@pytest.mark.asyncio
async def test_recursive_delegation_preserves_yellowstorm_runner_lifecycle():
    from src.smart_rag.agents.factories.delegation_factory import AgentDelegationFactory

    repository = MagicMock()
    repository.get_agent_by_name.return_value = {
        "id": "nested",
        "name": "agent_nested",
        "description": "nested",
        "agent_params": {"enable_temporary_child_agents": "true"},
    }
    repository.get_agent_id_by_name.return_value = "nested"
    repository.get_agent_by_id.return_value = {"id": "leaf", "name": "agent_leaf", "description": "leaf"}
    helper = MagicMock()
    helper.normalize_agent_name.side_effect = lambda value: value
    helper.sanitize_function_name.side_effect = lambda value: value
    helper._create_enhanced_manager_prompt.return_value = "nested prompt"
    factory = AgentDelegationFactory(SimpleNamespace(chatbot_name={}, session_id="s"), MagicMock(), MagicMock(), repository, helper, MagicMock(), None)
    factory.set_hierarchy({"nested": ["leaf"]})
    delegated_agent = SimpleNamespace(tools=[], instruction="base")
    factory._create_agent_with_error_handling = AsyncMock(return_value=(delegated_agent, None))
    activity = {
        "component": {"type": "tool_activity"},
        "metadata": {"actor": {"agent_id": "nested_tmp"}},
    }

    async def execute(_agent, config, *_args, **_kwargs):
        if config.get("_is_temporary_child_agent"):
            await _args[3].put(activity)
            return "temporary result"
        return "nested result"

    factory._execute_agent_with_error_handling = AsyncMock(side_effect=execute)
    outer_queue = AsyncMock()

    result = await factory.make_delegate_function("agent_nested", outer_queue)("task", "answer")

    assert result == "nested result"
    assert [tool.__name__ for tool in delegated_agent.tools] == [
        "delegate_to_agent_leaf",
        "create_temporary_child_agent",
    ]
    outer_queue.put.assert_awaited_once_with(activity)
    assert factory._execute_agent_with_error_handling.await_count == 2


@pytest.mark.asyncio
async def test_root_temporary_child_capability_preserves_authored_delegation():
    from src.smart_rag.engines.multi_agent.team_orchestrator import AutoAgentGenerationTeam

    team = AutoAgentGenerationTeam.__new__(AutoAgentGenerationTeam)
    team.config = SimpleNamespace(session_id="session-1")
    team.agent_helper = MagicMock()
    team.agent_helper.normalize_agent_name.return_value = "root_child"
    team.delegation_factory = MagicMock()
    team.citation_manager = MagicMock()
    outer_queue = AsyncMock()
    team.current_queue = outer_queue
    manager = SimpleNamespace(tools=["delegate_to_nested"], instruction="root prompt")
    manager_config = {
        "id": "root",
        "name": "Root",
        "agent_params": {"enable_temporary_child_agents": "true"},
    }

    activity = {
        "component": {"type": "tool_activity"},
        "metadata": {"actor": {"agent_id": "root_tmp"}},
    }
    team.delegation_factory._create_agent_with_error_handling = AsyncMock(
        return_value=(SimpleNamespace(), None)
    )

    async def execute(_agent, _config, *_args, **_kwargs):
        await _args[3].put(activity)
        return "temporary result"

    team.delegation_factory._execute_agent_with_error_handling = AsyncMock(
        side_effect=execute
    )

    prompt = await team._attach_required_temporary_child_tool(
        manager,
        manager_config,
        "solve it",
        preserve_existing_tools=True,
    )

    assert manager.tools[0] == "delegate_to_nested"
    assert manager.tools[1].__name__ == "create_temporary_child_agent"
    outer_queue.put.assert_awaited_once_with(activity)
    assert "temporary result" in prompt


@pytest.mark.asyncio
async def test_root_delegation_returns_leaf_output_through_nested_manager():
    from src.smart_rag.agents.factories.delegation_factory import AgentDelegationFactory

    configs = {
        "agent_nested": {"id": "nested", "name": "agent_nested", "description": "nested"},
        "agent_leaf": {"id": "leaf", "name": "agent_leaf", "description": "leaf"},
    }
    repository = MagicMock()
    repository.get_agent_by_name.side_effect = configs.get
    repository.get_agent_by_id.side_effect = lambda agent_id: next(item for item in configs.values() if item["id"] == agent_id)
    repository.get_agent_id_by_name.side_effect = lambda name: configs[name]["id"]
    helper = MagicMock()
    helper.normalize_agent_name.side_effect = lambda value: value
    helper.sanitize_function_name.side_effect = lambda value: value
    helper._create_enhanced_manager_prompt.return_value = "nested prompt"
    factory = AgentDelegationFactory(SimpleNamespace(chatbot_name={}, session_id="s"), MagicMock(), MagicMock(), repository, helper, MagicMock(), None)
    factory.set_hierarchy({"root": ["nested"], "nested": ["leaf"]})
    factory._create_agent_with_error_handling = AsyncMock(side_effect=lambda config, *_args: (SimpleNamespace(tools=[], instruction=config["name"]), None))

    async def execute(agent, config, *_args, **_kwargs):
        if config["id"] == "nested":
            return f"nested({await agent.tools[0]('leaf task', 'leaf output')})"
        return "leaf-result"

    factory._execute_agent_with_error_handling = AsyncMock(side_effect=execute)
    result = await factory.make_delegate_function("agent_nested")("nested task", "nested output")
    assert result == "nested(leaf-result)"


@pytest.mark.asyncio
async def test_grpc_conversion_preserves_topology_and_selects_the_topology_root():
    pb_request = chatbot_pb2.RunAgentTeamRequest(
        user_context=chatbot_pb2.UserContext(user_id="user-1"),
        conversation_id="session-1",
        query="solve it",
        agent_mode="hierarchical",
        agents=[
            chatbot_pb2.Agent(id="leaf", name="Leaf", agent_type="worker", chatbot=chatbot_pb2.Chatbot(model="leaf-model")),
            chatbot_pb2.Agent(
                id="root",
                name="Root",
                prompt="root prompt",
                agent_type="manager",
                chatbot=chatbot_pb2.Chatbot(
                    model="root-model",
                    input_modalities=["text", "image"],
                    reasoning_effort="high",
                    context_window_tokens=200_000,
                    compaction=chatbot_pb2.Compaction(
                        enabled=True,
                        compaction_interval=10,
                        overlap_size=2,
                        token_fraction=0.75,
                        event_retention_size=6,
                    ),
                ),
            ),
        ],
        team_definition=chatbot_pb2.AgentTeamDefinition(
            team_id="team-1",
            nodes=[
                chatbot_pb2.AgentTeamNode(agent_id="root"),
                chatbot_pb2.AgentTeamNode(agent_id="leaf", parent_agent_id="root", order=2),
            ],
        ),
    )

    converted = await ChatbotServicer.__new__(ChatbotServicer)._convert_agent_team_request_v2(pb_request)
    assert converted.chatbot_name == {
        "provider": "root-model",
        "input_modalities": ["text", "image"],
        "reasoning_effort": "high",
        "context_window_tokens": 200_000,
        "compaction": {
            "enabled": True,
            "compaction_interval": 10,
            "overlap_size": 2,
            "token_fraction": pytest.approx(0.75),
            "event_retention_size": 6,
            "summarizer_model": "",
        },
    }
    assert converted.manager_prompt == "root prompt"
    assert converted.team_definition.nodes[0].parent_agent_id is None
    assert converted.team_definition.nodes[1].order == 2


@pytest.mark.asyncio
async def test_grpc_conversion_rejects_mode_definition_mismatch():
    pb_request = chatbot_pb2.RunAgentTeamRequest(
        user_context=chatbot_pb2.UserContext(user_id="user-1"),
        conversation_id="session-1",
        query="solve it",
        agent_mode="manual",
        team_definition=chatbot_pb2.AgentTeamDefinition(team_id="team-1"),
    )
    with pytest.raises(ValueError, match="provided together"):
        await ChatbotServicer.__new__(ChatbotServicer)._convert_agent_team_request_v2(pb_request)
