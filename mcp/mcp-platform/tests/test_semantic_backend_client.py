"""Focused backend-client behavior of the ported semantic-model module:
JWT-only assertion forwarding, module-specific SEMANTIC_MODEL_* codes."""
import httpx
import pytest

from auth import PlatformActorContext, actor_context, verified_mcp_jwt
from clients.yellowstorm_semantic_client import SemanticModelBackendError, YellowStormSemanticModelClient


@pytest.fixture(autouse=True)
def signed_assertion():
    token = verified_mcp_jwt.set("signed-mcp-jwt")
    yield
    verified_mcp_jwt.reset(token)


@pytest.mark.asyncio
async def test_forwards_the_verified_mcp_jwt_as_actor_assertion():
    # The backend derives the actor from the signed assertion, not the naked
    # user-id header; retired static service headers stay dead.
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["X-YellowStorm-Mcp-Assertion"] == "signed-mcp-jwt"
        assert request.headers["X-Correlation-Id"] == "correlation-1"
        assert "X-YellowStorm-Service-Principal" not in request.headers
        assert "X-YellowStorm-Service-Token" not in request.headers
        assert "X-Internal-Token" not in request.headers
        assert "X-YellowStorm-User-Id" not in request.headers
        return httpx.Response(200, json={"success": True, "data": {}})

    token = actor_context.set(PlatformActorContext("user-1", "agent-1", "conversation-1", "correlation-1"))
    try:
        client = YellowStormSemanticModelClient("http://backend", transport=httpx.MockTransport(handler))
        await client.get("/models", "user-1")
        await client.close()
    finally:
        actor_context.reset(token)


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
async def test_post_without_payload_keeps_the_bodyless_wire_shape():
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert request.read() == b""
        return httpx.Response(200, json={"success": True, "data": {"jobId": "j-1"}})

    token = actor_context.set(PlatformActorContext("user-1", "agent-1", "conversation-1", "correlation-1"))
    try:
        client = YellowStormSemanticModelClient("http://backend", transport=httpx.MockTransport(handler))
        assert await client.post("/models/m/runs", "user-1") == {"jobId": "j-1"}
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
        envelope = error.value.as_result()
        assert envelope["schemaVersion"] == "semantic_model.mcp.v1"
        assert envelope["error"]["retryable"] is True
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
            await client.get("/models", "user-1")
        assert error.value.code == "SEMANTIC_MODEL_TOOL_TIMEOUT"
        assert error.value.status_code == 504
        await client.close()
    finally:
        actor_context.reset(token)


@pytest.mark.asyncio
async def test_maps_connection_failure_to_backend_unavailable():
    async def handler(_request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused")

    token = actor_context.set(PlatformActorContext("user-1", "agent-1", "conversation-1", "correlation-1"))
    try:
        client = YellowStormSemanticModelClient("http://backend", transport=httpx.MockTransport(handler))
        with pytest.raises(SemanticModelBackendError) as error:
            await client.get("/models", "user-1")
        assert error.value.code == "SEMANTIC_MODEL_MCP_BACKEND_UNAVAILABLE"
        assert error.value.status_code == 503
        await client.close()
    finally:
        actor_context.reset(token)


@pytest.mark.asyncio
async def test_maps_oversized_response_too_large():
    async def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"x" * 64)

    token = actor_context.set(PlatformActorContext("user-1", "agent-1", "conversation-1", "correlation-1"))
    try:
        client = YellowStormSemanticModelClient("http://backend", max_response_bytes=16, transport=httpx.MockTransport(handler))
        with pytest.raises(SemanticModelBackendError) as error:
            await client.get("/models", "user-1")
        assert error.value.code == "SEMANTIC_MODEL_RESPONSE_TOO_LARGE"
        assert error.value.status_code == 502
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
        assert await client.delete("/models/m", "user-1") == {}
        await client.close()
    finally:
        actor_context.reset(token)
