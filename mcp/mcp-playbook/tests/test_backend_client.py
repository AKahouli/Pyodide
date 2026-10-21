import httpx
import pytest

from auth import PlatformActorContext, actor_context, verified_mcp_jwt
from clients.yellowstorm_playbook_client import PlaybookBackendError, YellowStormPlaybookClient


@pytest.fixture(autouse=True)
def signed_assertion():
    token = verified_mcp_jwt.set("signed.jwt.token")
    yield
    verified_mcp_jwt.reset(token)


@pytest.mark.asyncio
@pytest.mark.parametrize("path", [
    "/api/v1/internal/playbook-assistant/generation",
    "/api/v1/internal/playbook-assistant/playbooks/p1/current-turn/modification",
    "/api/v1/internal/playbook-assistant/requests/r1/constructions",
])
async def test_forwards_jwt_and_execution_context_without_actor_selectors(path):
    async def handler(request: httpx.Request) -> httpx.Response:
        assert "X-Internal-Token" not in request.headers
        assert "X-YellowStorm-Service-Principal" not in request.headers
        assert "X-YellowStorm-Service-Token" not in request.headers
        assert "X-YellowStorm-User-Id" not in request.headers
        assert request.headers["X-YellowStorm-Mcp-Assertion"] == "signed.jwt.token"
        assert request.headers["X-Correlation-Id"] == "correlation-1"
        assert "X-YellowStorm-Tenant-Id" not in request.headers
        assert "X-YellowStorm-Agent-Id" not in request.headers
        assert request.headers["X-YellowStorm-Conversation-Id"] == "conversation-1"
        assert request.method == "POST"
        assert request.url.path == path
        return httpx.Response(200, json={"success": True, "data": {"playbookId": "p1"}})

    token = actor_context.set(PlatformActorContext("user-1", "agent-1", "conversation-1", "correlation-1"))
    try:
        client = YellowStormPlaybookClient("http://backend", transport=httpx.MockTransport(handler))
        assert await client.post(path, "untrusted-user-selector", {}) == {"playbookId": "p1"}
        await client.close()
    finally:
        actor_context.reset(token)


@pytest.mark.asyncio
async def test_normalizes_backend_error_without_exposing_tokens():
    async def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(409, json={"error": {"code": "PLAYBOOK_REVISION_CONFLICT", "message": "stale"}})

    token = actor_context.set(PlatformActorContext("user-1", "agent-1", "conversation-1", "correlation-1"))
    try:
        client = YellowStormPlaybookClient("http://backend", transport=httpx.MockTransport(handler))
        with pytest.raises(PlaybookBackendError) as error:
            await client.post("/construction", "user-1", {})
        assert error.value.code == "PLAYBOOK_REVISION_CONFLICT"
        assert error.value.as_result()["error"]["retryable"] is True
        await client.close()
    finally:
        actor_context.reset(token)


@pytest.mark.asyncio
async def test_streams_events_with_internal_identity_and_resume_cursor():
    async def handler(request: httpx.Request) -> httpx.Response:
        assert "X-Internal-Token" not in request.headers
        assert "X-YellowStorm-Service-Principal" not in request.headers
        assert "X-YellowStorm-Service-Token" not in request.headers
        assert "X-YellowStorm-User-Id" not in request.headers
        assert request.headers["X-YellowStorm-Mcp-Assertion"] == "signed.jwt.token"
        assert request.headers["X-Correlation-Id"] == "correlation-1"
        assert request.headers["Last-Event-ID"] == "7"
        assert "X-YellowStorm-Agent-Id" not in request.headers
        assert request.headers["X-YellowStorm-Conversation-Id"] == "conversation-1"
        return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=b'id: 8\nevent: completed\ndata: {"sequence":8}\n\n')

    token = actor_context.set(PlatformActorContext("user-1", "agent-1", "conversation-1", "correlation-1"))
    try:
        client = YellowStormPlaybookClient("http://backend", transport=httpx.MockTransport(handler))
        chunks = [chunk async for chunk in client.stream("/events?after=7", "user-1", 7)]
        assert b"".join(chunks).startswith(b"id: 8")
        await client.close()
    finally:
        actor_context.reset(token)


@pytest.mark.asyncio
async def test_forwards_execution_idempotency_key():
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["Idempotency-Key"] == "execution-key"
        return httpx.Response(200, json={"success": True, "data": {"executionId": "e1"}})

    token = actor_context.set(PlatformActorContext("user-1", "agent-1", "conversation-1", "correlation-1"))
    try:
        client = YellowStormPlaybookClient("http://backend", transport=httpx.MockTransport(handler))
        assert await client.post("/executions", "user-1", {}, "execution-key") == {"executionId": "e1"}
        await client.close()
    finally:
        actor_context.reset(token)


@pytest.mark.asyncio
async def test_forwards_verified_assertion_header_when_present():
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["X-YellowStorm-Mcp-Assertion"] == "signed.jwt.token"
        return httpx.Response(200, json={"success": True, "data": {"playbookId": "p1"}})

    actor = actor_context.set(PlatformActorContext("user-1", "agent-1", "conversation-1", "correlation-1"))
    assertion = verified_mcp_jwt.set("signed.jwt.token")
    try:
        client = YellowStormPlaybookClient("http://backend", transport=httpx.MockTransport(handler))
        assert await client.get("/context", "user-1") == {"playbookId": "p1"}
        await client.close()
    finally:
        verified_mcp_jwt.reset(assertion)
        actor_context.reset(actor)


@pytest.mark.asyncio
@pytest.mark.parametrize("stream", [False, True])
async def test_rejects_missing_assertion_before_network_access(stream):
    async def handler(request: httpx.Request) -> httpx.Response:
        pytest.fail("Missing assertion must not reach the backend")

    actor = actor_context.set(PlatformActorContext("user-1", "agent-1", "conversation-1", "correlation-1"))
    assertion = verified_mcp_jwt.set(None)
    try:
        client = YellowStormPlaybookClient("http://backend", transport=httpx.MockTransport(handler))
        with pytest.raises(PlaybookBackendError, match="Missing verified MCP assertion"):
            if stream:
                _ = [chunk async for chunk in client.stream("/events", "user-1")]
            else:
                await client.get("/context", "user-1")
        await client.close()
    finally:
        verified_mcp_jwt.reset(assertion)
        actor_context.reset(actor)
