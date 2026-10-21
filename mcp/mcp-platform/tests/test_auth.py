import pytest

from auth import TrustedIdentityMiddleware, require_acting_user_id


async def app(_scope, _receive, send):
    await send({"type": "http.response.start", "status": 200, "headers": []})
    await send({"type": "http.response.body", "body": b""})


async def invoke(keys, headers, path="/mcp"):
    messages = []
    async def send(message):
        messages.append(message)

    middleware = TrustedIdentityMiddleware(app, jwt_public_key=keys[1],
        jwt_issuer="yellowstorm", jwt_audience="mcp-platform")
    await middleware({"type": "http", "path": path, "headers": headers}, lambda: None, send)
    return messages


@pytest.mark.asyncio
async def test_rejects_naked_user_id_header_without_a_signed_assertion(keys):
    messages = await invoke(keys, [(b"x-yellowstorm-user-id", b"user-1")])
    assert messages[0]["status"] == 401


@pytest.mark.asyncio
async def test_rejects_missing_and_garbage_credentials(keys):
    assert (await invoke(keys, []))[0]["status"] == 401
    assert (await invoke(keys, [(b"authorization", b"Bearer not-a-jwt")]))[0]["status"] == 401


@pytest.mark.asyncio
async def test_rejects_legacy_ingress_header(keys):
    messages = await invoke(keys, [(b"authorization", b"Bearer anything"), (b"x-playbook-mcp-token", b"secret")])
    assert messages[0]["status"] == 401


@pytest.mark.asyncio
async def test_rejects_legacy_ingress_header_on_health_route(keys):
    messages = await invoke(keys, [(b"x-playbook-mcp-token", b"secret")], "/health/live")
    assert messages[0]["status"] == 401


@pytest.mark.asyncio
async def test_allows_health_routes_without_trusted_identity(keys):
    messages = await invoke(keys, [], "/health/live")
    assert messages[0]["status"] == 200
    messages = await invoke(keys, [], "/health/ready")
    assert messages[0]["status"] == 200


def test_middleware_fails_closed_without_a_valid_rsa_public_key():
    with pytest.raises(ValueError):
        TrustedIdentityMiddleware(app, jwt_public_key="not a key",
            jwt_issuer="yellowstorm", jwt_audience="mcp-platform")
    with pytest.raises(ValueError, match="JWT authentication requires"):
        TrustedIdentityMiddleware(app, jwt_public_key="not a key", jwt_issuer="", jwt_audience="mcp-platform")


def test_tool_authorization_requires_complete_actor_context():
    with pytest.raises(RuntimeError, match="actor context"):
        require_acting_user_id()
