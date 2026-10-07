import httpx
import pytest

from auth import PlatformActorContext, actor_context
from clients.yellowstorm_semantic_model_client import SemanticModelBackendError, YellowStormSemanticModelClient


@pytest.mark.asyncio
async def test_forwards_internal_and_acting_user_headers_and_unwraps_envelope():
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["X-Internal-Token"] == "internal-secret"
        assert request.headers["X-YellowStorm-User-Id"] == "user-1"
        assert request.headers["X-YellowStorm-Agent-Id"] == "agent-1"
        assert request.headers["X-YellowStorm-Conversation-Id"] == "conversation-1"
        assert request.headers["X-Correlation-Id"] == "correlation-1"
        return httpx.Response(200, json={"success": True, "data": {"id": "agent-1"}})

    token = actor_context.set(PlatformActorContext("user-1", "agent-1", "conversation-1", "correlation-1"))
    try:
        client = YellowStormSemanticModelClient("http://backend", "internal-secret", transport=httpx.MockTransport(handler))
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
        client = YellowStormSemanticModelClient("http://backend", "internal-secret", transport=httpx.MockTransport(handler))
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
        client = YellowStormSemanticModelClient("http://backend", "internal-secret", transport=httpx.MockTransport(handler))
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
        client = YellowStormSemanticModelClient("http://backend", "internal-secret", transport=httpx.MockTransport(handler))
        assert await client.delete("/agents/agent-1", "user-1") == {}
        await client.close()
    finally:
        actor_context.reset(token)
