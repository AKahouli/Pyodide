import pytest
from fastmcp import Client

import server
from auth import PlatformActorContext, actor_context
from server import mcp


class NoNameMatch:
    """Name lookups find nothing, so an id is passed on as given."""
    async def get(self, path, user_id):
        return {"items": []}


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
        "modify_playbook",
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
    class BackendStub(NoNameMatch):
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
    token = actor_context.set(PlatformActorContext("user-1", "agent-1", "conversation-1", "correlation-1"))
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
async def test_start_playbook_execution_preserves_the_canvas_handoff(monkeypatch):
    class BackendStub(NoNameMatch):
        async def post(self, path, user_id, payload, idempotency_key=None):
            assert path == "/api/v1/internal/playbook-assistant/playbooks/playbook%2F1/executions"
            assert user_id == "user-1"
            assert payload == {"inputContext": {"source": "Yellowmind"}, "singleStepTaskId": None}
            assert idempotency_key == "request-1"
            return {
                "executionId": "execution-1",
                "uiTarget": {
                    "surface": "playbook.execution.details",
                    "params": {"playbookId": "playbook/1", "executionId": "execution-1"},
                    "effects": [{"type": "focusExecutionStatus"}],
                },
            }

    monkeypatch.setattr(server, "backend", lambda: BackendStub())
    token = actor_context.set(PlatformActorContext("user-1", "agent-1", "conversation-1", "correlation-1"))
    try:
        async with Client(mcp) as client:
            response = await client.call_tool("start_playbook_execution", {
                "playbook_id": "playbook/1",
                "idempotency_key": "request-1",
                "input_context": {"source": "Yellowmind"},
            })
    finally:
        actor_context.reset(token)

    result = result_dict(response)
    assert result["data"]["executionId"] == "execution-1"
    assert result["data"]["uiTarget"]["params"] == {"playbookId": "playbook/1", "executionId": "execution-1"}
    assert result["meta"]["uiTarget"] == result["data"]["uiTarget"]


@pytest.mark.asyncio
async def test_generation_uses_the_current_trusted_turn_without_a_request_id(monkeypatch):
    class BackendStub(NoNameMatch):
        async def post(self, path, user_id, payload):
            assert path == "/api/v1/internal/playbook-assistant/generation"
            assert user_id == "user-1"
            assert payload == {
                "name": "Lead generation",
                "continuationId": None,
                "answers": [],
                "skip": False,
            }
            return {"operationId": "operation-1", "playbookId": "playbook-1", "playbookName": "Lead generation"}

    monkeypatch.setattr(server, "backend", lambda: BackendStub())
    token = actor_context.set(PlatformActorContext("user-1", "agent-1", "conversation-1", "ai-message-1"))
    try:
        async with Client(mcp) as client:
            tools = await client.list_tools()
            generation = next(tool for tool in tools if tool.name == "start_playbook_generation")
            assert "request_id" not in generation.inputSchema["properties"]
            response = await client.call_tool("start_playbook_generation", {"name": "Lead generation"})
    finally:
        actor_context.reset(token)

    result = result_dict(response)
    assert result["data"]["publicationStatus"] == "draft"
    assert result["data"]["uiTarget"] == {
        "surface": "playbook.editor.assistant",
        "params": {"playbookId": "playbook-1", "operationId": "operation-1", "playbookName": "Lead generation"},
    }


@pytest.mark.asyncio
async def test_generation_returns_clarification_without_a_canvas_handoff(monkeypatch):
    class BackendStub(NoNameMatch):
        async def post(self, path, user_id, payload):
            assert path == "/api/v1/internal/playbook-assistant/generation"
            assert user_id == "user-1"
            assert payload == {"name": None, "continuationId": None, "answers": [], "skip": False}
            return {
                "status": "needs_clarification",
                "continuationId": "continuation-1",
                "questions": [{"id": "source", "question": "Which source?"}],
            }

    monkeypatch.setattr(server, "backend", lambda: BackendStub())
    token = actor_context.set(PlatformActorContext("user-1", "agent-1", "conversation-1", "ai-message-1"))
    try:
        async with Client(mcp) as client:
            response = await client.call_tool("start_playbook_generation", {})
    finally:
        actor_context.reset(token)

    result = result_dict(response)
    assert result["data"]["status"] == "needs_clarification"
    assert "uiTarget" not in result["data"]
    assert "publicationStatus" not in result["data"]


@pytest.mark.asyncio
async def test_generation_continues_with_typed_resource_answers(monkeypatch):
    class BackendStub(NoNameMatch):
        async def post(self, path, user_id, payload):
            assert path == "/api/v1/internal/playbook-assistant/generation"
            assert user_id == "user-1"
            assert payload == {
                "name": None,
                "continuationId": "continuation-1",
                "answers": [{"questionId": "source", "resource": {"kind": "workspace", "id": "workspace-1"}}],
                "skip": True,
            }
            return {"operationId": "operation-1", "playbookId": "playbook-1"}

    monkeypatch.setattr(server, "backend", lambda: BackendStub())
    token = actor_context.set(PlatformActorContext("user-1", "agent-1", "conversation-1", "ai-message-2"))
    try:
        async with Client(mcp) as client:
            response = await client.call_tool("start_playbook_generation", {
                "continuation_id": "continuation-1",
                "answers": [{"questionId": "source", "resource": {"kind": "workspace", "id": "workspace-1"}}],
                "skip_clarification": True,
            })
    finally:
        actor_context.reset(token)

    result = result_dict(response)
    assert result["data"]["publicationStatus"] == "draft"


@pytest.mark.asyncio
async def test_modify_playbook_uses_the_current_trusted_turn_and_hands_off_to_canvas(monkeypatch):
    class BackendStub(NoNameMatch):
        async def post(self, path, user_id, payload):
            assert path == "/api/v1/internal/playbook-assistant/playbooks/playbook%2F1/current-turn/modification"
            assert user_id == "user-1"
            assert payload == {"continuationId": None, "answers": [], "skip": False}
            return {
                "requestId": "request-1",
                "status": "ready",
                "operation": {"operationId": "operation/1", "playbookId": "playbook/1"},
            }

    monkeypatch.setattr(server, "backend", lambda: BackendStub())
    token = actor_context.set(PlatformActorContext("user-1", "agent-1", "conversation-1", "ai-message-1"))
    try:
        async with Client(mcp) as client:
            tools = await client.list_tools()
            modification = next(tool for tool in tools if tool.name == "modify_playbook")
            assert "request_id" not in modification.inputSchema["properties"]
            response = await client.call_tool("modify_playbook", {"playbook_id": "playbook/1"})
    finally:
        actor_context.reset(token)

    result = result_dict(response)
    assert result["data"]["status"] == "ready"
    assert result["data"]["uiTarget"] == {
        "surface": "playbook.editor.assistant",
        "params": {"playbookId": "playbook/1", "operationId": "operation/1"},
    }
    assert result["data"]["eventStreamOwner"] == "playbook_canvas"


@pytest.mark.asyncio
async def test_modify_playbook_accepts_json_encoded_string_answers(monkeypatch):
    received = {}

    class BackendStub(NoNameMatch):
        async def post(self, path, user_id, payload):
            received["payload"] = payload
            return {"requestId": "request-1", "status": "ready"}

    monkeypatch.setattr(server, "backend", lambda: BackendStub())
    token = actor_context.set(PlatformActorContext("user-1", "agent-1", "conversation-1", "ai-message-1"))
    try:
        async with Client(mcp) as client:
            await client.call_tool("modify_playbook", {
                "playbook_id": "playbook/1",
                "continuation_id": "continuation-1",
                "answers": '[{"choice": "Uniquement le plan de nurture", "questionId": "q1"}]',
            })
    finally:
        actor_context.reset(token)

    assert received["payload"] == {
        "continuationId": "continuation-1",
        "answers": [{"choice": "Uniquement le plan de nurture", "questionId": "q1"}],
        "skip": False,
    }


@pytest.mark.asyncio
async def test_modify_playbook_forwards_skip_clarification(monkeypatch):
    received = {}

    class BackendStub(NoNameMatch):
        async def post(self, path, user_id, payload):
            received["payload"] = payload
            return {"requestId": "request-1", "status": "ready"}

    monkeypatch.setattr(server, "backend", lambda: BackendStub())
    token = actor_context.set(PlatformActorContext("user-1", "agent-1", "conversation-1", "ai-message-1"))
    try:
        async with Client(mcp) as client:
            await client.call_tool("modify_playbook", {
                "playbook_id": "playbook/1",
                "continuation_id": "continuation-1",
                "answers": [],
                "skip_clarification": True,
            })
    finally:
        actor_context.reset(token)

    assert received["payload"]["skip"] is True


@pytest.mark.asyncio
async def test_continue_clarification_forwards_skip_clarification(monkeypatch):
    received = {}

    class BackendStub(NoNameMatch):
        async def post(self, path, user_id, payload):
            received["payload"] = payload
            return {"requestId": "request-1", "status": "ready_to_construct"}

    monkeypatch.setattr(server, "backend", lambda: BackendStub())
    token = actor_context.set(PlatformActorContext("user-1", "agent-1", "conversation-1", "ai-message-1"))
    try:
        async with Client(mcp) as client:
            await client.call_tool("continue_playbook_clarification", {
                "continuation_id": "continuation-1",
                "answers": [{"questionId": "q1", "choice": "France"}],
                "skip_clarification": True,
            })
    finally:
        actor_context.reset(token)

    assert received["payload"] == {
        "answers": [{"questionId": "q1", "choice": "France"}],
        "skip": True,
    }


@pytest.mark.asyncio
async def test_continue_clarification_rejects_malformed_string_answers(monkeypatch):
    class BackendStub(NoNameMatch):
        async def post(self, path, user_id, payload):
            raise AssertionError("backend must not be called for malformed answers")

    monkeypatch.setattr(server, "backend", lambda: BackendStub())
    token = actor_context.set(PlatformActorContext("user-1", "agent-1", "conversation-1", "ai-message-1"))
    try:
        async with Client(mcp) as client:
            with pytest.raises(Exception, match="answers"):
                await client.call_tool("continue_playbook_clarification", {
                    "continuation_id": "continuation-1",
                    "answers": "not-json",
                })
    finally:
        actor_context.reset(token)


@pytest.mark.asyncio
async def test_advisor_construction_returns_canvas_owned_preview_handoff(monkeypatch):
    class BackendStub(NoNameMatch):
        async def post(self, path, user_id, payload):
            assert path.endswith("/advisor-remediation-constructions")
            assert user_id == "user-1"
            assert payload["mode"] == "optimize-step"
            return {"operationId": "operation/1"}

    monkeypatch.setattr(server, "backend", lambda: BackendStub())
    token = actor_context.set(PlatformActorContext("user-1", "agent-1", "conversation-1", "correlation-1"))
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
        "params": {"playbookId": "playbook/1", "operationId": "operation/1"},
    }
    assert result["data"]["eventStreamOwner"] == "playbook_canvas"


@pytest.mark.asyncio
async def test_playbook_construction_returns_browser_safe_canvas_handoff(monkeypatch):
    class BackendStub(NoNameMatch):
        async def post(self, path, user_id, payload):
            assert path.endswith("/requests/request%2F1/constructions")
            assert user_id == "user-1"
            assert payload["contextId"] == "context-1"
            return {"operationId": "operation/1", "playbookId": "playbook/1"}

    monkeypatch.setattr(server, "backend", lambda: BackendStub())
    token = actor_context.set(PlatformActorContext("user-1", "agent-1", "conversation-1", "correlation-1"))
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


@pytest.mark.asyncio
async def test_playbook_tools_accept_the_exact_playbook_name(monkeypatch):
    calls = []

    class BackendStub:
        async def get(self, path, user_id):
            calls.append(path)
            if path.startswith("/api/v1/internal/playbook-assistant/playbooks?"):
                assert "query=Invoice+triage" in path
                return {"items": [
                    {"playbookId": "65f000000000000000000001", "name": "Invoice triage"},
                    {"playbookId": "65f000000000000000000002", "name": "Invoice triage v2"},
                ]}
            return {"workflow": "summary"}

    monkeypatch.setattr(server, "backend", lambda: BackendStub())
    token = actor_context.set(PlatformActorContext("user-1", "agent-1", "conversation-1", "correlation-1"))
    try:
        async with Client(mcp) as client:
            await client.call_tool("get_playbook_summary", {"playbook_id": "Invoice triage"})
            await client.call_tool("get_playbook_summary", {"playbook_id": "65f0000000000000000000ff"})
    finally:
        actor_context.reset(token)

    assert calls[1] == "/api/v1/internal/playbook-assistant/playbooks/65f000000000000000000001/summary"
    # An id is used as given, without a lookup.
    assert calls[2:] == ["/api/v1/internal/playbook-assistant/playbooks/65f0000000000000000000ff/summary"]


@pytest.mark.asyncio
async def test_task_tools_accept_the_exact_task_name(monkeypatch):
    calls = []
    playbook = "65f000000000000000000001"
    tasks = {"workflow": {"tasks": [
        {"id": "task-screen", "label": "Screen CVs"},
        {"id": "task-rank", "label": "Rank candidates"},
        {"id": "task-rank-2", "label": "rank candidates"},
    ]}}

    class BackendStub:
        async def get(self, path, user_id):
            calls.append(path)
            if path.endswith("/summary"):
                return tasks
            if path == "/api/v1/internal/playbook-assistant/executions/execution-1":
                return {"flowId": playbook}
            return {"task": "details"}

        async def post(self, path, user_id, payload):
            calls.append((path, payload))
            return {"executionId": "execution-2"}

    monkeypatch.setattr(server, "backend", lambda: BackendStub())
    token = actor_context.set(PlatformActorContext("user-1", "agent-1", "conversation-1", "correlation-1"))
    try:
        async with Client(mcp) as client:
            await client.call_tool("get_task_details", {"playbook_id": playbook, "task_id": "screen cvs"})
            # Two tasks share the name: the value is passed on and the backend says it is unknown.
            await client.call_tool("get_task_details", {"playbook_id": playbook, "task_id": "Rank candidates"})
            await client.call_tool("run_playbook_from_step", {"execution_id": "execution-1", "task_id": "Screen CVs"})
    finally:
        actor_context.reset(token)

    assert f"/api/v1/internal/playbook-assistant/playbooks/{playbook}/tasks/task-screen" in calls
    assert f"/api/v1/internal/playbook-assistant/playbooks/{playbook}/tasks/Rank%20candidates" in calls
    assert ("/api/v1/internal/playbook-assistant/executions/execution-1/run-from-step", {"taskId": "task-screen", "iteration": None}) in calls


@pytest.mark.asyncio
async def test_tells_the_assistant_about_names_sources_and_runs_and_marks_reads_and_removals():
    async with Client(mcp) as client:
        tools = {tool.name: tool for tool in await client.list_tools()}
        instructions = client.initialize_result.instructions
    assert "never show ids" in instructions
    assert "sources card" in instructions
    assert "Runs are the user's decision" in instructions
    assert tools["search_playbooks"].annotations.readOnlyHint is True
    assert tools["get_execution_diagnostics"].annotations.readOnlyHint is True
    assert tools["delete_playbook_execution"].annotations.destructiveHint is True
    assert tools["cancel_playbook_execution"].annotations.destructiveHint is True
