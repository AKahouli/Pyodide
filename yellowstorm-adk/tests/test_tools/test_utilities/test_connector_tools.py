import asyncio

import pytest

from src.smart_rag.tools.utilities.connector_tools import create_connector_tools


def _connector_binding(parameter_schema, auth_headers=None, fixed_params=None):
    return {
        "connector_id": "connector-1",
        "connector_name": "Workspace MCP",
        "connector_slug": "workspace",
        "mcp_transport_type": "streamable_http",
        "mcp_server_url": "https://example.com/mcp",
        "auth_headers": auth_headers or {},
        "fixed_params": fixed_params or {},
        "actions": [
            {
                "action_key": "search",
                "label": "Search",
                "description": "Search workspace content",
                "parameter_schema": parameter_schema,
            }
        ],
    }


def _first_connector_tool(
    parameter_schema,
    workspace_names=None,
    workspace_id=None,
    auth_headers=None,
    fixed_params=None,
):
    tools = create_connector_tools(
        [_connector_binding(parameter_schema, auth_headers, fixed_params)],
        workspace_names=workspace_names,
        workspace_id=workspace_id,
    )
    return tools[0]


def test_connector_tool_injects_bound_workspace_name(monkeypatch: pytest.MonkeyPatch) -> None:
    captured = {}

    async def fake_call_mcp_tool(*args, **kwargs):
        captured["params"] = args[4]
        return {"text": "ok"}

    monkeypatch.setattr(
        "src.flow_engine.mcp.call_mcp_tool",
        fake_call_mcp_tool,
    )

    tool = _first_connector_tool(
        {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "workspace_name": {"type": "string"},
            },
            "required": ["query", "workspace_name"],
        },
        workspace_names=["workspace-alpha"],
    )

    assert "workspace_name" not in tool.custom_schema["parameters"]["required"]

    asyncio.run(tool.func(query="revenue"))

    assert captured["params"] == {
        "query": "revenue",
        "workspace_name": "workspace-alpha",
    }
    assert "external_id" not in captured["params"]
    assert "external_ids" not in captured["params"]


def test_connector_tool_binds_generic_params_as_workspace_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured = {}

    async def fake_call_mcp_tool(*args, **kwargs):
        captured["params"] = args[4]
        return {"text": "ok"}

    monkeypatch.setattr(
        "src.flow_engine.mcp.call_mcp_tool",
        fake_call_mcp_tool,
    )

    tool = _first_connector_tool({}, workspace_names=["workspace-alpha"])

    asyncio.run(tool.func(query="revenue"))

    assert captured["params"] == {
        "query": "revenue",
        "workspace_id": "workspace-alpha",
    }


def test_connector_tool_preserves_explicit_workspace_name(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured = {}

    async def fake_call_mcp_tool(*args, **kwargs):
        captured["params"] = args[4]
        return {"text": "ok"}

    monkeypatch.setattr(
        "src.flow_engine.mcp.call_mcp_tool",
        fake_call_mcp_tool,
    )

    tool = _first_connector_tool(
        {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "workspace_name": {"type": "string"},
            },
            "required": ["query", "workspace_name"],
        },
        workspace_names=["workspace-alpha"],
    )

    asyncio.run(tool.func(query="revenue", workspace_name="workspace-explicit"))

    assert captured["params"]["workspace_name"] == "workspace-explicit"


def test_connector_tool_binds_workspace_id_alias(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured = {}

    async def fake_call_mcp_tool(*args, **kwargs):
        captured["params"] = args[4]
        return {"text": "ok"}

    monkeypatch.setattr(
        "src.flow_engine.mcp.call_mcp_tool",
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
        workspace_names=["workspace-alpha"],
    )

    assert "workspace_id" not in tool.custom_schema["parameters"]["required"]

    asyncio.run(tool.func(query="revenue"))

    assert captured["params"]["workspace_id"] == "workspace-alpha"
    assert "external_id" not in captured["params"]


def test_connector_tool_prefers_explicit_workspace_id_over_names(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured = {}

    async def fake_call_mcp_tool(*args, **kwargs):
        captured["params"] = args[4]
        return {"text": "ok"}

    monkeypatch.setattr(
        "src.flow_engine.mcp.call_mcp_tool",
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
        workspace_names=["default"],
        workspace_id="workspace-actual-id",
    )

    asyncio.run(tool.func(query="revenue"))

    assert captured["params"]["workspace_id"] == "workspace-actual-id"


def test_connector_tool_replaces_placeholder_workspace_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured = {}

    async def fake_call_mcp_tool(*args, **kwargs):
        captured["params"] = args[4]
        return {"text": "ok"}

    monkeypatch.setattr(
        "src.flow_engine.mcp.call_mcp_tool",
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
        workspace_names=["default"],
        workspace_id="workspace-actual-id",
    )

    asyncio.run(tool.func(query="revenue", workspace_id="default"))

    assert captured["params"]["workspace_id"] == "workspace-actual-id"


def test_connector_tool_forwards_auth_headers_and_strips_user_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured = {}

    async def fake_call_mcp_tool(*args, **kwargs):
        captured["params"] = args[4]
        captured["auth_headers"] = kwargs.get("auth_headers")
        return {"text": "ok"}

    monkeypatch.setattr(
        "src.flow_engine.mcp.call_mcp_tool",
        fake_call_mcp_tool,
    )

    tool = _first_connector_tool(
        {},
        auth_headers={
            "Authorization": "Bearer token",
            "X-User-Id": "user-1",
        },
        fixed_params={"user_id": "fixed-user"},
    )

    asyncio.run(tool.func(query="revenue", user_id="llm-user"))

    assert captured["params"] == {"query": "revenue"}
    assert captured["auth_headers"] == {
        "Authorization": "Bearer token",
        "X-User-Id": "user-1",
    }
