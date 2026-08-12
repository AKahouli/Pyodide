import httpx
import pytest

from auth import PlatformActorContext, actor_context
from clients.yellowstorm_playbook_client import PlaybookBackendError, YellowStormPlaybookClient


@pytest.mark.asyncio
async def test_forwards_internal_and_acting_user_headers_and_unwraps_envelope():
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["X-Internal-Token"] == "internal-secret"
        assert request.headers["X-YellowStorm-User-Id"] == "user-1"
        assert request.headers["X-YellowStorm-Agent-Id"] == "agent-1"
        assert request.headers["X-Correlation-Id"] == "correlation-1"
        return httpx.Response(200, json={"success": True, "data": {"playbookId": "p1"}})

    token = actor_context.set(PlatformActorContext("tenant-1", "user-1", "agent-1", "conversation-1", "correlation-1"))
    try:
        client = YellowStormPlaybookClient("http://backend", "internal-secret", transport=httpx.MockTransport(handler))
        assert await client.get("/context", "user-1") == {"playbookId": "p1"}
        await client.close()
    finally:
        actor_context.reset(token)


@pytest.mark.asyncio
async def test_normalizes_backend_error_without_exposing_tokens():
    async def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(409, json={"error": {"code": "PLAYBOOK_REVISION_CONFLICT", "message": "stale"}})

    client = YellowStormPlaybookClient("http://backend", "internal-secret", transport=httpx.MockTransport(handler))
    with pytest.raises(PlaybookBackendError) as error:
        await client.post("/construction", "user-1", {})
    assert error.value.code == "PLAYBOOK_REVISION_CONFLICT"
    assert error.value.as_result()["retryable"] is True
    await client.close()


@pytest.mark.asyncio
async def test_streams_events_with_internal_identity_and_resume_cursor():
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["X-Internal-Token"] == "internal-secret"
        assert request.headers["X-YellowStorm-User-Id"] == "user-1"
        assert request.headers["Last-Event-ID"] == "7"
        return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=b'id: 8\nevent: completed\ndata: {"sequence":8}\n\n')

    client = YellowStormPlaybookClient("http://backend", "internal-secret", transport=httpx.MockTransport(handler))
    chunks = [chunk async for chunk in client.stream("/events?after=7", "user-1", 7)]
    assert b"".join(chunks).startswith(b"id: 8")
    await client.close()


@pytest.mark.asyncio
async def test_forwards_execution_idempotency_key():
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["Idempotency-Key"] == "execution-key"
        return httpx.Response(200, json={"success": True, "data": {"executionId": "e1"}})

    client = YellowStormPlaybookClient("http://backend", "internal-secret", transport=httpx.MockTransport(handler))
    assert await client.post("/executions", "user-1", {}, "execution-key") == {"executionId": "e1"}
    await client.close()
