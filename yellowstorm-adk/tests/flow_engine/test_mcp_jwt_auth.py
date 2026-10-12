import json
import sys
import time
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock
from types import ModuleType, SimpleNamespace

import httpx
import pytest

from src.flow_engine.mcp.jwt_auth import renew_mcp_jwt
from src.flow_engine.mcp import call_mcp_tool


@pytest.fixture
def backend(monkeypatch):
    settings = SimpleNamespace(API_URL="http://backend/api", INTERNAL_SERVICE_SECRET="internal-secret")
    module = ModuleType("src.config.settings")
    module.get_settings = lambda: settings
    monkeypatch.setitem(sys.modules, "src.config.settings", module)
    return settings


@pytest.fixture
def renewal():
    return {"YELLOWSTORM_MCP_JWT_CONNECTOR_ID": "connector-1", "YELLOWSTORM_MCP_JWT_USER_ID": "user-1"}


def mock_backend(monkeypatch, handler):
    client_class = httpx.AsyncClient
    def client(**kwargs):
        assert kwargs["follow_redirects"] is False
        return client_class(transport=httpx.MockTransport(handler), **kwargs)
    monkeypatch.setattr(httpx, "AsyncClient", client)


@pytest.mark.asyncio
async def test_renews_for_the_bound_user_and_overrides_static_headers(monkeypatch, backend, renewal):
    seen = []
    expiry = int(time.time()) + 300
    def handler(request):
        seen.append(request)
        return httpx.Response(201, json={"success": True, "data": {
            "token": "signed.jwt.token", "expiresAt": expiry, "serverUrl": "http://mcp:8027/mcp",
        }})
    mock_backend(monkeypatch, handler)
    for _ in range(2):
        headers, expires_at = await renew_mcp_jwt("http://mcp:8027/mcp", renewal, {
            "authorization": "Bearer stale", "Authorization": "Bearer static", "X-Correlation-Id": "trace",
        })
        assert headers == {"Authorization": "Bearer signed.jwt.token", "X-Correlation-Id": "trace"}
        assert expires_at == expiry
    assert len(seen) == 2
    assert str(seen[0].url) == "http://backend/api/v1/connectors/internal/mcp-token"
    assert seen[0].headers["X-Internal-Token"] == "internal-secret"
    assert json.loads(seen[0].content) == {"connectorId": "connector-1", "userId": "user-1"}


@pytest.mark.asyncio
@pytest.mark.parametrize("api_url", ["http://backend/", "http://backend/api", "http://backend/api/v1/"])
async def test_uses_the_versioned_issuance_route(monkeypatch, backend, renewal, api_url):
    backend.API_URL = api_url
    def handler(request):
        assert str(request.url) == "http://backend/api/v1/connectors/internal/mcp-token"
        return httpx.Response(200, json={"token": "signed.jwt.token", "expiresAt": int(time.time()) + 300, "serverUrl": "http://mcp:8027/mcp"})
    mock_backend(monkeypatch, handler)
    await renew_mcp_jwt("http://mcp:8027/mcp", renewal, {})


@pytest.mark.asyncio
@pytest.mark.parametrize("override", [
    {"serverUrl": "https://evil.example/mcp"}, {"serverUrl": "http://mcp:8027/MCP"},
    {"serverUrl": "http://mcp:8027/mcp?other=1"}, {"token": ""},
    {"token": "header\ninjection"}, {"expiresAt": 1}, {"expiresAt": "bad"},
])
async def test_rejects_invalid_renewal_responses(monkeypatch, backend, renewal, override):
    payload = {"token": "secret.jwt.value", "expiresAt": int(time.time()) + 300, "serverUrl": "http://mcp:8027/mcp", **override}
    mock_backend(monkeypatch, lambda request: httpx.Response(200, json=payload))
    with pytest.raises(RuntimeError, match="MCP JWT renewal failed") as error:
        await renew_mcp_jwt("http://mcp:8027/mcp", renewal, {})
    assert "secret.jwt.value" not in str(error.value)


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [401, 403, 503, 307])
async def test_fails_closed_on_backend_errors_and_redirects(monkeypatch, backend, renewal, status):
    mock_backend(monkeypatch, lambda request: httpx.Response(status, text="secret response", headers={"Location": "https://evil.example"}))
    with pytest.raises(RuntimeError, match="MCP JWT renewal failed"):
        await renew_mcp_jwt("http://mcp:8027/mcp", renewal, {"Authorization": "Bearer stale"})


@pytest.mark.asyncio
async def test_requires_internal_credentials(backend, renewal):
    backend.INTERNAL_SERVICE_SECRET = ""
    with pytest.raises(RuntimeError, match="INTERNAL_SERVICE_SECRET"):
        await renew_mcp_jwt("http://mcp:8027/mcp", renewal, {})


@pytest.mark.asyncio
async def test_connector_call_renews_and_forwards_jwt_after_static_header_merge(monkeypatch, renewal):
    from src.flow_engine.mcp import jwt_auth
    renew = AsyncMock(side_effect=[
        ({"Authorization": "Bearer first-jwt"}, int(time.time()) + 1),
        ({"Authorization": "Bearer renewed-jwt"}, int(time.time()) + 300),
    ])
    monkeypatch.setattr(jwt_auth, "renew_mcp_jwt", renew)
    requests = []
    @asynccontextmanager
    async def stream(url, http_client):
        request = http_client.build_request("POST", url)
        for hook in http_client.event_hooks["request"]:
            await hook(request)
        requests.append(request)
        assert http_client.follow_redirects is False
        yield (None, None, None)
    sdk = ModuleType("mcp.client.streamable_http")
    sdk.streamable_http_client = stream
    monkeypatch.setitem(sys.modules, "mcp.client.streamable_http", sdk)
    class Session:
        def __init__(self, *_args): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *_args): pass
        async def initialize(self): pass
        async def call_tool(self, name, arguments):
            return SimpleNamespace(isError=False, content=[SimpleNamespace(type="text", text="ok")])
    mcp = ModuleType("mcp")
    mcp.ClientSession = Session
    monkeypatch.setitem(sys.modules, "mcp", mcp)
    result = await call_mcp_tool("streamable_http", "http://mcp:8027/mcp",
        {"headers": {"authorization": "Bearer static"}}, "find_records", {},
        auth_headers={"Authorization": "Bearer stale"}, auth_env=renewal)
    assert result == "ok"
    assert renew.await_count == 2
    assert requests[0].headers["Authorization"] == "Bearer renewed-jwt"


@pytest.mark.asyncio
async def test_connector_call_fails_closed_when_renewal_fails(monkeypatch, renewal):
    from src.flow_engine.mcp import jwt_auth
    monkeypatch.setattr(jwt_auth, "renew_mcp_jwt", AsyncMock(side_effect=RuntimeError("MCP JWT renewal failed")))
    result = await call_mcp_tool("streamable_http", "http://mcp:8027/mcp", {},
        "find_records", {}, auth_headers={"Authorization": "Bearer stale"}, auth_env=renewal)
    assert "MCP JWT renewal failed" in result
