import pytest

from auth import TrustedIdentityMiddleware, acting_user_id


async def app(_scope, _receive, send):
    await send({"type": "http.response.start", "status": 200, "headers": []})
    await send({"type": "http.response.body", "body": (acting_user_id.get() or "").encode()})


async def invoke(headers, path="/mcp"):
    messages = []
    async def send(message):
        messages.append(message)

    middleware = TrustedIdentityMiddleware(app, "ingress-secret")
    await middleware({"type": "http", "path": path, "headers": headers}, lambda: None, send)
    return messages


@pytest.mark.asyncio
async def test_rejects_spoofed_identity_without_ingress_token():
    messages = await invoke([(b"x-yellowstorm-user-id", b"user-1")])
    assert messages[0]["status"] == 401


@pytest.mark.asyncio
async def test_exposes_identity_only_after_ingress_authentication():
    messages = await invoke([
        (b"x-playbook-mcp-token", b"ingress-secret"),
        (b"x-yellowstorm-user-id", b"user-1"),
    ])
    assert messages[0]["status"] == 200
    assert messages[1]["body"] == b"user-1"


@pytest.mark.asyncio
async def test_allows_health_routes_without_trusted_identity():
    messages = await invoke([], "/health/live")
    assert messages[0]["status"] == 200
