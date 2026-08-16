import pytest
from fastmcp import Client

import server
from auth import PlatformActorContext, actor_context
from server import mcp


def result_dict(response):
    if response.structured_content is not None:
        return response.structured_content
    data = response.data
    while hasattr(data, "root"):
        data = data.root
    if hasattr(data, "model_dump"):
        return data.model_dump()
    return data


@pytest.mark.asyncio
async def test_registers_approved_tools_without_runtime_hitl_controls():
    async with Client(mcp) as client:
        tools = await client.list_tools()
    names = {tool.name for tool in tools}
    assert names == {
        "search_playbooks",
        "open_playbook_context",
        "get_playbook_summary",
        "get_task_details",
        "get_task_dependencies",
        "validate_playbook",
        "assess_playbook_request",
        "continue_playbook_clarification",
        "start_playbook_construction",
        "start_playbook_generation",
        "get_playbook_construction",
        "cancel_playbook_construction",
        "analyze_task_optimization",
        "start_advisor_remediation_construction",
        "analyze_workflow_optimization",
        "start_workflow_optimization",
        "create_playbook",
        "clone_playbook",
        "revert_playbook_construction",
        "start_playbook_execution",
        "list_playbook_executions",
        "list_recent_executions",
        "get_playbook_execution",
        "get_execution_diagnostics",
        "cancel_playbook_execution",
        "trace_replay_playbook_execution",
        "reexecute_playbook_execution",
        "run_playbook_from_step",
        "delete_playbook_execution",
    }
    assert not names.intersection({
        "apply_playbook_patch",
        "reply_to_hitl",
        "approve_interrupt",
        "reject_interrupt",
        "resume_hitl",
    })
    for tool in tools:
        assert tool.outputSchema["properties"]["schemaVersion"]["const"] == "playbook.mcp.v1"


@pytest.mark.asyncio
async def test_tool_enums_are_google_adk_compatible_strings():
    async with Client(mcp) as client:
        tools = await client.list_tools()

    def enums(value):
        if isinstance(value, dict):
            if "enum" in value:
                yield value["enum"]
            for nested in value.values():
                yield from enums(nested)
        elif isinstance(value, list):
            for nested in value:
                yield from enums(nested)

    for tool in tools:
        for enum_values in enums(tool.inputSchema):
            assert all(isinstance(value, str) for value in enum_values), tool.name


@pytest.mark.asyncio
async def test_create_playbook_allows_omitting_workspace_ids(monkeypatch):
    class BackendStub:
        async def post(self, path, user_id, payload):
            assert path == "/api/v1/internal/playbook-assistant/playbooks"
            assert user_id == "user-1"
            assert payload == {
                "name": "Workspace-free draft",
                "description": None,
                "workspaces": [],
            }
            return {"id": "playbook-1", "workspaces": []}

    monkeypatch.setattr(server, "backend", lambda: BackendStub())
    token = actor_context.set(PlatformActorContext("tenant-1", "user-1", "agent-1", "conversation-1", "correlation-1"))
    try:
        async with Client(mcp) as client:
            response = await client.call_tool("create_playbook", {
                "name": "Workspace-free draft",
            })
    finally:
        actor_context.reset(token)

    result = result_dict(response)
    assert result["data"]["id"] == "playbook-1"
    assert result["data"]["workspaces"] == []


@pytest.mark.asyncio
async def test_advisor_construction_returns_canvas_owned_preview_handoff(monkeypatch):
    class BackendStub:
        async def post(self, path, user_id, payload):
            assert path.endswith("/advisor-remediation-constructions")
            assert user_id == "user-1"
            assert payload["mode"] == "optimize-step"
            return {"operationId": "operation/1"}

    monkeypatch.setattr(server, "backend", lambda: BackendStub())
    token = actor_context.set(PlatformActorContext("tenant-1", "user-1", "agent-1", "conversation-1", "correlation-1"))
    try:
        async with Client(mcp) as client:
            response = await client.call_tool("start_advisor_remediation_construction", {
                "playbook_id": "playbook/1",
                "execution_id": "execution-1",
                "mode": "optimize-step",
                "items": [{"taskId": "task-1", "recommendation": "Clarify the prompt"}],
                "expected_definition_revision": 3,
            })
    finally:
        actor_context.reset(token)

    result = result_dict(response)
    assert result["schemaVersion"] == "playbook.mcp.v1"
    assert result["data"]["uiTarget"] == {
        "surface": "playbook.editor.assistant",
        "params": {"playbookId": "playbook/1", "operationId": "operation/1", "preview": "advisor"},
    }
    assert result["data"]["eventStreamOwner"] == "playbook_canvas"


@pytest.mark.asyncio
async def test_playbook_construction_returns_browser_safe_canvas_handoff(monkeypatch):
    class BackendStub:
        async def post(self, path, user_id, payload):
            assert path.endswith("/requests/request%2F1/constructions")
            assert user_id == "user-1"
            assert payload["contextId"] == "context-1"
            return {"operationId": "operation/1", "playbookId": "playbook/1"}

    monkeypatch.setattr(server, "backend", lambda: BackendStub())
    token = actor_context.set(PlatformActorContext("tenant-1", "user-1", "agent-1", "conversation-1", "correlation-1"))
    try:
        async with Client(mcp) as client:
            response = await client.call_tool("start_playbook_construction", {
                "request_id": "request/1",
                "context_id": "context-1",
            })
    finally:
        actor_context.reset(token)

    result = result_dict(response)
    assert result["data"]["uiTarget"] == {
        "surface": "playbook.editor.assistant",
        "params": {"playbookId": "playbook/1", "operationId": "operation/1"},
    }
    assert result["data"]["eventStreamOwner"] == "playbook_canvas"
    assert "mcpEventStreamPath" not in result["data"]
