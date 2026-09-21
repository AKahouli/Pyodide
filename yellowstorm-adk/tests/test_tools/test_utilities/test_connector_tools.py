import asyncio
import inspect
import json
from types import SimpleNamespace

import pytest

from src.connector_tool_name import build_connector_tool_name
from src.smart_rag.tools.utilities.connector_tools import (
    ConnectorToolContext,
    apply_dynamic_workspace_headers,
    create_connector_tools,
    without_dynamic_workspace_headers,
)
from src.smart_rag.infrastructure.external.purpose_aware_mcp import DISPLAY_PURPOSE_KEY


def test_dynamic_workspace_headers_override_stale_values_and_omit_empty_scope() -> None:
    config = [{"header_name": "Workspace-Id", "source": "workspace"}]

    assert apply_dynamic_workspace_headers(
        {"workspace-id": "stale", "Authorization": "Bearer token"},
        config,
        ["workspace-1", "workspace-2", "workspace-1"],
    ) == {
        "Authorization": "Bearer token",
        "Workspace-Id": "workspace-1,workspace-2",
    }
    assert apply_dynamic_workspace_headers(
        {"Workspace-Id": "stale"}, config, []
    ) == {}
    assert without_dynamic_workspace_headers(
        {"headers": {"workspace-id": "stale", "X-Other": "kept"}}, config
    ) == {"headers": {"X-Other": "kept"}}


def _connector_binding(
    parameter_schema,
    auth_headers=None,
    fixed_params=None,
    action_key="search",
    connector_slug="workspace",
    dynamic_headers=None,
    parameter_schema_json=None,
):
    return {
        "connector_id": "connector-1",
        "connector_name": "Workspace MCP",
        "connector_slug": connector_slug,
        "mcp_transport_type": "streamable_http",
        "mcp_server_url": "https://example.com/mcp",
        "auth_headers": auth_headers or {},
        "fixed_params": fixed_params or {},
        "dynamic_headers": dynamic_headers or [],
        "actions": [
            {
                "action_key": action_key,
                "label": "Search",
                "description": "Search workspace content",
                "parameter_schema": parameter_schema,
                **({"parameter_schema_json": parameter_schema_json} if parameter_schema_json is not None else {}),
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
    connector_slug="workspace",
    user_id=None,
    dynamic_headers=None,
    parameter_schema_json=None,
):
    tools = create_connector_tools(
        [_connector_binding(
            parameter_schema,
            auth_headers,
            fixed_params,
            action_key,
            connector_slug,
            dynamic_headers,
            parameter_schema_json,
        )],
        ConnectorToolContext(
            workspace_id=workspace_id,
            workspace_names=workspace_names,
            brain_documents=brain_documents,
            session_id=session_id,
            user_id=user_id,
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


def test_connector_tool_name_matches_nest_runtime_contract() -> None:
    tool = _first_connector_tool({"type": "object", "properties": {}})

    assert tool.name == "workspace_search"
    assert tool.custom_schema["name"] == "workspace_search"


def test_connector_tool_declares_display_purpose_but_does_not_forward_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured = {}

    async def fake_call_mcp_tool(*args, **kwargs):
        captured["params"] = args[4]
        return {"text": "ok"}

    monkeypatch.setattr("src.flow_engine.mcp.call_mcp_tool", fake_call_mcp_tool)
    tool = _first_connector_tool({
        "type": "object",
        "properties": {"query": {"type": "string"}},
        "required": ["query"],
    })

    declaration = tool._get_declaration()
    asyncio.run(tool.func(
        query="revenue",
        display_purpose="Find the requested revenue evidence",
    ))

    assert DISPLAY_PURPOSE_KEY == "display_purpose"
    assert declaration.parameters.required == ["query", DISPLAY_PURPOSE_KEY]
    assert declaration.parameters.properties[DISPLAY_PURPOSE_KEY].description
    assert inspect.signature(tool.func).parameters[DISPLAY_PURPOSE_KEY].default is inspect.Parameter.empty
    assert captured["params"] == {"query": "revenue"}


def test_connector_tool_name_is_openai_safe_and_matches_nest_contract() -> None:
    assert build_connector_tool_name(
        "sales@force", "search/files:v2"
    ) == "sales_force_search_files_v2_76fa7386062c04a3"
    long_name = build_connector_tool_name(
        "enterprise-knowledge-connector-with-a-very-long-stable-slug",
        "search_documents_with_extended_metadata_and_permissions",
    )

    assert long_name == (
        "enterprise-knowledge-connector-with-a-very-long_0bb708607e97c779"
    )
    assert len(long_name) == 64
    assert build_connector_tool_name(
        "workspace", "search/files"
    ) != build_connector_tool_name("workspace", "search:files")
    assert build_connector_tool_name(
        "workspace", "search\u001c"
    ) == "workspace_search__9e54e0e3d98b6a49"


def test_connector_tool_name_sanitization_does_not_change_mcp_action(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured = {}

    async def fake_call_mcp_tool(*args, **kwargs):
        captured["action_key"] = args[3]
        return {"text": "ok"}

    monkeypatch.setattr("src.flow_engine.mcp.call_mcp_tool", fake_call_mcp_tool)
    tool = _first_connector_tool({}, action_key="search\u001c")

    asyncio.run(tool.func(query="revenue"))

    assert tool.name == "workspace_search__9e54e0e3d98b6a49"
    assert captured["action_key"] == "search\u001c"


def test_connector_tool_does_not_inject_workspace_id_for_strict_schema(
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
        {"type": "object", "properties": {"query": {"type": "string"}}},
        workspace_names=["workspace-alpha"],
    )

    asyncio.run(tool.func(query="revenue"))

    assert captured["params"] == {"query": "revenue"}


def test_connector_tool_does_not_inject_workspace_id_for_strict_empty_schema(
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

    asyncio.run(tool.func())

    assert captured["params"] == {}


def test_connector_tool_strips_nullish_optional_parameters_before_mcp_call(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured = {}

    async def fake_call_mcp_tool(*args, **kwargs):
        captured["params"] = args[4]
        return {"text": "ok"}

    monkeypatch.setattr("src.flow_engine.mcp.call_mcp_tool", fake_call_mcp_tool)

    tool = _first_connector_tool(
        {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "query_type": {"type": "string", "enum": ["internal", "user"]},
                "page_size": {"type": "integer"},
                "data_source_url": {"type": "string"},
                "teamspace_id": {"type": "string"},
                "filters": {"type": "object"},
                "sort": {"type": "string", "enum": ["relevance", "last_edited", "created"]},
            },
            "required": ["query"],
        }
    )

    asyncio.run(
        tool.func(
            query="Emails",
            query_type=None,
            page_size=None,
            data_source_url=None,
            teamspace_id=None,
            filters=None,
            sort=None,
        )
    )

    assert captured["params"] == {"query": "Emails"}


def test_connector_tool_uses_serialized_parameter_schema_for_model_contract(
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
        {},
        workspace_names=["workspace-alpha"],
        parameter_schema_json=(
            '{"type":"object","properties":{'
            '"entity_type":{"type":"string","enum":["message"]},'
            '"query":{"type":"string"},'
            '"size":{"type":"integer"}},'
            '"required":["entity_type","query"]}'
        ),
    )

    assert "entity_type" in tool.custom_schema["parameters"]["properties"]
    assert "query" in tool.custom_schema["parameters"]["properties"]
    assert "size" in tool.custom_schema["parameters"]["properties"]
    assert "top" not in tool.custom_schema["parameters"]["properties"]
    assert "sort" not in tool.custom_schema["parameters"]["properties"]

    asyncio.run(tool.func(entity_type="message", query="from:sender@example.com"))

    assert captured["params"] == {
        "entity_type": "message",
        "query": "from:sender@example.com",
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
                "file_name": "private-notes.txt",
                "workspace_id": "workspace-2",
                "workspace_name": "workspace-beta",
                "filepath": "user-1/workspace-beta/private-notes.txt",
            },
            {
                "filename": "Search Explanation.docx",
                "workspace_id": "workspace-1",
                "workspace_name": "workspace-alpha",
                "filepath": "user-1/workspace-alpha/Search Explanation.docx",
            },
        ],
        session_id="conversation-1",
        connector_slug="code-interpreter",
        user_id="user-1",
    )

    asyncio.run(tool.func(query="revenue"))

    assert tool.name == "code-interpreter_search"
    assert captured["params"] == {"query": "revenue", "workspace_id": "workspace-1"}
    assert captured["auth_headers"] == {
        "Authorization": "Bearer token",
        "X-User-Id": "user-1",
        "workspace_id": '["workspace-1", "workspace-2", "workspace-alpha"]',
        "x-conversation-id": "conversation-1",
        # The run's own Ceph folder rides last, so the sandbox mounts somewhere a
        # connector can drop a file mid-run and the code interpreter can read it.
        "x-workspace-paths": "user-1/workspace-alpha,user-1/workspace-beta,user-1/system_conversation-1",
    }


def test_logical_search_connector_sends_only_authorization_and_workspace_scope(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured = {}

    async def fake_call_mcp_tool(*args, **kwargs):
        captured["params"] = args[4]
        captured["server_config"] = args[2]
        captured["auth_headers"] = kwargs.get("auth_headers")
        return {"text": "ok"}

    monkeypatch.setattr("src.flow_engine.mcp.call_mcp_tool", fake_call_mcp_tool)
    binding = _connector_binding(
        {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "workspace_id": {"type": "array", "items": {"type": "string"}},
                "file_names": {"type": "array", "items": {"type": "string"}},
            },
        },
        auth_headers={
            "authorization": "Bearer token",
            "X-mistral": "secret",
            "X-User-Id": "user-1",
        },
    )
    binding["connector_name"] = "Logical Search MCP"
    binding["connector_slug"] = "logical-search"
    binding["dynamic_headers"] = [
        {"header_name": "Workspace-Id", "source": "workspace"}
    ]
    binding["mcp_server_config"] = {
        "headers": {
            "aUtHoRiZaTiOn": "Bearer gateway-token",
            "X-Unsafe-Static": "must-not-pass",
            "Workspace-Id": "must-not-override-scope",
        },
    }
    tool = create_connector_tools(
        [binding],
        ConnectorToolContext(
            brain_ids=["workspace-alice", "workspace-bob"],
            file_names=["alice.pdf", "bob.pdf"],
            session_id="conversation-1",
            agent_id="agent-1",
        ),
    )[-1]

    asyncio.run(tool.func(query="guarantees"))

    assert captured["auth_headers"] == {
        "Authorization": "Bearer token",
        "Workspace-Id": "workspace-alice,workspace-bob",
    }
    from src.flow_engine.mcp import _build_headers

    assert _build_headers(
        captured.get("server_config"), captured["auth_headers"]
    ) == {
        "Authorization": "Bearer gateway-token",
        "Workspace-Id": "workspace-alice,workspace-bob",
    }
    assert captured["params"]["workspace_id"] == ["workspace-alice", "workspace-bob"]


def test_sse_connector_tool_gets_conversation_and_execution_ids(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """sse is the same MCP server behind a different stream, so it needs the
    same run/turn correlation headers streamable_http already got -- and only
    those, not the workspace-scoping set."""
    captured = {}

    async def fake_call_mcp_tool(*args, **kwargs):
        captured["auth_headers"] = kwargs.get("auth_headers")
        return {"text": "ok"}

    monkeypatch.setattr("src.flow_engine.mcp.call_mcp_tool", fake_call_mcp_tool)

    binding = _connector_binding({"type": "object", "properties": {}})
    binding["mcp_transport_type"] = "sse"
    binding["auth_headers"] = {"Authorization": "Bearer token"}
    binding["dynamic_headers"] = [
        {"header_name": "Workspace-Id", "source": "workspace"}
    ]
    tool = create_connector_tools(
        [binding],
        ConnectorToolContext(workspace_id="workspace-1", session_id="conversation-1"),
    )[-1]

    asyncio.run(tool.func(tool_context=SimpleNamespace(invocation_id="e-123")))

    assert captured["auth_headers"] == {
        "Authorization": "Bearer token",
        "x-conversation-id": "conversation-1",
        "x-execution-id": "e-123",
        "Workspace-Id": "workspace-1",
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


def test_code_interpreter_mounts_selected_workspace_without_selected_documents(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured = {}

    async def fake_call_mcp_tool(*args, **kwargs):
        captured["auth_headers"] = kwargs.get("auth_headers")
        return {"text": "ok"}

    monkeypatch.setattr("src.flow_engine.mcp.call_mcp_tool", fake_call_mcp_tool)
    tool = _first_connector_tool(
        {},
        workspace_id="selected-workspace",
        auth_headers={"X-User-Id": "user-1"},
        brain_documents=[
            {
                "filename": "private.txt",
                "workspace_id": "private-workspace",
                "workspace_name": "private-prefix",
                "filepath": "private-owner/private-prefix/private.txt",
            },
        ],
        connector_slug="code-interpreter",
        user_id="user-1",
    )

    asyncio.run(tool.func())

    assert "Workspace-Id" not in captured["auth_headers"]
    assert captured["auth_headers"]["x-workspace-paths"] == (
        "user-1/selected-workspace,private-owner/private-prefix"
    )


def test_code_interpreter_keeps_selected_root_when_workspace_aliases_collide(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured = {}

    async def fake_call_mcp_tool(*args, **kwargs):
        captured["auth_headers"] = kwargs.get("auth_headers")
        return {"text": "ok"}

    monkeypatch.setattr("src.flow_engine.mcp.call_mcp_tool", fake_call_mcp_tool)
    tool = _first_connector_tool(
        {},
        workspace_id="selected-workspace",
        auth_headers={"X-User-Id": "user-1"},
        brain_documents=[
            {
                "filename": "private.txt",
                "workspace_id": "private-workspace",
                "workspace_name": "shared-prefix",
                "filepath": "private-owner/shared-prefix/private.txt",
            },
            {
                "filename": "requested.txt",
                "workspace_id": "selected-workspace",
                "workspace_name": "shared-prefix",
                "filepath": "user-1/shared-prefix/requested.txt",
            },
        ],
        connector_slug="code-interpreter",
        user_id="user-1",
    )

    asyncio.run(tool.func())

    assert "Workspace-Id" not in captured["auth_headers"]
    assert captured["auth_headers"]["x-workspace-paths"] == "user-1/shared-prefix"


def test_read_section_tool_passes_images_through_with_runtime_tool_context(
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
    assert response["images"][0]["image_base64"] == "abc123"
    assert tool_context.state == {}


def test_connector_tool_buffers_mcp_image_parts_for_model(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_call_mcp_tool(*args, **kwargs):
        return {
            "text": "section text",
            "images": [
                {
                    "image_id": "img-1",
                    "image_content_index": 1,
                }
            ],
            "__mcp_content_parts": [
                {"type": "text", "text": "section text"},
                {
                    "type": "image",
                    "data": "YWJjMTIz",
                    "mimeType": "image/png",
                    "decodedByteSize": 6,
                },
            ],
        }

    monkeypatch.setattr(
        "src.flow_engine.mcp.call_mcp_tool",
        fake_call_mcp_tool,
    )

    tool = _first_connector_tool({}, action_key="read_content")
    tool_context = SimpleNamespace(state={})

    response = asyncio.run(tool.func(query="recipe", tool_context=tool_context))

    assert "__mcp_content_parts" not in response
    assert response["images"][0]["image_content_index"] == 1
    image_keys = [
        key for key in tool_context.state if key.startswith("_pending_tool_images_")
    ]
    assert len(image_keys) == 1
    response_id = image_keys[0].replace("_pending_tool_images_", "")
    assert tool_context.state[image_keys[0]] == [
        {"mime": "image/png", "data": "YWJjMTIz"}
    ]
    assert tool_context.state[f"_list_of_filenames_{response_id}"] == [
        "image_id=img-1, image_content_index=1"
    ]
