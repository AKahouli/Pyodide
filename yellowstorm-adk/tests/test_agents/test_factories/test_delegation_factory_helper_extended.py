"""Extended tests for delegation factory agent creation helpers."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.smart_rag.agents.factories.delegation_factory_helper import (
    _attach_mcp_search_state,
    _attach_mcp_toolset,
    create_agent_for_delegation,
    create_regular_agent,
    create_search_agent_with_tools,
    create_standard_agent_with_tools,
)


def _config():
    return SimpleNamespace(
        user_id="user-1",
        session_id="sess-1",
        brain_ids=["b1"],
        vectorstore_name="vs",
        connector_repo=None,
        skills=[],
    )


def _agent_config(with_search=False):
    tools = [{"name": "search", "top_k": 5}] if with_search else [{"name": "calculator"}]
    return {
        "id": "agent-1",
        "tools": tools,
        "brain_documents": [],
        "brain_relations": {},
        "brain_ids": ["b1"],
        "agent_params": {"temperature": 0.1, "max_tokens": 1000},
    }


class TestDelegationFactoryHelperExtended:
    def test_attach_mcp_search_state(self):
        agent = MagicMock()
        _attach_mcp_search_state(agent, _config(), {"mcp": {}})
        assert agent._mcp_search_state["_mcp_search_user_id"] == "user-1"

    @pytest.mark.asyncio
    async def test_attach_mcp_toolset_streamable_http(self):
        agent = MagicMock()
        agent.tools = []
        config = _config()
        with patch(
            "src.smart_rag.agents.factories.delegation_factory_helper.MCPHelper.create_toolsets",
            return_value=[MagicMock()],
        ):
            _attach_mcp_toolset(
                agent,
                config,
                {
                    "mcp": {
                        "transport_type": "streamable_http",
                        "server_url": "https://mcp.example.com",
                    },
                    "tools": [],
                },
            )
        assert len(agent.tools) == 1

    def test_create_regular_agent_routes_to_search(self):
        helper = MagicMock()
        tool_helper = MagicMock()
        agent_factory = MagicMock()
        with patch(
            "src.smart_rag.agents.factories.delegation_factory_helper.create_search_agent_with_tools",
            return_value=(MagicMock(), MagicMock()),
        ) as mock_create:
            create_regular_agent(
                helper,
                tool_helper,
                agent_factory,
                _config(),
                _agent_config(with_search=True),
                ["search"],
                "prompt",
                "output",
                "SearchAgent",
                "bot",
            )
        mock_create.assert_called_once()

    def test_create_agent_for_delegation_delegates(self):
        with patch(
            "src.smart_rag.agents.factories.delegation_factory_helper.create_regular_agent",
            return_value=(MagicMock(), None),
        ) as mock_create:
            create_agent_for_delegation(
                MagicMock(),
                MagicMock(),
                MagicMock(),
                _config(),
                _agent_config(),
                ["calculator"],
                "prompt",
                "output",
                "Agent",
                "bot",
            )
        mock_create.assert_called_once()

    def test_create_search_agent_with_tools_connector_bindings(self):
        helper = MagicMock()
        agent_factory = MagicMock()
        mock_agent = MagicMock()
        mock_agent.tools = []
        agent_factory.create_search_agent.return_value = (mock_agent, MagicMock(), "instr")
        agent_factory._resolve_connector_workspace_id.return_value = "w1"
        config = _config()
        agent_config = _agent_config(with_search=True)
        agent_config["agent_params"] = {
            "connector_bindings_json": '[{"connector_id": "c1", "action": "search"}]',
            "platform_api_url": "https://platform.example.com",
            "platform_api_token": "internal-secret",
            "user_id": "user-1",
        }
        agent_config["tools"].append({"name": "save_file_to_workspace"})
        with patch(
            "src.smart_rag.agents.factories.delegation_factory_helper.create_connector_tools",
            return_value=[MagicMock()],
        ), patch(
            "src.smart_rag.agents.factories.delegation_factory_helper.prepare_agent_data",
            return_value=([], [], "prompt", ["b1"], "vs", "bot"),
        ):
            agent, toolkit = create_search_agent_with_tools(
                helper,
                agent_factory,
                config,
                agent_config,
                ["search", "calculator", "code interpreter"],
                "prompt",
                "1",
                "SearchAgent",
                "bot",
                False,
            )
        assert agent is mock_agent
        assert toolkit is not None
        assert len(mock_agent.tools) >= 2
        assert any(getattr(tool, "__name__", "") == "save_file_to_workspace" for tool in mock_agent.tools)

    def test_create_standard_agent_with_tools(self):
        helper = MagicMock()
        agent_factory = MagicMock()
        agent_factory.create_agent.return_value = MagicMock(tools=[])
        agent_config = _agent_config()
        agent_config["tools"].append({"name": "save_file_to_workspace"})
        agent_config["agent_params"].update({
            "platform_api_url": "https://platform.example.com",
            "platform_api_token": "internal-secret",
            "user_id": "user-1",
        })
        with patch(
            "src.smart_rag.agents.factories.delegation_factory_helper.prepare_agent_data",
            return_value=([], [], "prompt", ["b1"], "vs", "bot"),
        ):
            agent, toolkit = create_standard_agent_with_tools(
                helper,
                agent_factory,
                _config(),
                agent_config,
                ["calculator"],
                "prompt",
                "1",
                "CalcAgent",
                "bot",
                False,
            )
        assert agent is not None
        assert toolkit is None
        assert any(getattr(tool, "__name__", "") == "save_file_to_workspace" for tool in agent.tools)

    def test_create_standard_agent_passes_configured_render_chart_to_factory(self):
        helper = MagicMock()
        agent_factory = MagicMock()
        agent_factory.create_agent.return_value = MagicMock(tools=[])
        agent_config = _agent_config()
        agent_config["tools"] = [{"name": "render_chart"}]
        with patch(
            "src.smart_rag.agents.factories.delegation_factory_helper.prepare_agent_data",
            return_value=([], [], "prompt", ["b1"], "vs", "bot"),
        ):
            create_standard_agent_with_tools(
                helper, agent_factory, _config(), agent_config, ["render_chart"],
                "prompt", "1", "ChartAgent", "bot", False,
            )
        assert agent_factory.create_agent.call_args.kwargs["render_chart_tool"] is True

    def test_create_standard_agent_does_not_pass_disabled_render_chart_to_factory(self):
        helper = MagicMock()
        agent_factory = MagicMock()
        agent_factory.create_agent.return_value = MagicMock(tools=[])
        agent_config = _agent_config()
        agent_config["tools"] = [{"name": "render_chart", "enabled": False}]
        with patch(
            "src.smart_rag.agents.factories.delegation_factory_helper.prepare_agent_data",
            return_value=([], [], "prompt", ["b1"], "vs", "bot"),
        ):
            create_standard_agent_with_tools(
                helper, agent_factory, _config(), agent_config, ["render_chart"],
                "prompt", "1", "ChartAgent", "bot", False,
            )
        assert agent_factory.create_agent.call_args.kwargs["render_chart_tool"] is False

    def test_create_search_agent_does_not_pass_disabled_render_chart_to_factory(self):
        helper = MagicMock()
        agent_factory = MagicMock()
        agent_factory.create_search_agent.return_value = (MagicMock(tools=[]), MagicMock(), "instr")
        agent_config = _agent_config(with_search=True)
        agent_config["tools"].append({"name": "render_chart", "enabled": False})
        with patch(
            "src.smart_rag.agents.factories.delegation_factory_helper.prepare_agent_data",
            return_value=([], [], "prompt", ["b1"], "vs", "bot"),
        ):
            create_search_agent_with_tools(
                helper, agent_factory, _config(), agent_config, ["search", "render_chart"],
                "prompt", "1", "SearchAgent", "bot", False,
            )
        assert agent_factory.create_search_agent.call_args.kwargs["render_chart_tool"] is False
