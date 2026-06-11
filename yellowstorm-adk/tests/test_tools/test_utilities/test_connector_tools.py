import asyncio
import inspect
import json
from types import SimpleNamespace

import pytest

from src.smart_rag.tools.utilities.connector_tools import (
    ConnectorToolContext,
    create_connector_tools,
)


def _connector_binding(
    parameter_schema,
    auth_headers=None,
    fixed_params=None,
    action_key="search",
):
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
                "action_key": action_key,
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
    brain_documents=None,
    session_id=None,
    action_key="search",
):
    tools = create_connector_tools(
        [_connector_binding(parameter_schema, auth_headers, fixed_params, action_key)],
        ConnectorToolContext(
            workspace_id=workspace_id,
            workspace_names=workspace_names,
            brain_documents=brain_documents,
            session_id=session_id,
        ),
    )
    return tools[-1]


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


def test_connector_tool_injects_streamable_http_file_workspace_headers(
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
        workspace_id="workspace-1",
        workspace_names=["workspace-alpha"],
        auth_headers={
            "Authorization": "Bearer token",
            "X-User-Id": "user-1",
        },
        brain_documents=[
            {
                "filename": "report.pdf",
                "workspace_id": "workspace-1",
                "workspace_name": "workspace-alpha",
            },
            {
                "file_name": "budget.xlsx",
                "workspace_id": "workspace-2",
                "workspace_name": "workspace-beta",
            },
        ],
        session_id="conversation-1",
    )

    asyncio.run(tool.func(query="revenue"))

    assert captured["params"] == {"query": "revenue", "workspace_id": "workspace-1"}
    assert captured["auth_headers"] == {
        "Authorization": "Bearer token",
        "X-User-Id": "user-1",
        "workspace_id": '["workspace-1", "workspace-2", "workspace-alpha"]',
        "x-conversation-id": "conversation-1",
        "x-workspace-paths": "workspace-alpha,workspace-beta",
    }


def test_connector_tool_injects_single_file_name_header(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured = {}

    async def fake_call_mcp_tool(*args, **kwargs):
        captured["auth_headers"] = kwargs.get("auth_headers")
        return {"text": "ok"}

    monkeypatch.setattr(
        "src.flow_engine.mcp.call_mcp_tool",
        fake_call_mcp_tool,
    )

    tool = _first_connector_tool(
        {},
        workspace_id="workspace-1",
        auth_headers={"Authorization": "Bearer token"},
        brain_documents=[
            {
                "filename": "report.pdf",
                "workspace_id": "workspace-1",
                "workspace_name": "workspace-alpha",
            },
        ],
    )

    asyncio.run(tool.func(query="revenue"))

    assert captured["auth_headers"]["file_name"] == "report.pdf"


def test_read_section_tool_buffers_images_with_runtime_tool_context(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    payload = {
        "section_id": "sec_2",
        "text": "",
        "images": [
            {
                "image_id": "img-1",
                "mime": "image/png",
                "image_base64": "abc123",
            }
        ],
    }
    payload["text"] = json.dumps(payload)

    async def fake_call_mcp_tool(*args, **kwargs):
        return dict(payload)

    monkeypatch.setattr(
        "src.flow_engine.mcp.call_mcp_tool",
        fake_call_mcp_tool,
    )

    tool = _first_connector_tool({}, action_key="read_section")
    signature = inspect.signature(tool.func)
    tool_context = SimpleNamespace(state={})

    response = asyncio.run(tool.func(query="recipe", tool_context=tool_context))

    assert "tool_context" in signature.parameters
    assert "image_base64" not in str(response)
    assert response["images"][0]["image_attached"] is True
    image_keys = [
        key for key in tool_context.state if key.startswith("_pending_tool_images_")
    ]
    assert len(image_keys) == 1
    assert tool_context.state[image_keys[0]] == [
        {"mime": "image/png", "data": "abc123"}
    ]
