import httpx
import pytest

from auth import PlatformActorContext, actor_context, verified_mcp_jwt
from clients.yellowstorm_semantic_model_client import SemanticModelBackendError, YellowStormSemanticModelClient


@pytest.fixture(autouse=True)
def signed_assertion():
    token = verified_mcp_jwt.set("signed-mcp-jwt")
    yield
    verified_mcp_jwt.reset(token)


@pytest.mark.asyncio
async def test_forwards_the_verified_mcp_jwt_as_actor_assertion():
    # WP06.4: the backend derives the actor from the signed assertion, not
    # the naked user-id header.
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["X-YellowStorm-Mcp-Assertion"] == "signed-mcp-jwt"
        return httpx.Response(200, json={"success": True, "data": {}})

    actor = actor_context.set(PlatformActorContext("user-1", "agent-1", "conversation-1", "correlation-1"))
    assertion = verified_mcp_jwt.set("signed-mcp-jwt")
    try:
        client = YellowStormSemanticModelClient("http://backend", transport=httpx.MockTransport(handler))
        await client.get("/models", "user-1")
        await client.close()
    finally:
        actor_context.reset(actor)
        verified_mcp_jwt.reset(assertion)


@pytest.mark.asyncio
async def test_rejects_missing_assertion_before_network_access():
    async def handler(request: httpx.Request) -> httpx.Response:
        pytest.fail("Missing assertion must not reach the backend")

    token = actor_context.set(PlatformActorContext("user-1", "agent-1", "conversation-1", "correlation-1"))
    assertion = verified_mcp_jwt.set(None)
    try:
        client = YellowStormSemanticModelClient("http://backend", transport=httpx.MockTransport(handler))
        with pytest.raises(SemanticModelBackendError, match="Missing verified MCP assertion"):
            await client.get("/models", "user-1")
        await client.close()
    finally:
        verified_mcp_jwt.reset(assertion)
        actor_context.reset(token)


@pytest.mark.asyncio
async def test_forwards_principal_assertion_and_actor_headers():
    async def handler(request: httpx.Request) -> httpx.Response:
        assert "X-YellowStorm-Service-Principal" not in request.headers
        assert "X-YellowStorm-Service-Token" not in request.headers
        assert "X-YellowStorm-User-Id" not in request.headers
        assert request.headers["X-YellowStorm-Mcp-Assertion"] == "signed-mcp-jwt"
        assert request.headers["X-Correlation-Id"] == "correlation-1"
        return httpx.Response(200, json={"success": True, "data": {"id": "agent-1"}})

    token = actor_context.set(PlatformActorContext("user-1", "agent-1", "conversation-1", "correlation-1"))
    try:
        client = YellowStormSemanticModelClient("http://backend", transport=httpx.MockTransport(handler))
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
        client = YellowStormSemanticModelClient("http://backend", transport=httpx.MockTransport(handler))
        with pytest.raises(SemanticModelBackendError) as error:
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
        client = YellowStormSemanticModelClient("http://backend", transport=httpx.MockTransport(handler))
        with pytest.raises(SemanticModelBackendError) as error:
            await client.get("/agents", "user-1")
        assert error.value.code == "SEMANTIC_MODEL_TOOL_TIMEOUT"
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
        client = YellowStormSemanticModelClient("http://backend", transport=httpx.MockTransport(handler))
        assert await client.delete("/agents/agent-1", "user-1") == {}
        await client.close()
    finally:
        actor_context.reset(token)
