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
async def test_registers_approved_tools():
    async with Client(mcp) as client:
        tools = await client.list_tools()
    names = {tool.name for tool in tools}
    assert names == {
        "list_agent_types",
        "list_models",
        "list_agents",
        "get_agent",
        "create_agent",
        "update_agent",
        "delete_agent",
        "list_teams",
        "get_team",
        "create_team",
        "update_team",
        "update_team_hierarchy",
        "delete_team",
    }
    for tool in tools:
        assert tool.outputSchema["properties"]["schemaVersion"]["const"] == "agent.mcp.v1"


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
async def test_create_agent_maps_snake_case_and_omits_empty_fields(monkeypatch):
    class BackendStub:
        async def post(self, path, user_id, payload):
            assert path == "/api/v1/internal/agent-crud/agents"
            assert user_id == "user-1"
            assert payload == {
                "name": "SEO Writer",
                "agentType": "type-1",
                "role": "Write SEO content",
                "description": "Marketing content writer",
            }
            return {"id": "agent-1", "name": "SEO Writer"}

    monkeypatch.setattr(server, "backend", lambda: BackendStub())
    token = actor_context.set(PlatformActorContext("user-1", "agent-1", "conversation-1", "correlation-1"))
    try:
        async with Client(mcp) as client:
            response = await client.call_tool("create_agent", {
                "name": "SEO Writer",
                "agent_type_id": "type-1",
                "role": "Write SEO content",
                "description": "Marketing content writer",
                "instruction": None,
                "model": None,
                "temperature": None,
            })
    finally:
        actor_context.reset(token)

    result = result_dict(response)
    assert result["ok"] is True
    assert result["data"]["id"] == "agent-1"


@pytest.mark.asyncio
async def test_create_team_allows_omitting_optional_fields(monkeypatch):
    class BackendStub:
        async def post(self, path, user_id, payload):
            assert path == "/api/v1/internal/agent-crud/teams"
            assert user_id == "user-1"
            assert payload == {"name": "marketing"}
            return {"id": "team-1", "name": "marketing"}

    monkeypatch.setattr(server, "backend", lambda: BackendStub())
    token = actor_context.set(PlatformActorContext("user-1", "agent-1", "conversation-1", "correlation-1"))
    try:
        async with Client(mcp) as client:
            response = await client.call_tool("create_team", {"name": "marketing"})
    finally:
        actor_context.reset(token)

    result = result_dict(response)
    assert result["ok"] is True
    assert result["data"]["id"] == "team-1"


@pytest.mark.asyncio
async def test_update_team_hierarchy_coerces_json_string_members(monkeypatch):
    class BackendStub:
        async def patch(self, path, user_id, payload):
            assert path == "/api/v1/internal/agent-crud/teams/team%2F1/hierarchy"
            assert user_id == "user-1"
            assert payload == {
                "members": [
                    {"agentId": "agent-1"},
                    {"agentId": "agent-2", "parentAgentId": "agent-1", "order": 1},
                ]
            }
            return {"id": "team-1"}

    monkeypatch.setattr(server, "backend", lambda: BackendStub())
    token = actor_context.set(PlatformActorContext("user-1", "agent-1", "conversation-1", "correlation-1"))
    try:
        async with Client(mcp) as client:
            response = await client.call_tool("update_team_hierarchy", {
                "team_id": "team/1",
                "members": '[{"agent_id": "agent-1", "parent_agent_id": null}, {"agent_id": "agent-2", "parent_agent_id": "agent-1", "order": 1}]',
            })
    finally:
        actor_context.reset(token)

    result = result_dict(response)
    assert result["ok"] is True


@pytest.mark.asyncio
async def test_backend_error_becomes_failure_envelope(monkeypatch):
    from clients.yellowstorm_agent_client import AgentBackendError

    class BackendStub:
        async def get(self, path, user_id):
            raise AgentBackendError("TEAM_ALREADY_EXISTS", "Team name already used", 409)

    monkeypatch.setattr(server, "backend", lambda: BackendStub())
    token = actor_context.set(PlatformActorContext("user-1", "agent-1", "conversation-1", "correlation-1"))
    try:
        async with Client(mcp) as client:
            response = await client.call_tool("get_team", {"team_id": "team-1"})
    finally:
        actor_context.reset(token)

    result = result_dict(response)
    assert result["ok"] is False
    assert result["error"]["code"] == "TEAM_ALREADY_EXISTS"
    assert result["error"]["retryable"] is True
    assert result["error"]["category"] == "conflict"


@pytest.mark.asyncio
async def test_read_tools_accept_and_ignore_injected_workspace_id(monkeypatch):
    class BackendStub:
        async def get(self, path, user_id):
            assert path == "/api/v1/internal/agent-crud/agent-types"
            assert user_id == "user-1"
            return []

    monkeypatch.setattr(server, "backend", lambda: BackendStub())
    token = actor_context.set(PlatformActorContext("user-1", "agent-1", "conversation-1", "correlation-1"))
    try:
        async with Client(mcp) as client:
            response = await client.call_tool("list_agent_types", {"workspace_id": "9922db69c0ff4b2db9e6a7c3"})
    finally:
        actor_context.reset(token)

    result = result_dict(response)
    assert result["ok"] is True


@pytest.mark.asyncio
async def test_update_agent_sends_only_provided_fields(monkeypatch):
    class BackendStub:
        async def patch(self, path, user_id, payload):
            assert path == "/api/v1/internal/agent-crud/agents/agent%2F1"
            assert user_id == "user-1"
            assert payload == {"isActive": False}
            return {"id": "agent/1"}

    monkeypatch.setattr(server, "backend", lambda: BackendStub())
    token = actor_context.set(PlatformActorContext("user-1", "agent-1", "conversation-1", "correlation-1"))
    try:
        async with Client(mcp) as client:
            response = await client.call_tool("update_agent", {
                "agent_id": "agent/1",
                "name": None,
                "role": None,
                "description": None,
                "instruction": None,
                "model": None,
                "temperature": None,
                "is_active": False,
            })
    finally:
        actor_context.reset(token)

    result = result_dict(response)
    assert result["ok"] is True
