"""Real-transport isolation for the Outlook MCP (ADR-0026).

The unit tests in ``test_auth.py`` call the middleware directly. These drive the
production ASGI app through the actual FastMCP streamable-HTTP transport so that
session handling cannot hide a credential that a request never supplied.
"""

import sys
import time
from pathlib import Path

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastmcp import FastMCP

sys.path.insert(0, str(Path(__file__).parents[1]))

PROVIDER_HEADER = "x-m365-access-token"
ACCEPT = "application/json, text/event-stream"
INITIALIZATION = {
    "protocolVersion": "2025-03-26",
    "capabilities": {},
    "clientInfo": {"name": "isolation", "version": "1"},
}


@pytest.fixture(scope="module")
def keys():
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public = private.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    ).decode()
    return private, public


def assertion(keys, subject):
    now = int(time.time())
    return jwt.encode(
        {"sub": subject, "iss": "yellowstorm", "aud": "mcp-outlook", "iat": now, "exp": now + 300},
        keys[0],
        algorithm="RS256",
    )


def launch(monkeypatch, keys):
    """Execute the production entrypoint and capture its real MCP launch call."""
    monkeypatch.setenv("OUTLOOK_MCP_TRANSPORT", "streamable-http")
    monkeypatch.setenv("OUTLOOK_MCP_PORT", "8102")
    monkeypatch.setenv("MCP_AUTH_MODE", "JWT")
    monkeypatch.setenv("MCP_JWT_PUBLIC_KEY", keys[1])
    monkeypatch.setenv("MCP_JWT_ISSUER", "yellowstorm")
    monkeypatch.setenv("MCP_JWT_AUDIENCE", "mcp-outlook")
    monkeypatch.setenv("M365_TOKEN_HEADER", PROVIDER_HEADER)
    launched = {}
    monkeypatch.setattr(FastMCP, "run", lambda self, **kwargs: launched.update(server=self, **kwargs))
    runpy = __import__("runpy")
    runpy.run_path(str(Path(__file__).parents[1] / "server.py"), run_name="__main__")
    return launched


def test_production_entrypoint_runs_stateless_streamable_http(monkeypatch, keys):
    launched = launch(monkeypatch, keys)
    assert launched["transport"] == "streamable-http"
    assert launched["stateless_http"] is True
    assert launched["middleware"], "the auth middleware must stay in front of the transport"


async def call(client, subject, keys, method, params, provider_token, session=None, request_id=1):
    headers = {
        "Authorization": f"Bearer {assertion(keys, subject)}",
        "Accept": ACCEPT,
        "MCP-Protocol-Version": "2025-03-26",
    }
    if provider_token is not None:
        headers[PROVIDER_HEADER] = provider_token
    if session:
        headers["Mcp-Session-Id"] = session
    return await client.post(
        "/mcp", headers=headers, json={"jsonrpc": "2.0", "id": request_id, "method": method, "params": params}
    )


@pytest.mark.asyncio
async def test_transport_requires_both_credentials_on_every_request(monkeypatch, keys):
    launched = launch(monkeypatch, keys)
    app = launched["server"].http_app(
        stateless_http=launched["stateless_http"], middleware=launched["middleware"]
    )
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://mcp") as client:
            initialized = await call(client, "alice", keys, "initialize", INITIALIZATION, "alice-graph-token")
            assert initialized.status_code == 200, initialized.text
            # Stateless: the server must not hand out a session that could later
            # carry a credential the client never re-presented.
            assert "mcp-session-id" not in {k.lower() for k in initialized.headers}

            listed = await call(client, "alice", keys, "tools/list", {}, "alice-graph-token", request_id=2)
            assert listed.status_code == 200, listed.text

            # No provider credential on this call, even though the previous one
            # presented Alice's: the request must be refused, not remembered.
            missing = await call(client, "alice", keys, "tools/call", {"name": "__unknown_tool__", "arguments": {}}, None, request_id=3)
            assert missing.status_code == 403
            assert b"provider_credential_required" in missing.content
            assert b"alice-graph-token" not in missing.content

            # A hypothetical foreign session id from a stateful deployment must
            # not restore a credential either.
            replayed = await call(
                client, "bob", keys, "tools/call",
                {"name": "__unknown_tool__", "arguments": {}}, None, session="alice-legacy-session", request_id=4,
            )
            assert replayed.status_code == 403

            # The ingress assertion can never double as the provider credential.
            reused = await call(
                client, "bob", keys, "tools/call",
                {"name": "__unknown_tool__", "arguments": {}}, assertion(keys, "bob"), request_id=5,
            )
            assert reused.status_code == 403

            # With its own credential the same call reaches the tool layer: an
            # unknown tool name returns a protocol error, not a credential gate.
            allowed = await call(
                client, "bob", keys, "tools/call",
                {"name": "__unknown_tool__", "arguments": {}}, "bob-graph-token", request_id=6,
            )
            assert allowed.status_code == 200, allowed.text
            assert b"provider_credential_required" not in allowed.content
