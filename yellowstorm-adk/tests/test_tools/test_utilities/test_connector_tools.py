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


@pytest.fixture(autouse=True)
def current_conversation_has_no_deletions(monkeypatch):
    # Transport and guard unit cases start with an authorized, unchanged scope.
    # Dedicated revocation cases below override this; HTTP validation has its own tests.
    async def current(*args):
        return {"epoch": None, "cleanupPending": False}
    monkeypatch.setattr("src.smart_rag.tools.utilities.conversation_assets.get_asset_revocation", current)


@pytest.fixture(autouse=True)
def private_native_dispatch(monkeypatch):
    from src.root_runtime import delegate_resolver
    monkeypatch.setattr(delegate_resolver, "get_settings", lambda: SimpleNamespace(ADK_ROOT_RUNTIME_SERVICE_TOKEN="root-test-machine"))
    binding = delegate_resolver._root_authority.set(delegate_resolver._RootAuthority("tool-execution", "private-tool-proof"))
    try:
        yield
    finally:
        delegate_resolver._root_authority.reset(binding)


@pytest.mark.asyncio
@pytest.mark.parametrize("bound", [True, False])
async def test_workspace_save_uses_private_dispatch_without_a_legacy_token(monkeypatch, bound):
    import httpx
    from src.root_runtime import delegate_resolver
    from src.smart_rag.tools.utilities.connector_tools import create_save_file_to_workspace
    calls = []
    async def post(self, url, **kwargs):
        calls.append((url, kwargs))
        assert kwargs["headers"]["X-YellowStorm-Execution-Authority"] == "private-tool-proof"
        assert "X-Internal-Token" not in kwargs["headers"]
        assert kwargs["json"]["userId"] == "owner"
        return httpx.Response(200, json={"document": {"id": "doc", "originalName": "file.txt", "size": 1}},
            request=httpx.Request("POST", url))
    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    tool = create_save_file_to_workspace({"platform_api_url": "http://backend/api/v1", "user_id": "owner"})
    assert tool is not None
    binding = delegate_resolver._root_authority.set(None) if not bound else None
    try:
        result = await tool("https://files.example.test/file", "workspace", "file.txt")
    finally:
        if binding is not None:
            delegate_resolver._root_authority.reset(binding)
    assert ("successfully" in result) is bound
    assert len(calls) == int(bound)


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
    bindings = [
        _connector_binding(
            parameter_schema,
            auth_headers,
            fixed_params,
            action_key,
            connector_slug,
            dynamic_headers,
            parameter_schema_json,
        )]
    if connector_slug in {"code-interpreter", "code-interpreort-aga", "code-interpretor-aga"} and action_key != "sandbox_destroy":
        bindings[0]["actions"] += [{"action_key": action, "parameter_schema": {"type": "object", "properties": {}}} for action in ["sandbox_create", "sandbox_destroy"] if action != action_key]
    tools = create_connector_tools(bindings,
        ConnectorToolContext(
            workspace_id=workspace_id,
            workspace_names=workspace_names,
            brain_documents=brain_documents,
            session_id=session_id,
            user_id=user_id,
        ),
    )
    selected = next(tool for tool in tools if tool.name == build_connector_tool_name(connector_slug, action_key))
    if connector_slug in {"code-interpreter", "code-interpreort-aga", "code-interpretor-aga"} and action_key not in {"sandbox_create", "sandbox_destroy"}:
        original = selected.func
        create = next(tool for tool in tools if tool.name.endswith("_sandbox_create"))
        async def with_sandbox(**kwargs):
            await create.func(tool_context=kwargs.get("tool_context"))
            return await original(**kwargs)
        selected.func = with_sandbox
    return selected


@pytest.mark.asyncio
@pytest.mark.parametrize("stays_missing", [False, True])
async def test_current_image_mounts_validate_exact_paths_and_recreate_stale_sandbox_once(monkeypatch, stays_missing):
    from src.smart_rag.tools.utilities.generate_image import IMAGE_SANDBOX_INPUTS_STATE_KEY
    path = f"/mnt/workspace/generated-images/{'a' * 24}.png"
    calls = []
    checks = 0

    async def call(*args, **kwargs):
        nonlocal checks
        action, params = args[3:5]
        calls.append((action, params))
        assert kwargs["auth_headers"]["x-file-paths"] == f"user-1/system_c1/generated-images/{'a' * 24}.png"
        if action == "file_list":
            assert params == {"path": path}
            checks += 1
            return {"text": "No such file or directory" if stays_missing or checks == 1 else "image.png 1234 bytes"}
        return {"text": "Sandbox destroyed." if args[3] == "sandbox_destroy" else "ok"}

    monkeypatch.setattr("src.mcp.call_mcp_tool", call)
    binding = _connector_binding({}, auth_headers={"X-User-Id": "user-1"}, connector_slug="code-interpreter")
    binding["actions"] = [{"action_key": action, "parameter_schema": {"type": "object", "properties": {}}}
        for action in ["sandbox_create", "sandbox_destroy", "file_list", "shell_exec"]]
    tools = {tool.name: tool for tool in create_connector_tools([binding], ConnectorToolContext(session_id="c1"))}
    context = SimpleNamespace(invocation_id="current", state={IMAGE_SANDBOX_INPUTS_STATE_KEY:
        {"invocation": "current", "paths": [path, "/mnt/workspace/../untrusted"]}})
    result = await tools["code-interpreter_sandbox_create"].func(tool_context=context)
    assert [action for action, _ in calls] == ["sandbox_destroy", "sandbox_create", "file_list", "sandbox_destroy", "sandbox_create", "file_list"]
    assert ("error" in result) is stays_missing
    before = len(calls)
    result = await tools["code-interpreter_shell_exec"].func(tool_context=context)
    assert ("error" in result) is stays_missing
    assert len(calls) == before + (0 if stays_missing else 1)
    before = len(calls)
    repeated = await tools["code-interpreter_sandbox_create"].func(tool_context=context)
    assert "error" in repeated
    assert len(calls) == before  # Never recreate again in the same invocation.


@pytest.mark.asyncio
async def test_new_image_receipt_refreshes_exact_mount_headers_after_binding_created(monkeypatch):
    from src.smart_rag.tools.utilities.generate_image import IMAGE_SANDBOX_INPUTS_STATE_KEY
    captured = []

    async def call(*args, **kwargs):
        captured.append(dict(kwargs["auth_headers"]))
        return {"text": "Sandbox destroyed." if args[3] == "sandbox_destroy" else "ok"}

    monkeypatch.setattr("src.mcp.call_mcp_tool", call)
    binding = _connector_binding({}, auth_headers={"X-user-id": "owner", "Authorization": "kept"}, connector_slug="code-interpreter")
    binding["actions"] = [{"action_key": action, "parameter_schema": {"type": "object", "properties": {}}}
        for action in ["sandbox_create", "sandbox_destroy", "file_list"]]
    tools = {tool.name: tool for tool in create_connector_tools([binding], ConnectorToolContext(
        session_id="conversation", user_id="owner", brain_documents=[{"filepath": "owner/source/input.pdf"}]))}
    # A generated/imported image arrives after connector construction, as it does live.
    path = f"/mnt/workspace/generated-images/{'a' * 24}.png"
    context = SimpleNamespace(invocation_id="turn", state={IMAGE_SANDBOX_INPUTS_STATE_KEY:
        {"invocation": "turn", "paths": [path]}})
    await tools["code-interpreter_sandbox_create"].func(tool_context=context)
    assert len(captured) == 3  # create and its exact private validation probe
    for headers in captured:
        assert headers["x-file-paths"] == f"owner/source/input.pdf,owner/system_conversation/generated-images/{'a' * 24}.png"
        assert headers["x-workspace-paths"].endswith("owner/system_conversation")
        assert headers["Authorization"] == "kept"


@pytest.mark.asyncio
async def test_image_shell_waits_until_mount_validation_finishes(monkeypatch):
    from src.smart_rag.tools.utilities.generate_image import IMAGE_SANDBOX_INPUTS_STATE_KEY
    creating, release = asyncio.Event(), asyncio.Event()
    calls = []

    async def call(*args, **kwargs):
        action = args[3]
        calls.append(action)
        if action == "sandbox_create":
            creating.set()
            await release.wait()
        return {"text": "Sandbox destroyed." if args[3] == "sandbox_destroy" else "ok"}

    monkeypatch.setattr("src.mcp.call_mcp_tool", call)
    binding = _connector_binding({}, connector_slug="code-interpreter")
    binding["actions"] = [{"action_key": action, "parameter_schema": {"type": "object", "properties": {}}}
        for action in ["sandbox_create", "sandbox_destroy", "file_list", "shell_exec"]]
    tools = {tool.name: tool for tool in create_connector_tools([binding])}
    context = SimpleNamespace(invocation_id="current", state={IMAGE_SANDBOX_INPUTS_STATE_KEY:
        {"invocation": "current", "paths": [f"/mnt/workspace/generated-images/{'a' * 24}.png"]}})
    create = asyncio.create_task(tools["code-interpreter_sandbox_create"].func(tool_context=context))
    await creating.wait()
    shell = asyncio.create_task(tools["code-interpreter_shell_exec"].func(tool_context=context))
    await asyncio.sleep(0)
    assert not shell.done()
    assert calls == ["sandbox_destroy", "sandbox_create"]
    release.set()
    await asyncio.gather(create, shell)
    assert calls == ["sandbox_destroy", "sandbox_create", "file_list", "shell_exec"]


@pytest.mark.asyncio
async def test_image_mount_recovery_never_uses_prior_turn_receipts(monkeypatch):
    from src.smart_rag.tools.utilities.generate_image import IMAGE_SANDBOX_INPUTS_STATE_KEY
    calls = []

    async def call(*args, **kwargs):
        calls.append(args[3])
        return {"text": "Sandbox destroyed." if args[3] == "sandbox_destroy" else "ok"}

    monkeypatch.setattr("src.mcp.call_mcp_tool", call)
    tool = _first_connector_tool({}, action_key="sandbox_create", connector_slug="code-interpreter")
    context = SimpleNamespace(invocation_id="new", state={IMAGE_SANDBOX_INPUTS_STATE_KEY:
        {"invocation": "old", "paths": [f"/mnt/workspace/generated-images/{'a' * 24}.png"]}})
    await tool.func(tool_context=context)
    assert calls == ["sandbox_destroy", "sandbox_create"]


def test_connector_tool_injects_bound_workspace_name(monkeypatch: pytest.MonkeyPatch) -> None:
    captured = {}

    async def fake_call_mcp_tool(*args, **kwargs):
        captured["params"] = args[4]
        return {"text": "Sandbox destroyed." if args[3] == "sandbox_destroy" else "ok"}

    monkeypatch.setattr(
        "src.mcp.call_mcp_tool",
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


@pytest.mark.asyncio
@pytest.mark.parametrize("override", ["model", "approval", "hidden"])
async def test_trusted_connector_scope_cannot_be_overridden(monkeypatch, override):
    calls = []

    async def remote(*args, **kwargs):
        calls.append(args[4])
        return {"text": "Sandbox destroyed." if args[3] == "sandbox_destroy" else "ok"}

    monkeypatch.setattr("src.mcp.call_mcp_tool", remote)
    binding = _connector_binding({"type": "object", "properties": {"repo_id": {"type": "string"}}})
    binding["enforced_params"] = {"repo_id": "allowed"}
    tool = create_connector_tools([binding], ConnectorToolContext())[-1]
    context = SimpleNamespace(tool_confirmation=SimpleNamespace(payload={"repo_id": "other"}))
    if override == "hidden":
        result = await tool.run_async(args={"_enforced_params": {}}, tool_context=context)
    else:
        result = await tool.func(tool_context=context if override == "approval" else None,
                                 repo_id="other" if override == "model" else "allowed")
    assert "error" in result
    assert calls == []
    await tool.func(repo_id="allowed")
    assert calls == [{"repo_id": "allowed"}]


def test_connector_tool_declares_display_purpose_but_does_not_forward_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured = {}

    async def fake_call_mcp_tool(*args, **kwargs):
        captured["params"] = args[4]
        return {"text": "Sandbox destroyed." if args[3] == "sandbox_destroy" else "ok"}

    monkeypatch.setattr("src.mcp.call_mcp_tool", fake_call_mcp_tool)
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
        return {"text": "Sandbox destroyed." if args[3] == "sandbox_destroy" else "ok"}

    monkeypatch.setattr("src.mcp.call_mcp_tool", fake_call_mcp_tool)
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
        return {"text": "Sandbox destroyed." if args[3] == "sandbox_destroy" else "ok"}

    monkeypatch.setattr(
        "src.mcp.call_mcp_tool",
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
        return {"text": "Sandbox destroyed." if args[3] == "sandbox_destroy" else "ok"}

    monkeypatch.setattr(
        "src.mcp.call_mcp_tool",
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
        return {"text": "Sandbox destroyed." if args[3] == "sandbox_destroy" else "ok"}

    monkeypatch.setattr("src.mcp.call_mcp_tool", fake_call_mcp_tool)

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
        return {"text": "Sandbox destroyed." if args[3] == "sandbox_destroy" else "ok"}

    monkeypatch.setattr(
        "src.mcp.call_mcp_tool",
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
        return {"text": "Sandbox destroyed." if args[3] == "sandbox_destroy" else "ok"}

    monkeypatch.setattr(
        "src.mcp.call_mcp_tool",
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
        return {"text": "Sandbox destroyed." if args[3] == "sandbox_destroy" else "ok"}

    monkeypatch.setattr(
        "src.mcp.call_mcp_tool",
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
        return {"text": "Sandbox destroyed." if args[3] == "sandbox_destroy" else "ok"}

    monkeypatch.setattr(
        "src.mcp.call_mcp_tool",
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
        return {"text": "Sandbox destroyed." if args[3] == "sandbox_destroy" else "ok"}

    monkeypatch.setattr(
        "src.mcp.call_mcp_tool",
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
        return {"text": "Sandbox destroyed." if args[3] == "sandbox_destroy" else "ok"}

    monkeypatch.setattr(
        "src.mcp.call_mcp_tool",
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
        return {"text": "Sandbox destroyed." if args[3] == "sandbox_destroy" else "ok"}

    monkeypatch.setattr(
        "src.mcp.call_mcp_tool",
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
    # Empty schemas must not gain undeclared workspace parameters; the scope
    # travels in the headers below for this strict MCP action.
    assert captured["params"] == {"query": "revenue"}
    assert captured["auth_headers"] == {
        "Authorization": "Bearer token",
        "X-User-Id": "user-1",
        "workspace_id": '["workspace-1", "workspace-2", "workspace-alpha"]',
        "x-conversation-id": "conversation-1",
        # The run's own Ceph folder rides last, so the sandbox mounts somewhere a
        # connector can drop a file mid-run and the code interpreter can read it.
        "x-workspace-paths": "user-1/workspace-alpha,user-1/workspace-beta,user-1/system_conversation-1",
        # Exact document object keys, so the sandbox can mount the real files
        # (essential for CODE_ONLY attachments excluded from search indexing).
        "x-file-paths": "user-1/workspace-alpha/Search Explanation.docx,user-1/workspace-beta/private-notes.txt",
    }


def test_connector_tool_percent_encodes_unsafe_file_paths(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured = {}

    async def fake_call_mcp_tool(*args, **kwargs):
        captured["auth_headers"] = kwargs.get("auth_headers")
        return {"text": "Sandbox destroyed." if args[3] == "sandbox_destroy" else "ok"}

    monkeypatch.setattr("src.mcp.call_mcp_tool", fake_call_mcp_tool)

    tool = _first_connector_tool(
        {},
        workspace_id="workspace-1",
        workspace_names=["workspace-alpha"],
        auth_headers={"Authorization": "Bearer token", "X-User-Id": "user-1"},
        brain_documents=[
            {
                "file_name": "report—final.csv",
                "workspace_id": "workspace-1",
                "workspace_name": "workspace-alpha",
                "filepath": "user-1/conv-1/report—final.csv",
            },
            {
                "file_name": "a,b.csv",
                "workspace_id": "workspace-1",
                "workspace_name": "workspace-alpha",
                "filepath": "user-1/conv-1/a,b.csv",
            },
        ],
        session_id="conversation-1",
        connector_slug="code-interpreter",
        user_id="user-1",
    )

    asyncio.run(tool.func(query="revenue"))

    header = captured["auth_headers"]["x-file-paths"]
    entries = header.split(",")
    # Both keys survive the comma-delimited list and the latin-1 header encode.
    assert len(entries) == 2
    for entry in entries:
        entry.encode("latin-1")


def test_logical_search_connector_sends_only_authorization_and_workspace_scope(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured = {}

    async def fake_call_mcp_tool(*args, **kwargs):
        captured["params"] = args[4]
        captured["server_config"] = args[2]
        captured["auth_headers"] = kwargs.get("auth_headers")
        return {"text": "Sandbox destroyed." if args[3] == "sandbox_destroy" else "ok"}

    monkeypatch.setattr("src.mcp.call_mcp_tool", fake_call_mcp_tool)
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
            "x-yellowstorm-mcp-assertion": "trusted-scope-proof",
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
            "X-YellowStorm-Mcp-Assertion": "editable-must-not-pass",
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
        "X-YellowStorm-Mcp-Assertion": "trusted-scope-proof",
    }
    from src.mcp import _build_headers

    assert _build_headers(
        captured.get("server_config"), captured["auth_headers"]
    ) == {
        "Authorization": "Bearer gateway-token",
        "Workspace-Id": "workspace-alice,workspace-bob",
        "X-YellowStorm-Mcp-Assertion": "trusted-scope-proof",
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
        return {"text": "Sandbox destroyed." if args[3] == "sandbox_destroy" else "ok"}

    monkeypatch.setattr("src.mcp.call_mcp_tool", fake_call_mcp_tool)

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
        return {"text": "Sandbox destroyed." if args[3] == "sandbox_destroy" else "ok"}

    monkeypatch.setattr(
        "src.mcp.call_mcp_tool",
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
        return {"text": "Sandbox destroyed." if args[3] == "sandbox_destroy" else "ok"}

    monkeypatch.setattr("src.mcp.call_mcp_tool", fake_call_mcp_tool)
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
        return {"text": "Sandbox destroyed." if args[3] == "sandbox_destroy" else "ok"}

    monkeypatch.setattr("src.mcp.call_mcp_tool", fake_call_mcp_tool)
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
        "src.mcp.call_mcp_tool",
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
        "src.mcp.call_mcp_tool",
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


@pytest.mark.asyncio
@pytest.mark.parametrize("slug", ["code-interpreter", "code-interpreort-aga", "code-interpretor-aga"])
async def test_general_asset_receipts_mount_through_existing_connector_alias(monkeypatch, slug):
    from src.smart_rag.tools.utilities.generate_image import IMAGE_SANDBOX_INPUTS_STATE_KEY
    path=f"/mnt/workspace/conversation-assets/{'b'*64}.pdf"
    calls=[]
    async def call(*args,**kwargs):
        calls.append((args[3],kwargs["auth_headers"]))
        return {"text":"Sandbox destroyed." if args[3] == "sandbox_destroy" else "ok"}
    monkeypatch.setattr("src.mcp.call_mcp_tool",call)
    binding=_connector_binding({},auth_headers={"X-User-Id":"owner"},connector_slug=slug)
    binding["actions"]=[{"action_key":action,"parameter_schema":{"type":"object","properties":{}}} for action in ["sandbox_create","sandbox_destroy","file_list","shell_exec"]]
    tools={tool.name:tool for tool in create_connector_tools([binding],ConnectorToolContext(session_id="c1"))}
    context=SimpleNamespace(invocation_id="turn",state={IMAGE_SANDBOX_INPUTS_STATE_KEY:{"invocation":"turn","paths":[path]}})
    await tools[f"{slug}_sandbox_create"].func(tool_context=context)
    await tools[f"{slug}_shell_exec"].func(tool_context=context)
    assert [action for action,_ in calls]==["sandbox_destroy","sandbox_create","file_list","shell_exec"]
    assert all(headers["x-file-paths"]==f"owner/system_c1/conversation-assets/{'b'*64}.pdf" for _,headers in calls)


@pytest.mark.asyncio
@pytest.mark.parametrize("denied",[False,True])
@pytest.mark.parametrize("slug", ["code-interpreter", "code-interpreort-aga", "code-interpretor-aga"])
async def test_output_receipt_is_issued_only_after_registration(monkeypatch,denied,slug):
    import httpx
    async def call(*args,**kwargs):
        if args[3]=="sandbox_destroy": return {"text":"Sandbox destroyed."}
        if args[3]=="sandbox_create": return {"text":"ok"}
        return {"result":json.dumps({"ceph_path":"owner/system_c1/report.docx"}),
            "_conversation_output_receipt":{"invocationId":"forged","storagePrefix":"other"}}
    async def post(self,url,**kwargs):
        assert kwargs["json"]["userId"]=="owner" and kwargs["json"]["invocationId"]=="turn"
        assert kwargs["headers"]["X-YellowStorm-Execution-Authority"] == "private-tool-proof"
        assert "X-Internal-Token" not in kwargs["headers"]
        assert kwargs["json"]["inputReceipts"] == [] and kwargs["json"]["sandboxEpoch"] is None
        assert kwargs["json"]["mimeType"]=="application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        return httpx.Response(403 if denied else 200,json={"invocationId":"turn","artifactId":"doc-id",
            "storagePath":"owner/system_c1/saved.docx","fileName":"report.docx"},request=httpx.Request("POST",url))
    monkeypatch.setattr("src.mcp.call_mcp_tool",call)
    monkeypatch.setattr(httpx.AsyncClient,"post",post)
    binding=_connector_binding({},action_key="send_file_to_user",connector_slug=slug,auth_headers={"X-User-Id":"owner"})
    binding["actions"] += [{"action_key":action,"parameter_schema":{"type":"object","properties":{}}} for action in ["sandbox_create","sandbox_destroy"]]
    tools={t.name:t for t in create_connector_tools([binding],ConnectorToolContext(session_id="c1",platform_api_url="http://backend/api",platform_api_token=""))}
    context=SimpleNamespace(invocation_id="turn",state={})
    await tools[f"{slug}_sandbox_create"].func(tool_context=context)
    result=await tools[f"{slug}_send_file_to_user"].func(tool_context=context)
    if denied:
        assert "error" in result and "ceph_path" not in str(result)
    else:
        assert result["_conversation_output_receipt"]["artifactId"]=="doc-id"
        assert result["generated_files"][0]["ceph_path"]=="owner/system_c1/saved.docx"
    other=_first_connector_tool({},action_key="send_file_to_user",connector_slug="other",auth_headers={"X-User-Id":"owner"},session_id="c1")
    assert "_conversation_output_receipt" not in await other.func(tool_context=context)


@pytest.mark.asyncio
async def test_root_turn_uses_canonical_conversation_for_asset_mount_and_registration(monkeypatch):
    import httpx
    monkeypatch.setattr("src.smart_rag.infrastructure.external.mcp_toolset_cache.current_conversation_id",lambda:"canonical-conversation")
    from src.smart_rag.tools.utilities.generate_image import IMAGE_SANDBOX_INPUTS_STATE_KEY
    path=f"/mnt/workspace/conversation-assets/{'a'*64}.pdf"
    calls=[]
    async def call(*args,**kwargs):
        headers=kwargs["auth_headers"]
        calls.append(args[3])
        assert headers["x-conversation-id"]=="canonical-conversation"
        assert headers["x-execution-id"]=="invocation"
        assert headers["x-file-paths"]==f"owner/system_canonical-conversation/conversation-assets/{'a'*64}.pdf"
        if args[3]=="send_file_to_user":
            return {"result":json.dumps({"ceph_path":"owner/system_canonical-conversation/report.docx"})}
        return {"text":"Sandbox destroyed." if args[3] == "sandbox_destroy" else "ok"}
    async def post(self,url,**kwargs):
        assert kwargs["json"]["conversationId"]=="canonical-conversation"
        if url.endswith("/assets/inspect"):
            return httpx.Response(200,json={"status":"ready"},request=httpx.Request("POST",url))
        assert kwargs["json"]["inputReceipts"] == [{"ref":"selected-ref","sha256":"b"*64}]
        return httpx.Response(200,json={"invocationId":"invocation","artifactId":"doc-id","storagePath":"owner/system-canonical-conversation/report.docx"},request=httpx.Request("POST",url))
    monkeypatch.setattr("src.mcp.call_mcp_tool",call)
    monkeypatch.setattr(httpx.AsyncClient,"post",post)
    binding=_connector_binding({},auth_headers={"X-User-Id":"owner"},connector_slug="code-interpreter")
    binding["actions"]=[{"action_key":action,"parameter_schema":{"type":"object","properties":{}}} for action in ["sandbox_create","sandbox_destroy","file_list","send_file_to_user"]]
    tools={t.name:t for t in create_connector_tools([binding],ConnectorToolContext(session_id="turn_ephemeral",user_id="owner",platform_api_url="http://backend/api",platform_api_token="test"))}
    context=SimpleNamespace(invocation_id="invocation",state={IMAGE_SANDBOX_INPUTS_STATE_KEY:{"invocation":"invocation","paths":[path],"assets":{path:{"ref":"selected-ref","sha256":"b"*64}}}})
    await tools["code-interpreter_sandbox_create"].func(tool_context=context)
    result=await tools["code-interpreter_send_file_to_user"].func(tool_context=context)
    assert result["_conversation_output_receipt"]["storagePrefix"]=="owner/system_canonical-conversation"
    assert calls==["sandbox_destroy","sandbox_create","file_list","send_file_to_user"]


@pytest.mark.asyncio
async def test_deleted_input_blocks_sandbox_actions_and_discards_active_sandbox(monkeypatch):
    import httpx
    from src.smart_rag.tools.utilities.generate_image import IMAGE_SANDBOX_INPUTS_STATE_KEY
    path=f"/mnt/workspace/conversation-assets/{'a'*64}.pdf"
    available=True
    calls=[]
    async def post(self,url,**kwargs):
        assert url.endswith("/assets/inspect")
        return httpx.Response(200 if available else 404,json={"status":"ready"},request=httpx.Request("POST",url))
    async def call(*args,**kwargs):
        calls.append((args[3],args[4]))
        return {"text":"Sandbox destroyed." if args[3] == "sandbox_destroy" else "ok"}
    monkeypatch.setattr(httpx.AsyncClient,"post",post)
    monkeypatch.setattr("src.mcp.call_mcp_tool",call)
    binding=_connector_binding({},auth_headers={"X-User-Id":"owner"},connector_slug="code-interpreter")
    binding["actions"]=[{"action_key":action,"parameter_schema":{"type":"object","properties":{}}} for action in ["sandbox_create","sandbox_destroy","file_list","shell_exec","send_file_to_user"]]
    tools={t.name:t for t in create_connector_tools([binding],ConnectorToolContext(session_id="c1",user_id="owner",platform_api_url="http://backend/api",platform_api_token="test"))}
    context=SimpleNamespace(invocation_id="turn",state={IMAGE_SANDBOX_INPUTS_STATE_KEY:{"invocation":"turn","paths":[path],"assets":{path:{"ref":"selected-ref","sha256":"b"*64}}}})
    await tools["code-interpreter_sandbox_create"].func(tool_context=context)
    available=False
    result=await tools["code-interpreter_shell_exec"].func(tool_context=context)
    assert "unavailable" in result["error"]
    assert [action for action,_ in calls]==["sandbox_destroy","sandbox_create","file_list","sandbox_destroy"]
    assert calls[-1][1]=={"failed":True}
    assert "error" in await tools["code-interpreter_send_file_to_user"].func(tool_context=context)
    assert [action for action,_ in calls]==["sandbox_destroy","sandbox_create","file_list","sandbox_destroy"]


@pytest.mark.asyncio
@pytest.mark.parametrize("pending,destroy_ok", [(False,True),(True,True),(False,False)])
async def test_revocation_blocks_old_sandbox_even_without_selected_input_receipts(monkeypatch,pending,destroy_ok):
    epoch=None
    calls=[]
    async def revocation(*args):
        return {"epoch":epoch,"cleanupPending":pending if epoch else False}
    async def call(*args,**kwargs):
        calls.append(args[3])
        if args[3]=="sandbox_destroy":
            return {"result":"Sandbox destroyed."} if destroy_ok or epoch is None else {"error":"unavailable"}
        return {"text":"Sandbox destroyed." if args[3] == "sandbox_destroy" else "ok"}
    monkeypatch.setattr("src.smart_rag.tools.utilities.conversation_assets.get_asset_revocation",revocation)
    monkeypatch.setattr("src.mcp.call_mcp_tool",call)
    binding=_connector_binding({},connector_slug="code-interpreter")
    binding["actions"]=[{"action_key":action,"parameter_schema":{"type":"object","properties":{}}} for action in ["sandbox_create","sandbox_destroy","shell_exec"]]
    tools={t.name:t for t in create_connector_tools([binding],ConnectorToolContext(session_id="c1"))}
    context=SimpleNamespace(invocation_id="turn",state={})
    await tools["code-interpreter_sandbox_create"].func(tool_context=context)
    epoch="after-delete"
    assert "error" in await tools["code-interpreter_shell_exec"].func(tool_context=context)
    assert calls==["sandbox_destroy","sandbox_create","sandbox_destroy"]
    result=await tools["code-interpreter_sandbox_create"].func(tool_context=context)
    if pending or not destroy_ok:
        assert "error" in result
        assert calls==["sandbox_destroy","sandbox_create","sandbox_destroy","sandbox_destroy"]
    else:
        await tools["code-interpreter_shell_exec"].func(tool_context=context)
        assert calls==["sandbox_destroy","sandbox_create","sandbox_destroy","sandbox_destroy","sandbox_create","shell_exec"]


@pytest.mark.asyncio
@pytest.mark.parametrize("verification_failed", [False,True])
async def test_explicit_destroy_cannot_archive_drafts_after_deletion_or_unverified_scope(monkeypatch,verification_failed):
    from src.flow_engine.tools.sandbox_mount_guard import SandboxMountValidationError
    async def current(*args):
        if verification_failed:
            raise SandboxMountValidationError("unavailable")
        return {"epoch":"deleted-at","cleanupPending":False}
    calls=[]
    async def call(*args,**kwargs):
        calls.append((args[3],args[4]))
        return {"text":"Sandbox destroyed."}
    monkeypatch.setattr("src.smart_rag.tools.utilities.conversation_assets.get_asset_revocation",current)
    monkeypatch.setattr("src.mcp.call_mcp_tool",call)
    binding=_connector_binding({},action_key="sandbox_destroy",connector_slug="code-interpreter")
    binding["actions"][0]["parameter_schema"]={"type":"object","properties":{"failed":{"type":"boolean"}}}
    tool=create_connector_tools([binding],ConnectorToolContext(session_id="c1"))[0]
    await tool.func(failed=False,tool_context=SimpleNamespace(invocation_id="turn",state={}))
    assert calls==[("sandbox_destroy",{"failed":True})]


@pytest.mark.asyncio
async def test_prior_linked_receipt_is_revalidated_with_empty_new_selection(monkeypatch):
    from src.flow_engine.tools.sandbox_mount_guard import SandboxMountValidationError
    from src.smart_rag.tools.utilities.generate_image import IMAGE_SANDBOX_INPUTS_STATE_KEY
    revoked=False
    validated=[]
    async def validate(context,conversation,receipts):
        validated.append(list(receipts))
        if revoked: raise SandboxMountValidationError("revoked linked source")
    calls=[]
    async def call(*args,**kwargs):
        calls.append(args[3])
        if revoked and args[3]=="sandbox_destroy": assert args[4]["failed"] is True
        return {"text":"Sandbox destroyed." if args[3]=="sandbox_destroy" else "ok"}
    monkeypatch.setattr("src.smart_rag.tools.utilities.conversation_assets.validate_prepared_assets",validate)
    monkeypatch.setattr("src.mcp.call_mcp_tool",call)
    binding=_connector_binding({},connector_slug="code-interpreter",auth_headers={"X-User-Id":"owner"})
    binding["actions"]=[{"action_key":action,"parameter_schema":{"type":"object","properties":{}}} for action in ["sandbox_create","sandbox_destroy","file_list","shell_exec","send_file_to_user"]]
    tools={t.name:t for t in create_connector_tools([binding],ConnectorToolContext(session_id="c1"))}
    path=f"/mnt/workspace/conversation-assets/{'a'*64}.pdf"
    context=SimpleNamespace(invocation_id="first",state={IMAGE_SANDBOX_INPUTS_STATE_KEY:{"invocation":"first","paths":[path],"assets":{path:{"ref":"linked-ref","sha256":"b"*64,"path":path}}}})
    await tools["code-interpreter_sandbox_create"].func(tool_context=context)
    assert calls==["sandbox_destroy","sandbox_create","file_list"]
    context.invocation_id="second"
    context.state={}
    revoked=True
    assert "unavailable" in (await tools["code-interpreter_shell_exec"].func(tool_context=context))["error"]
    assert "unavailable" in (await tools["code-interpreter_send_file_to_user"].func(tool_context=context))["error"]
    assert validated==[[path],[path],[path]]
    assert "shell_exec" not in calls and "send_file_to_user" not in calls
    await tools["code-interpreter_sandbox_destroy"].func(tool_context=context)
    assert validated[-1]==[path]


@pytest.mark.asyncio
async def test_unknown_wrapper_destroy_never_archives_prior_unverified_inputs(monkeypatch):
    calls=[]
    async def call(*args,**kwargs):
        calls.append((args[3],args[4]))
        return {"text":"Sandbox destroyed."}
    monkeypatch.setattr("src.mcp.call_mcp_tool",call)
    binding=_connector_binding({"type":"object","properties":{"failed":{"type":"boolean"}}},action_key="sandbox_destroy",connector_slug="code-interpreter")
    tool=create_connector_tools([binding],ConnectorToolContext(session_id="c1"))[0]
    await tool.func(failed=False,tool_context=SimpleNamespace(invocation_id="new",state={}))
    assert calls==[("sandbox_destroy",{"failed":True})]
