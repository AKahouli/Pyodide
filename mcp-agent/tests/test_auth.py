import pytest

from auth import TrustedIdentityMiddleware, acting_user_id, actor_context, require_acting_user_id


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
async def test_accepts_bearer_authentication_without_identity_context():
    messages = await invoke([(b"authorization", b"Bearer ingress-secret")])
    assert messages[0]["status"] == 200
    assert messages[1]["body"] == b""


@pytest.mark.asyncio
async def test_exposes_acting_user_only_with_complete_actor_context():
    messages = await invoke([
        (b"authorization", b"Bearer ingress-secret"),
        (b"x-yellowstorm-user-id", b"user-1"),
        (b"x-yellowstorm-agent-id", b"agent-1"),
        (b"x-yellowstorm-conversation-id", b"conversation-1"),
    ])
    assert messages[0]["status"] == 200
    assert messages[1]["body"] == b"user-1"


@pytest.mark.asyncio
async def test_accepts_complete_actor_context():
    seen_contexts = []

    async def context_app(_scope, _receive, send):
        seen_contexts.append(actor_context.get())
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b""})

    messages = []
    async def send(message):
        messages.append(message)

    middleware = TrustedIdentityMiddleware(context_app, "ingress-secret")
    await middleware({"type": "http", "path": "/mcp", "headers": [
        (b"authorization", b"Bearer ingress-secret"),
        (b"x-yellowstorm-user-id", b"user-1"),
        (b"x-yellowstorm-agent-id", b"agent-1"),
        (b"x-yellowstorm-conversation-id", b"conversation-1"),
        (b"x-correlation-id", b"correlation-1"),
    ]}, lambda: None, send)

    assert messages[0]["status"] == 200
    assert seen_contexts[0].correlation_id == "correlation-1"


@pytest.mark.asyncio
@pytest.mark.parametrize("missing_header", [
    b"x-yellowstorm-user-id",
    b"x-yellowstorm-agent-id",
    b"x-yellowstorm-conversation-id",
    b"x-correlation-id",
])
async def test_does_not_establish_actor_context_when_any_identity_field_is_missing(missing_header):
    seen_contexts = []

    async def context_app(_scope, _receive, send):
        seen_contexts.append(actor_context.get())
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b""})

    headers = [
        (b"authorization", b"Bearer ingress-secret"),
        (b"x-yellowstorm-user-id", b"user-1"),
        (b"x-yellowstorm-agent-id", b"agent-1"),
        (b"x-yellowstorm-conversation-id", b"conversation-1"),
        (b"x-correlation-id", b"correlation-1"),
    ]
    messages = []
    async def send(message):
        messages.append(message)

    middleware = TrustedIdentityMiddleware(context_app, "ingress-secret")
    await middleware({
        "type": "http",
        "path": "/mcp",
        "headers": [(name, value) for name, value in headers if name != missing_header],
    }, lambda: None, send)

    assert messages[0]["status"] == 200
    assert seen_contexts == [None]


@pytest.mark.asyncio
@pytest.mark.parametrize("authorization", [
    b"",
    b"Bearer",
    b"Bearer wrong-secret",
    b"Basic ingress-secret",
    b"Bearer ingress-secret extra",
])
async def test_rejects_invalid_bearer_authentication(authorization):
    messages = await invoke([
        (b"authorization", authorization),
    ])
    assert messages[0]["status"] == 401


@pytest.mark.asyncio
async def test_rejects_duplicate_authorization_headers():
    messages = await invoke([
        (b"authorization", b"Bearer wrong-secret"),
        (b"authorization", b"Bearer ingress-secret"),
    ])
    assert messages[0]["status"] == 401


@pytest.mark.asyncio
async def test_rejects_invalid_optional_identity():
    messages = await invoke([
        (b"authorization", b"Bearer ingress-secret"),
        (b"x-yellowstorm-user-id", b"invalid user"),
    ])
    assert messages[0]["status"] == 401


def test_tool_authorization_requires_complete_actor_context():
    with pytest.raises(RuntimeError, match="actor context"):
        require_acting_user_id()


@pytest.mark.asyncio
async def test_allows_health_routes_without_trusted_identity():
    messages = await invoke([], "/health/live")
    assert messages[0]["status"] == 200
