import pytest
from fastmcp import Client

import server
from server import mcp


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
        "start_playbook_construction",
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
async def test_advisor_construction_returns_canvas_owned_preview_handoff(monkeypatch):
    class BackendStub:
        async def post(self, path, user_id, payload):
            assert path.endswith("/advisor-remediation-constructions")
            assert user_id == "user-1"
            assert payload["mode"] == "optimize-step"
            return {"operationId": "operation/1"}

    monkeypatch.setattr(server, "backend", lambda: BackendStub())
    monkeypatch.setattr(server, "require_acting_user_id", lambda: "user-1")

    async with Client(mcp) as client:
        response = await client.call_tool("start_advisor_remediation_construction", {
            "playbook_id": "playbook/1",
            "execution_id": "execution-1",
            "mode": "optimize-step",
            "items": [{"taskId": "task-1", "recommendation": "Clarify the prompt"}],
            "expected_definition_revision": 3,
        })

    result = response.data
    assert result["canvasUrl"] == "/#/playbooks/playbook%2F1?assistantOperation=operation%2F1&assistantPreview=advisor"
    assert result["eventStreamOwner"] == "playbook_canvas"


@pytest.mark.asyncio
async def test_playbook_construction_returns_browser_safe_canvas_handoff(monkeypatch):
    class BackendStub:
        async def post(self, path, user_id, payload):
            assert path.endswith("/playbooks/playbook%2F1/constructions")
            assert user_id == "user-1"
            assert payload["expectedDefinitionRevision"] == 4
            return {"operationId": "operation/1", "playbookId": "playbook/1"}

    monkeypatch.setattr(server, "backend", lambda: BackendStub())
    monkeypatch.setattr(server, "require_acting_user_id", lambda: "user-1")

    async with Client(mcp) as client:
        response = await client.call_tool("start_playbook_construction", {
            "playbook_id": "playbook/1",
            "context_id": "context-1",
            "request": "Build a workflow",
            "expected_definition_revision": 4,
        })

    result = response.data
    assert result["canvasUrl"] == "/#/playbooks/playbook%2F1?assistantOperation=operation%2F1"
    assert result["eventStreamOwner"] == "playbook_canvas"
    assert "mcpEventStreamPath" not in result
