from unittest.mock import AsyncMock

import pytest
from google.adk.agents import LlmAgent
from google.adk.tools import AgentTool, FunctionTool

from src.root_runtime.leaf_tools import install_leaf_tool_gate
from src.smart_rag.infrastructure.external.purpose_aware_mcp import PurposeAwareMcpTool
from src.smart_rag.tools import calculator
from src.smart_rag.tools.utilities.connector_tools import ConnectorToolContext, create_connector_tools


def _gate():
    existing = AsyncMock(return_value=None)
    agent = LlmAgent(name="worker", model="test", before_tool_callback=existing)
    install_leaf_tool_gate(agent)
    assert agent.before_tool_callback[1] is existing
    return agent.before_tool_callback[0]


@pytest.mark.asyncio
async def test_native_identity_allowed_but_same_name_and_metadata_cannot_promote_tool():
    gate = _gate()
    assert await gate(FunctionTool(calculator), {}, None) is None

    async def calculator_clone(expression: str):
        raise AssertionError("must not execute")

    calculator_clone.__name__ = "calculator"
    tool = FunctionTool(calculator_clone)
    tool.metadata = {"source": "native", "execution_kind": "leaf"}
    assert "error" in await gate(tool, {"execution_kind": "leaf"}, None)
    # The same mandatory gate is reached again after an approval/resume.
    assert "error" in await gate(tool, {"approved": True}, None)


@pytest.mark.asyncio
@pytest.mark.parametrize("kind,allowed", [("leaf", True), (None, False), ("unknown", False),
                                         ("orchestration", False), ("LEAF", False)])
async def test_connector_classification_is_bound_to_constructed_action(kind, allowed):
    action = {"action_key": "calculator", "parameter_schema": {}}
    if kind is not None:
        action["execution_kind"] = kind
    tool = create_connector_tools([
        {"connector_id": "connector", "connector_slug": "test", "actions": [action]}
    ], ConnectorToolContext())[0]
    tool.metadata = {"execution_kind": "leaf"}
    result = await _gate()(tool, {"execution_kind": "leaf"}, None)
    assert (result is None) is allowed


@pytest.mark.asyncio
async def test_nested_agent_and_raw_remote_tool_wrappers_are_denied():
    gate = _gate()
    agent_tool = AgentTool(LlmAgent(name="nested", model="test"))
    assert "error" in await gate(agent_tool, {}, None)
    assert "error" in await gate(PurposeAwareMcpTool(agent_tool), {}, None)
    # A local display wrapper does not grant authority to its wrapped tool.
    assert "error" in await gate(PurposeAwareMcpTool(FunctionTool(calculator)), {}, None)


def test_direct_agent_routing_and_custom_execution_nodes_reject_compilation():
    agent = LlmAgent(name="worker", model="test", sub_agents=[LlmAgent(name="child", model="test")])
    with pytest.raises(ValueError, match="without routable"):
        install_leaf_tool_gate(agent)
    with pytest.raises(ValueError):
        install_leaf_tool_gate(object())
