import time

import jwt
import pytest

from auth import (TrustedIdentityMiddleware, acting_user_id, actor_context,
                  input_file_names, require_acting_user_id, verified_mcp_jwt,
                  workspace_id)

AUDIENCE = "mcp-pyodide"


async def app(_scope, _receive, send):
    await send({"type": "http.response.start", "status": 200, "headers": []})
    await send({"type": "http.response.body", "body": (acting_user_id.get() or "").encode()})


def signed(keys, sub="65f000000000000000000001", **claims):
    now = int(time.time())
    payload = {"sub": sub, "iss": "yellowstorm", "aud": AUDIENCE, "iat": now, "exp": now + 300}
    payload.update(claims)
    return jwt.encode(payload, keys[0], algorithm="RS256")


async def invoke(keys, headers, path="/mcp"):
    messages = []
    async def send(message):
        messages.append(message)

    middleware = TrustedIdentityMiddleware(app, jwt_public_key=keys[1],
        jwt_issuer="yellowstorm", jwt_audience=AUDIENCE)
    await middleware({"type": "http", "path": path, "headers": headers}, lambda: None, send)
    return messages


async def bearer(keys, token=None, extra_headers=()):
    token = token if token is not None else signed(keys)
    return await invoke(keys, [(b"authorization", f"Bearer {token}".encode()), *extra_headers])


@pytest.mark.asyncio
async def test_rejects_naked_user_id_header_without_a_signed_assertion(keys):
    messages = await invoke(keys, [(b"x-yellowstorm-user-id", b"65f000000000000000000001")])
    assert messages[0]["status"] == 401


@pytest.mark.asyncio
async def test_accepts_a_valid_assertion_and_pins_the_token_subject(keys):
    messages = await bearer(keys)
    assert messages[0]["status"] == 200
    assert messages[1]["body"] == b"65f000000000000000000001"


@pytest.mark.asyncio
async def test_rejects_a_subject_that_is_not_an_object_id(keys):
    assert (await bearer(keys, signed(keys, sub="user-1")))[0]["status"] == 401


@pytest.mark.asyncio
async def test_rejects_a_spoofed_user_id_header_despite_a_valid_assertion(keys):
    messages = await bearer(keys, extra_headers=[(b"x-yellowstorm-user-id", b"65f0000000000000000000ff")])
    assert messages[0]["status"] == 401
    matching = await bearer(keys, extra_headers=[(b"x-yellowstorm-user-id", b"65f000000000000000000001")])
    assert matching[0]["status"] == 200


@pytest.mark.asyncio
@pytest.mark.parametrize("claims", [
    {"exp": 1}, {"iss": "wrong"}, {"aud": "mcp-platform"}, {"sub": None},
    {"iat": None}, {"iat": int(time.time()) + 3600},
    {"exp": int(time.time()) + 600}, {"iat": str(int(time.time()))},
    {"exp": str(int(time.time()) + 300)}, {"iat": True},
    {"iat": int(time.time()), "exp": int(time.time())},
])
async def test_rejects_invalid_claims(keys, claims):
    assert (await bearer(keys, signed(keys, **claims)))[0]["status"] == 401


@pytest.mark.asyncio
async def test_rejects_missing_and_garbage_credentials(keys):
    assert (await invoke(keys, []))[0]["status"] == 401
    assert (await invoke(keys, [(b"authorization", b"Bearer not-a-jwt")]))[0]["status"] == 401


@pytest.mark.asyncio
async def test_rejects_static_bearer_and_foreign_signed_tokens(keys):
    assert (await bearer(keys, token="static-secret"))[0]["status"] == 401
    from cryptography.hazmat.primitives.asymmetric import rsa
    other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    now = int(time.time())
    foreign = jwt.encode({"sub": "65f000000000000000000001", "iss": "yellowstorm",
                          "aud": AUDIENCE, "iat": now, "exp": now + 300}, other, algorithm="RS256")
    assert (await bearer(keys, token=foreign))[0]["status"] == 401


@pytest.mark.asyncio
async def test_rejects_duplicate_authorization_headers(keys):
    messages = await invoke(keys, [
        (b"authorization", b"Bearer another"),
        (b"authorization", f"Bearer {signed(keys)}".encode()),
    ])
    assert messages[0]["status"] == 401


@pytest.mark.asyncio
async def test_rejects_legacy_ingress_header(keys):
    messages = await invoke(keys, [
        (b"authorization", f"Bearer {signed(keys)}".encode()),
        (b"x-pyodide-mcp-token", b"retired-secret"),
    ])
    assert messages[0]["status"] == 401


@pytest.mark.asyncio
async def test_rejects_legacy_ingress_header_on_health_route(keys):
    messages = await invoke(keys, [(b"x-pyodide-mcp-token", b"retired-secret")], "/health/live")
    assert messages[0]["status"] == 401


@pytest.mark.asyncio
async def test_allows_health_routes_without_trusted_identity(keys):
    assert (await invoke(keys, [], "/health/live"))[0]["status"] == 200
    assert (await invoke(keys, [], "/health/ready"))[0]["status"] == 200


def test_middleware_fails_closed_without_a_valid_rsa_public_key():
    with pytest.raises(ValueError):
        TrustedIdentityMiddleware(app, jwt_public_key="not a key",
            jwt_issuer="yellowstorm", jwt_audience=AUDIENCE)
    with pytest.raises(ValueError, match="JWT authentication requires"):
        TrustedIdentityMiddleware(app, jwt_public_key="not a key", jwt_issuer="", jwt_audience=AUDIENCE)


def test_tool_authorization_requires_acting_user():
    with pytest.raises(RuntimeError, match="acting user"):
        require_acting_user_id()


@pytest.mark.asyncio
async def test_stores_the_assertion_and_fills_trace_fallbacks(keys):
    seen = {}

    async def probe_app(_scope, _receive, send):
        seen["assertion"] = verified_mcp_jwt.get()
        seen["context"] = actor_context.get()
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b""})

    token = signed(keys)
    assert (await invoke_with_app(probe_app, keys, token))[0]["status"] == 200
    assert seen["assertion"] == token
    assert seen["context"].correlation_id == "unknown-correlation"
    assert seen["context"].agent_id == "unknown-agent"
    assert seen["context"].conversation_id == "unknown-conversation"
    # The assertion must not leak into the ambient context after the request.
    assert verified_mcp_jwt.get() is None


async def invoke_with_app(app, keys, token, extra_headers=()):
    messages = []
    async def send(message):
        messages.append(message)

    middleware = TrustedIdentityMiddleware(app, jwt_public_key=keys[1],
        jwt_issuer="yellowstorm", jwt_audience=AUDIENCE)
    await middleware({"type": "http", "path": "/mcp", "headers": [
        (b"authorization", f"Bearer {token}".encode()), *extra_headers
    ]}, lambda: None, send)
    return messages


@pytest.mark.asyncio
async def test_keeps_optional_trace_headers_when_present(keys):
    seen = {}

    async def context_app(_scope, _receive, send):
        seen["context"] = actor_context.get()
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b""})

    messages = await invoke_with_app(context_app, keys, signed(keys), [
        (b"x-yellowstorm-agent-id", b"agent-1"),
        (b"x-yellowstorm-conversation-id", b"conversation-1"),
        (b"x-correlation-id", b"correlation-1"),
    ])

    assert messages[0]["status"] == 200
    assert seen["context"].agent_id == "agent-1"
    assert seen["context"].conversation_id == "conversation-1"
    assert seen["context"].correlation_id == "correlation-1"


@pytest.mark.asyncio
async def test_extracts_the_first_workspace_object_id_from_a_json_array(keys):
    seen = []

    async def context_app(_scope, _receive, send):
        seen.append(workspace_id.get())
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b""})

    messages = await invoke_with_app(context_app, keys, signed(keys), [
        (b"workspace_id", b'["65f0000000000000000000aa","65f0000000000000000000bb"]'),
    ])

    assert messages[0]["status"] == 200
    assert seen[0] == "65f0000000000000000000aa"


@pytest.mark.asyncio
async def test_extracts_trusted_input_file_names_and_drops_paths(keys):
    seen = []

    async def context_app(_scope, _receive, send):
        seen.append(input_file_names.get())
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b""})

    messages = await invoke_with_app(context_app, keys, signed(keys), [
        (b"x-yellowstorm-input-files", b"test_2.txt, other.csv, ../evil, test_2.txt"),
    ])

    assert messages[0]["status"] == 200
    assert seen[0] == ("test_2.txt", "other.csv")


@pytest.mark.asyncio
async def test_ignores_a_malformed_workspace_header(keys):
    seen = []

    async def context_app(_scope, _receive, send):
        seen.append(workspace_id.get())
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b""})

    messages = await invoke_with_app(context_app, keys, signed(keys), [
        (b"workspace_id", b"../../etc/passwd"),
    ])

    assert messages[0]["status"] == 200
    assert seen[0] is None
