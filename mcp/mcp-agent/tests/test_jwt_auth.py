import time

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from auth import TrustedIdentityMiddleware, actor_context, verified_mcp_jwt
from test_auth import app


@pytest.fixture(scope="module")
def keys():
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public = private.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    ).decode()
    return private, public


async def request(keys, claims=None, token=None, extra_headers=()):
    now = int(time.time())
    payload = {"sub": "user-1", "iss": "yellowstorm", "aud": "mcp-agent", "iat": now, "exp": now + 300}
    payload.update(claims or {})
    token = token if token is not None else jwt.encode(payload, keys[0], algorithm="RS256")
    messages = []

    async def send(message):
        messages.append(message)

    middleware = TrustedIdentityMiddleware(app, "ingress-secret", auth_mode="JWT",
        jwt_public_key=keys[1], jwt_issuer="yellowstorm")
    await middleware({"type": "http", "path": "/mcp", "headers": [
        (b"authorization", f"Bearer {token}".encode()), *extra_headers
    ]}, lambda: None, send)
    return messages


@pytest.mark.asyncio
async def test_jwt_user_overrides_spoofed_header_and_needs_no_trace_headers(keys):
    messages = await request(keys, extra_headers=[(b"x-yellowstorm-user-id", b"other-user")])
    assert messages[0]["status"] == 200
    assert messages[1]["body"] == b"user-1"


@pytest.mark.asyncio
@pytest.mark.parametrize("claims", [
    {"exp": 1}, {"iss": "wrong"}, {"aud": "mcp-playbook"}, {"sub": "invalid user"},
    {"sub": None}, {"iat": None}, {"iat": int(time.time()) + 3600},
])
async def test_rejects_invalid_claims(keys, claims):
    assert (await request(keys, claims))[0]["status"] == 401


@pytest.mark.asyncio
async def test_rejects_static_bearer_wrong_signature_and_duplicate_auth(keys):
    assert (await request(keys, token="ingress-secret"))[0]["status"] == 401
    other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    now = int(time.time())
    token = jwt.encode({"sub": "user-1", "iss": "yellowstorm", "aud": "mcp-agent",
        "iat": now, "exp": now + 300}, other, algorithm="RS256")
    assert (await request(keys, token=token))[0]["status"] == 401
    assert (await request(keys, extra_headers=[(b"authorization", b"Bearer another")]))[0]["status"] == 401


@pytest.mark.asyncio
async def test_jwt_stores_assertion_and_fills_trace_fallbacks(keys):
    seen = {}

    async def probe_app(_scope, _receive, send):
        seen["assertion"] = verified_mcp_jwt.get()
        seen["context"] = actor_context.get()
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b""})

    now = int(time.time())
    token = jwt.encode({"sub": "user-1", "iss": "yellowstorm", "aud": "mcp-agent",
        "iat": now, "exp": now + 300}, keys[0], algorithm="RS256")
    sent = []

    async def send(message):
        sent.append(message)

    middleware = TrustedIdentityMiddleware(probe_app, "ingress-secret", auth_mode="JWT",
        jwt_public_key=keys[1], jwt_issuer="yellowstorm")
    await middleware({"type": "http", "path": "/mcp", "headers": [
        (b"authorization", f"Bearer {token}".encode())
    ]}, lambda: None, send)

    assert sent[0]["status"] == 200
    assert seen["assertion"] == token
    assert seen["context"].correlation_id == "unknown-correlation"
    # The assertion must not leak into the ambient context after the request.
    assert verified_mcp_jwt.get() is None
