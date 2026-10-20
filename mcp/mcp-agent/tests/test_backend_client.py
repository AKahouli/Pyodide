import httpx
import pytest

from auth import PlatformActorContext, actor_context, verified_mcp_jwt
from clients.yellowstorm_agent_client import AgentBackendError, YellowStormAgentClient


@pytest.fixture(autouse=True)
def signed_assertion():
    token = verified_mcp_jwt.set("signed.jwt.token")
    yield
    verified_mcp_jwt.reset(token)


@pytest.mark.asyncio
async def test_forwards_internal_and_acting_user_headers_and_unwraps_envelope():
    async def handler(request: httpx.Request) -> httpx.Response:
        assert "X-Internal-Token" not in request.headers
        assert "X-YellowStorm-Service-Principal" not in request.headers
        assert "X-YellowStorm-Service-Token" not in request.headers
        assert "X-YellowStorm-User-Id" not in request.headers
        assert request.headers["X-YellowStorm-Mcp-Assertion"] == "signed.jwt.token"
        assert request.headers["X-Correlation-Id"] == "correlation-1"
        return httpx.Response(200, json={"success": True, "data": {"id": "agent-1"}})

    token = actor_context.set(PlatformActorContext("user-1", "agent-1", "conversation-1", "correlation-1"))
    try:
        client = YellowStormAgentClient("http://backend", transport=httpx.MockTransport(handler))
        assert await client.get("/agents/agent-1", "user-1") == {"id": "agent-1"}
        await client.close()
    finally:
        actor_context.reset(token)


@pytest.mark.asyncio
async def test_normalizes_backend_error_without_exposing_tokens():
    async def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(409, json={"error": {"code": "TEAM_ALREADY_EXISTS", "message": "duplicate"}})

    token = actor_context.set(PlatformActorContext("user-1", "agent-1", "conversation-1", "correlation-1"))
    try:
        client = YellowStormAgentClient("http://backend", transport=httpx.MockTransport(handler))
        with pytest.raises(AgentBackendError) as error:
            await client.post("/teams", "user-1", {"name": "marketing"})
        assert error.value.code == "TEAM_ALREADY_EXISTS"
        assert error.value.as_result()["error"]["retryable"] is True
        await client.close()
    finally:
        actor_context.reset(token)


@pytest.mark.asyncio
async def test_maps_timeout_to_dependency_error():
    async def handler(_request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("timed out")

    token = actor_context.set(PlatformActorContext("user-1", "agent-1", "conversation-1", "correlation-1"))
    try:
        client = YellowStormAgentClient("http://backend", transport=httpx.MockTransport(handler))
        with pytest.raises(AgentBackendError) as error:
            await client.get("/agents", "user-1")
        assert error.value.code == "AGENT_TOOL_TIMEOUT"
        assert error.value.status_code == 504
        await client.close()
    finally:
        actor_context.reset(token)


@pytest.mark.asyncio
async def test_delete_returns_unwrapped_body_for_204():
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "DELETE"
        return httpx.Response(204)

    token = actor_context.set(PlatformActorContext("user-1", "agent-1", "conversation-1", "correlation-1"))
    try:
        client = YellowStormAgentClient("http://backend", transport=httpx.MockTransport(handler))
        assert await client.delete("/agents/agent-1", "user-1") == {}
        await client.close()
    finally:
        actor_context.reset(token)


@pytest.mark.asyncio
async def test_forwards_verified_assertion_header_when_present():
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["X-YellowStorm-Mcp-Assertion"] == "signed.jwt.token"
        return httpx.Response(200, json={"success": True, "data": {"id": "agent-1"}})

    actor = actor_context.set(PlatformActorContext("user-1", "agent-1", "conversation-1", "correlation-1"))
    assertion = verified_mcp_jwt.set("signed.jwt.token")
    try:
        client = YellowStormAgentClient("http://backend", transport=httpx.MockTransport(handler))
        assert await client.get("/agents/agent-1", "user-1") == {"id": "agent-1"}
        await client.close()
    finally:
        verified_mcp_jwt.reset(assertion)
        actor_context.reset(actor)


@pytest.mark.asyncio
async def test_rejects_missing_assertion_before_network_access():
    async def handler(request: httpx.Request) -> httpx.Response:
        pytest.fail("Missing assertion must not reach the backend")

    actor = actor_context.set(PlatformActorContext("user-1", "agent-1", "conversation-1", "correlation-1"))
    assertion = verified_mcp_jwt.set(None)
    try:
        client = YellowStormAgentClient("http://backend", transport=httpx.MockTransport(handler))
        with pytest.raises(AgentBackendError, match="Missing verified MCP assertion"):
            await client.get("/agents/agent-1", "user-1")
        await client.close()
    finally:
        verified_mcp_jwt.reset(assertion)
        actor_context.reset(actor)
