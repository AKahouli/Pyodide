import asyncio

import pytest

from src.smart_rag.tools.utilities.connector_tools import create_connector_tools


def _connector_binding(parameter_schema):
    return {
        "connector_id": "connector-1",
        "connector_name": "Workspace MCP",
        "connector_slug": "workspace",
        "mcp_transport_type": "streamable_http",
        "mcp_server_url": "https://example.com/mcp",
        "actions": [
            {
                "action_key": "search",
                "label": "Search",
                "description": "Search workspace content",
                "parameter_schema": parameter_schema,
            }
        ],
    }


def _first_connector_tool(parameter_schema, brain_ids=None, workspace_id=None):
    tools = create_connector_tools(
        [_connector_binding(parameter_schema)],
        brain_ids=brain_ids,
        workspace_id=workspace_id,
    )
    return tools[0]


def test_connector_tool_injects_bound_brain_id(monkeypatch: pytest.MonkeyPatch) -> None:
    captured = {}

    async def fake_call_mcp_tool(*args, **kwargs):
        captured["params"] = args[4]
        return {"text": "ok"}

    monkeypatch.setattr(
        "src.langgraph_engine.mcp_client_factory.call_mcp_tool",
        fake_call_mcp_tool,
    )

    tool = _first_connector_tool(
        {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "brain_id": {"type": "string"},
            },
            "required": ["query", "brain_id"],
        },
        brain_ids=["brain-123"],
    )

    assert "brain_id" not in tool.custom_schema["parameters"]["required"]

    asyncio.run(tool.func(query="revenue"))

    assert captured["params"] == {"query": "revenue", "brain_id": "brain-123"}
    assert "external_id" not in captured["params"]
    assert "external_ids" not in captured["params"]


def test_connector_tool_preserves_explicit_brain_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured = {}

    async def fake_call_mcp_tool(*args, **kwargs):
        captured["params"] = args[4]
        return {"text": "ok"}

    monkeypatch.setattr(
        "src.langgraph_engine.mcp_client_factory.call_mcp_tool",
        fake_call_mcp_tool,
    )

    tool = _first_connector_tool(
        {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "brain_id": {"type": "string"},
            },
            "required": ["query", "brain_id"],
        },
        brain_ids=["brain-123"],
    )

    asyncio.run(tool.func(query="revenue", brain_id="brain-explicit"))

    assert captured["params"]["brain_id"] == "brain-explicit"


def test_connector_tool_binds_workspace_id_alias_from_brain_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured = {}

    async def fake_call_mcp_tool(*args, **kwargs):
        captured["params"] = args[4]
        return {"text": "ok"}

    monkeypatch.setattr(
        "src.langgraph_engine.mcp_client_factory.call_mcp_tool",
        fake_call_mcp_tool,
    )

    tool = _first_connector_tool(
        {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "workspace_id": {"type": "string"},
            },
            "required": ["query", "workspace_id"],
        },
        brain_ids=["brain-123"],
    )

    assert "workspace_id" not in tool.custom_schema["parameters"]["required"]

    asyncio.run(tool.func(query="revenue"))

    assert captured["params"]["workspace_id"] == "brain-123"
    assert "external_id" not in captured["params"]
