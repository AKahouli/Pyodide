"""Ingress + delegated-provider-credential contract for the Teams MCP."""

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from auth import AuthMiddleware
from graph_helpers import get_request_provider_token, get_request_user_id

PROVIDER_HEADER = "x-m365-access-token"


@pytest.fixture(scope="module")
def keys():
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public = private.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    ).decode()
    return private, public


@pytest.fixture
def configured(monkeypatch, keys):
    monkeypatch.setenv("MCP_AUTH_MODE", "JWT")
    monkeypatch.setenv("MCP_JWT_PUBLIC_KEY", keys[1])
    monkeypatch.setenv("MCP_JWT_ISSUER", "yellowstorm")
    monkeypatch.setenv("MCP_JWT_AUDIENCE", "mcp-team")
    monkeypatch.setenv("M365_TOKEN_HEADER", PROVIDER_HEADER)
    return keys


def assertion(keys, **claims):
    now = int(time.time())
    payload = {"sub": "user-1", "iss": "yellowstorm", "aud": "mcp-team", "iat": now, "exp": now + 300}
    payload.update(claims)
    return jwt.encode(payload, keys[0], algorithm="RS256")


async def dispatch(headers, path="/mcp"):
    sent = []
    seen = {}

    async def send(message):
        sent.append(message)

    async def record_app(_scope, _receive, _send):
        seen["actor"] = get_request_user_id()
        seen["provider_token"] = get_request_provider_token()
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b'{"ok":true}'})

    middleware = AuthMiddleware(record_app)
    await middleware({"type": "http", "path": path, "headers": headers}, lambda: None, send)
    return sent, seen


def auth_headers(keys, provider_token="graph-token", **claims):
    headers = [(b"authorization", f"Bearer {assertion(keys, **claims)}".encode())]
    if provider_token is not None:
        headers.append((PROVIDER_HEADER.encode(), provider_token.encode()))
    return headers


@pytest.mark.asyncio
async def test_binds_actor_and_delegated_token_then_clears_them(configured):
    sent, seen = await dispatch(auth_headers(configured))
    assert sent[0]["status"] == 200
    assert seen["actor"] == "user-1"
    assert seen["provider_token"] == "graph-token"
    # Neither credential may leak into the ambient context of a later request.
    assert get_request_user_id() is None
    assert get_request_provider_token() is None


@pytest.mark.asyncio
async def test_missing_provider_token_is_denied(configured):
    sent, seen = await dispatch(auth_headers(configured, provider_token=None))
    assert sent[0]["status"] == 403
    assert b"provider_credential_required" in sent[1]["body"]
    assert seen == {}


@pytest.mark.asyncio
async def test_assertion_is_never_reused_as_the_provider_token(configured):
    token = assertion(configured)
    sent, _ = await dispatch([
        (b"authorization", f"Bearer {token}".encode()),
        (PROVIDER_HEADER.encode(), token.encode()),
    ])
    assert sent[0]["status"] == 403


@pytest.mark.asyncio
async def test_ambiguous_provider_header_is_denied(configured):
    sent, _ = await dispatch(auth_headers(configured) + [(PROVIDER_HEADER.encode(), b"second")])
    assert sent[0]["status"] == 403


@pytest.mark.asyncio
async def test_blank_duplicate_provider_header_is_denied(configured):
    # A repeated header is ambiguous even when only one of its values is filled.
    sent, _ = await dispatch(auth_headers(configured) + [(PROVIDER_HEADER.encode(), b"   ")])
    assert sent[0]["status"] == 403


@pytest.mark.asyncio
async def test_empty_provider_header_value_is_denied(configured):
    sent, _ = await dispatch(auth_headers(configured, provider_token="   "))
    assert sent[0]["status"] == 403


@pytest.mark.asyncio
@pytest.mark.parametrize("claims", [{"aud": "mcp-agent"}, {"iss": "wrong"}, {"exp": 1}, {"sub": None}])
async def test_invalid_assertion_is_rejected_even_with_provider_token(configured, claims):
    sent, seen = await dispatch(auth_headers(configured, **claims))
    assert sent[0]["status"] == 401
    assert seen == {}


@pytest.mark.asyncio
async def test_missing_assertion_is_rejected(configured):
    sent, seen = await dispatch([(PROVIDER_HEADER.encode(), b"graph-token")])
    assert sent[0]["status"] == 401
    assert seen == {}


@pytest.mark.asyncio
async def test_health_paths_need_no_credentials(configured):
    sent, seen = await dispatch([], path="/health/live")
    assert sent[0]["status"] == 200
    assert seen["provider_token"] is None


@pytest.mark.asyncio
async def test_bearer_mode_still_requires_the_provider_token(monkeypatch, keys):
    monkeypatch.setenv("MCP_AUTH_MODE", "BEARER")
    monkeypatch.setenv("MCP_INGRESS_TOKEN", "ingress-secret")
    monkeypatch.setenv("M365_TOKEN_HEADER", PROVIDER_HEADER)
    headers = [(b"authorization", b"Bearer ingress-secret"), (b"x-user-id", b"user-9"), (PROVIDER_HEADER.encode(), b"graph-token")]
    sent, seen = await dispatch(headers)
    assert sent[0]["status"] == 200
    assert seen["actor"] == "user-9"
    assert seen["provider_token"] == "graph-token"

    sent, _ = await dispatch([(b"authorization", b"Bearer ingress-secret"), (b"x-user-id", b"user-9")])
    assert sent[0]["status"] == 403


@pytest.mark.asyncio
async def test_custom_provider_header_name_is_honoured(monkeypatch, keys):
    monkeypatch.setenv("MCP_AUTH_MODE", "JWT")
    monkeypatch.setenv("MCP_JWT_PUBLIC_KEY", keys[1])
    monkeypatch.setenv("MCP_JWT_ISSUER", "yellowstorm")
    monkeypatch.setenv("MCP_JWT_AUDIENCE", "mcp-team")
    monkeypatch.setenv("M365_TOKEN_HEADER", "x-custom-graph-token")
    sent, seen = await dispatch([(b"authorization", f"Bearer {assertion(keys)}".encode()), (b"x-custom-graph-token", b"graph-token")])
    assert sent[0]["status"] == 200
    assert seen["provider_token"] == "graph-token"


def test_rejects_invalid_header_name_configuration(monkeypatch):
    monkeypatch.setenv("MCP_AUTH_MODE", "BEARER")
    monkeypatch.setenv("MCP_INGRESS_TOKEN", "ingress-secret")
    monkeypatch.setenv("M365_TOKEN_HEADER", "bad header name")
    with pytest.raises(ValueError):
        AuthMiddleware(lambda *_: None)
