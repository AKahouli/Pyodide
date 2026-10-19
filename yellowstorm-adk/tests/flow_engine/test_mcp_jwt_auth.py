import base64
import json
import sys
import time
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock
from types import ModuleType, SimpleNamespace

import httpx
import pytest

from src.mcp.jwt_auth import renew_mcp_jwt
from src.mcp import call_mcp_tool


def assertion(seconds=180, **claims):
    # Shape fixture only. Backend and receiving MCP own signature verification.
    now = int(time.time())
    def encode(value):
        return base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip("=")
    return ".".join([encode({"alg": "RS256"}), encode({
        "sub": "user-1", "iat": now - 100, "exp": now + seconds,
        "iss": "backend", "aud": "mcp-fixture", "connectorId": "connector-1",
        "securityRevision": 2, **claims,
    }), "fixture-signature"])


@pytest.fixture
def backend(monkeypatch):
    settings = SimpleNamespace(API_URL="http://backend/api", INTERNAL_SERVICE_SECRET="legacy-secret",
        SEMANTIC_MODEL_MCP_SERVICE_TOKEN="wrong-service-secret", ADK_RUNTIME_MCP_RENEWAL_TOKEN="runtime-secret")
    module = ModuleType("src.config.settings")
    module.get_settings = lambda: settings
    monkeypatch.setitem(sys.modules, "src.config.settings", module)
    return settings


@pytest.fixture
def renewal():
    return {"YELLOWSTORM_MCP_JWT_CONNECTOR_ID": "connector-1", "YELLOWSTORM_MCP_JWT_USER_ID": "attacker",
            "ADK_RUNTIME_MCP_RENEWAL_TOKEN": "editable-secret"}


@pytest.fixture
def proof_headers():
    return {"Authorization": f"Bearer {assertion()}", "X-Correlation-Id": "trace"}


def mock_backend(monkeypatch, handler):
    client_class = httpx.AsyncClient
    def client(**kwargs):
        assert kwargs["follow_redirects"] is False
        return client_class(transport=httpx.MockTransport(handler), **kwargs)
    monkeypatch.setattr(httpx, "AsyncClient", client)


@pytest.mark.asyncio
async def test_renews_current_assertion_with_scoped_runtime_principal(monkeypatch, backend, renewal, proof_headers):
    seen = []
    expiry = int(time.time()) + 180
    token = assertion()
    def handler(request):
        seen.append(request)
        return httpx.Response(201, json={"success": True, "data": {
            "token": token, "expiresAt": expiry, "serverUrl": "http://mcp:8027/mcp",
        }})
    mock_backend(monkeypatch, handler)
    headers, expires_at = await renew_mcp_jwt("http://mcp:8027/mcp", renewal, proof_headers)
    assert headers == {"Authorization": f"Bearer {token}", "X-Correlation-Id": "trace"}
    assert expires_at == expiry
    assert str(seen[0].url) == "http://backend/api/v1/connectors/internal/mcp-token"
    assert seen[0].headers["X-Yellowstorm-Service-Principal"] == "adk-runtime"
    assert seen[0].headers["X-Yellowstorm-Service-Token"] == "runtime-secret"
    assert "x-internal-token" not in seen[0].headers
    assert json.loads(seen[0].content) == {"connectorId": "connector-1", "assertion": proof_headers["Authorization"][7:]}


@pytest.mark.asyncio
async def test_two_header_renewal_preserves_service_bearer(monkeypatch, backend, renewal):
    original, renewed = assertion(), assertion(sub='same-verified-user')
    def handler(request):
        assert json.loads(request.content)['assertion'] == original
        return httpx.Response(200, json={'token': renewed, 'expiresAt': int(time.time()) + 180,
                                       'serverUrl': 'http://mcp:8027/mcp'})
    mock_backend(monkeypatch, handler)
    headers, _ = await renew_mcp_jwt('http://mcp:8027/mcp', renewal,
        {'Authorization': 'Bearer static-service-key', 'X-YellowStorm-Mcp-Assertion': original})
    assert headers == {'Authorization': 'Bearer static-service-key', 'X-YellowStorm-Mcp-Assertion': renewed}


@pytest.mark.asyncio
async def test_two_header_bootstrap_ignores_editable_assertion(monkeypatch, renewal, sdk):
    trusted = {'Authorization': 'Bearer service-key', 'X-YellowStorm-Mcp-Assertion': assertion()}
    result = await call_mcp_tool('streamable_http', 'http://mcp:8027/mcp',
        {'headers': {'x-yellowstorm-mcp-assertion': 'editable'}}, 'find_records', {},
        auth_headers=trusted, auth_env=renewal)
    assert result == 'ok'
    assert sdk.requests[0].headers['Authorization'] == 'Bearer service-key'
    assert sdk.requests[0].headers['X-YellowStorm-Mcp-Assertion'] == trusted['X-YellowStorm-Mcp-Assertion']


@pytest.mark.asyncio
@pytest.mark.parametrize("api_url", ["http://backend/", "http://backend/api", "http://backend/api/v1/"])
async def test_uses_versioned_renewal_route(monkeypatch, backend, renewal, proof_headers, api_url):
    backend.API_URL = api_url
    def handler(request):
        assert str(request.url) == "http://backend/api/v1/connectors/internal/mcp-token"
        return httpx.Response(200, json={"token": assertion(), "expiresAt": int(time.time()) + 180, "serverUrl": "http://mcp:8027/mcp"})
    mock_backend(monkeypatch, handler)
    await renew_mcp_jwt("http://mcp:8027/mcp", renewal, proof_headers)


@pytest.mark.asyncio
@pytest.mark.parametrize("override", [
    {"serverUrl": "https://evil.example/mcp"}, {"serverUrl": "http://mcp:8027/MCP"},
    {"serverUrl": "http://mcp:8027/mcp?other=1"}, {"token": ""},
    {"token": "header\ninjection"}, {"expiresAt": 1}, {"expiresAt": "bad"},
])
async def test_rejects_invalid_renewal_responses(monkeypatch, backend, renewal, proof_headers, override):
    payload = {"token": "secret.jwt.value", "expiresAt": int(time.time()) + 180, "serverUrl": "http://mcp:8027/mcp", **override}
    mock_backend(monkeypatch, lambda request: httpx.Response(200, json=payload))
    with pytest.raises(RuntimeError, match="MCP JWT renewal failed") as error:
        await renew_mcp_jwt("http://mcp:8027/mcp", renewal, proof_headers)
    assert "secret.jwt.value" not in str(error.value)


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [401, 403, 503, 307])
async def test_backend_errors_and_redirects_fail_closed(monkeypatch, backend, renewal, proof_headers, status):
    mock_backend(monkeypatch, lambda request: httpx.Response(status, text="secret response", headers={"Location": "https://evil.example"}))
    with pytest.raises(RuntimeError, match="MCP JWT renewal failed"):
        await renew_mcp_jwt("http://mcp:8027/mcp", renewal, proof_headers)


@pytest.mark.asyncio
async def test_requires_deployment_secret_not_connector_or_legacy_secret(backend, renewal, proof_headers):
    backend.ADK_RUNTIME_MCP_RENEWAL_TOKEN = ""
    with pytest.raises(RuntimeError, match="ADK_RUNTIME_MCP_RENEWAL_TOKEN"):
        await renew_mcp_jwt("http://mcp:8027/mcp", renewal, proof_headers)


@pytest.mark.asyncio
@pytest.mark.parametrize("headers", [
    {}, {"Authorization": "Bearer stale"}, {"Authorization": "Basic static"},
    {"Authorization": f"Bearer {assertion(-1)}"},
    {"Authorization": f"Bearer {assertion(connectorId='other')}"},
    {"Authorization": f"Bearer {assertion(securityRevision=0)}"},
    {"Authorization": f"Bearer {assertion()}", "authorization": f"Bearer {assertion()}"},
])
async def test_invalid_or_expired_proof_never_contacts_backend(monkeypatch, backend, renewal, headers):
    def forbidden(request):
        pytest.fail("Invalid proof must not reach backend")
    mock_backend(monkeypatch, forbidden)
    with pytest.raises(RuntimeError, match="rebind authenticated execution"):
        await renew_mcp_jwt("http://mcp:8027/mcp", renewal, headers)


@pytest.fixture
def sdk(monkeypatch):
    state = SimpleNamespace(requests=[], sessions=[], target=None, before_request=None)
    @asynccontextmanager
    async def stream(url, http_client):
        if state.before_request:
            state.before_request()
        request = http_client.build_request("POST", state.target or url)
        for hook in http_client.event_hooks["request"]:
            await hook(request)
        state.requests.append(request)
        assert http_client.follow_redirects is False
        yield (None, None, None)
    module = ModuleType("mcp.client.streamable_http")
    module.streamable_http_client = stream
    monkeypatch.setitem(sys.modules, "mcp.client.streamable_http", module)
    class Session:
        def __init__(self, *_args): state.sessions.append(self)
        async def __aenter__(self): return self
        async def __aexit__(self, *_args): pass
        async def initialize(self): pass
        async def call_tool(self, name, arguments):
            return SimpleNamespace(isError=False, content=[SimpleNamespace(type="text", text="ok")])
    mcp = ModuleType("mcp")
    mcp.ClientSession = Session
    monkeypatch.setitem(sys.modules, "mcp", mcp)
    return state


@pytest.mark.asyncio
async def test_valid_bootstrap_skips_renewal_and_uses_fresh_sessions(monkeypatch, renewal, proof_headers, sdk):
    from src.mcp import jwt_auth
    renew = AsyncMock(side_effect=AssertionError("Unnecessary initial renewal"))
    monkeypatch.setattr(jwt_auth, "renew_mcp_jwt", renew)
    for _ in range(2):
        result = await call_mcp_tool("streamable_http", "http://mcp:8027/mcp",
            {"headers": {"authorization": "Bearer editable", "Authorization": "Bearer editable"}},
            "find_records", {}, auth_headers=proof_headers, auth_env=renewal)
        assert result == "ok"
    renew.assert_not_awaited()
    assert len(sdk.sessions) == 2 and sdk.sessions[0] is not sdk.sessions[1]
    assert all(request.headers["Authorization"] == proof_headers["Authorization"] for request in sdk.requests)


@pytest.mark.asyncio
async def test_preexpiry_renews_with_current_bootstrap_proof(monkeypatch, renewal, sdk):
    from src.mcp import jwt_auth
    original = {"Authorization": f"Bearer {assertion(20)}"}
    renewed = {"Authorization": f"Bearer {assertion()}"}
    renew = AsyncMock(return_value=(renewed, int(time.time()) + 180))
    monkeypatch.setattr(jwt_auth, "renew_mcp_jwt", renew)
    result = await call_mcp_tool("streamable_http", "http://mcp:8027/mcp", {},
        "find_records", {}, auth_headers=original, auth_env=renewal)
    assert result == "ok"
    renew.assert_awaited_once_with("http://mcp:8027/mcp", renewal, original)
    assert sdk.requests[0].headers["Authorization"] == renewed["Authorization"]


@pytest.mark.asyncio
async def test_request_hook_renews_preexpiry(monkeypatch, renewal, proof_headers, sdk):
    from src.mcp import jwt_auth
    now = time.time()
    sdk.before_request = lambda: monkeypatch.setattr(time, "time", lambda: now + 160)
    renewed = {"Authorization": "Bearer renewed-jwt"}
    renew = AsyncMock(return_value=(renewed, int(now) + 300))
    monkeypatch.setattr(jwt_auth, "renew_mcp_jwt", renew)
    result = await call_mcp_tool("streamable_http", "http://mcp:8027/mcp", {},
        "find_records", {}, auth_headers=proof_headers, auth_env=renewal)
    assert result == "ok"
    renew.assert_awaited_once_with("http://mcp:8027/mcp", renewal, proof_headers)
    assert sdk.requests[0].headers["Authorization"] == "Bearer renewed-jwt"


@pytest.mark.asyncio
@pytest.mark.parametrize("target", ["https://evil.example/mcp", "http://mcp:8027/MCP", "http://mcp:8027/mcp?x=1"])
async def test_hook_refuses_different_destination(renewal, proof_headers, sdk, target):
    sdk.target = target
    result = await call_mcp_tool("streamable_http", "http://mcp:8027/mcp", {},
        "find_records", {}, auth_headers=proof_headers, auth_env=renewal)
    assert "Refusing to forward" in result or "Invalid MCP server URL" in result
    assert not sdk.requests and not sdk.sessions


@pytest.mark.asyncio
async def test_expired_bootstrap_requires_rebinding(renewal, sdk):
    result = await call_mcp_tool("streamable_http", "http://mcp:8027/mcp", {},
        "find_records", {}, auth_headers={"Authorization": f"Bearer {assertion(-1)}"}, auth_env=renewal)
    assert "assertion expired; rebind authenticated execution" in result
    assert not sdk.requests and not sdk.sessions


@pytest.mark.asyncio
async def test_editable_static_authorization_cannot_bootstrap(renewal, sdk):
    result = await call_mcp_tool("streamable_http", "http://mcp:8027/mcp",
        {"headers": {"Authorization": f"Bearer {assertion()}"}}, "find_records", {}, auth_env=renewal)
    assert "requires a current assertion" in result
    assert not sdk.requests and not sdk.sessions


def test_neutral_client_does_not_replace_installed_sdk():
    from pathlib import Path
    import mcp
    import src.mcp
    assert mcp is not src.mcp
    assert "site-packages" in str(Path(mcp.__file__).resolve())
    local_src = Path(__file__).resolve().parents[2] / "src"
    assert all(Path(entry).resolve() != local_src for entry in sys.path)


@pytest.mark.asyncio
@pytest.mark.parametrize("claims", [{"connectorId": "other"}, {"securityRevision": None}, {"exp": 1}])
async def test_renewed_proof_must_retain_valid_scheduling_claims(monkeypatch, backend, renewal, proof_headers, claims):
    mock_backend(monkeypatch, lambda request: httpx.Response(200, json={
        "token": assertion(**claims), "expiresAt": int(time.time()) + 180,
        "serverUrl": "http://mcp:8027/mcp",
    }))
    with pytest.raises(RuntimeError, match="MCP JWT renewal failed"):
        await renew_mcp_jwt("http://mcp:8027/mcp", renewal, proof_headers)


@pytest.mark.asyncio
async def test_external_sse_bearer_preserves_headers_and_fresh_sessions(monkeypatch):
    seen, sessions = [], []
    @asynccontextmanager
    async def stream(url, headers, httpx_client_factory):
        seen.append((url, headers))
        yield (None, None)
    module = ModuleType("mcp.client.sse")
    module.sse_client = stream
    monkeypatch.setitem(sys.modules, "mcp.client.sse", module)
    class Session:
        def __init__(self, *_args): sessions.append(self)
        async def __aenter__(self): return self
        async def __aexit__(self, *_args): pass
        async def initialize(self): pass
        async def call_tool(self, name, arguments):
            assert name == "external_search" and arguments == {"query": "fixture"}
            return SimpleNamespace(isError=False, content=[SimpleNamespace(type="text", text="ok")])
    mcp = ModuleType("mcp")
    mcp.ClientSession = Session
    monkeypatch.setitem(sys.modules, "mcp", mcp)
    for _ in range(2):
        assert await call_mcp_tool("sse", "https://external.test/sse",
            {"headers": {"X-Gateway": "kept"}}, "external_search", {"query": "fixture"},
            auth_headers={"Authorization": "Bearer external-opaque"}) == "ok"
    assert seen == [("https://external.test/sse", {"Authorization": "Bearer external-opaque", "X-Gateway": "kept"})] * 2
    assert len(sessions) == 2 and sessions[0] is not sessions[1]


@pytest.mark.asyncio
async def test_expiry_between_bootstrap_and_request_does_not_renew_identity(monkeypatch, backend, renewal, proof_headers, sdk):
    now = time.time()
    sdk.before_request = lambda: monkeypatch.setattr(time, "time", lambda: now + 200)
    def forbidden(request):
        pytest.fail("Expired proof must not be sent to renewal backend")
    mock_backend(monkeypatch, forbidden)
    result = await call_mcp_tool("streamable_http", "http://mcp:8027/mcp", {},
        "find_records", {}, auth_headers=proof_headers, auth_env=renewal)
    assert "assertion expired; rebind authenticated execution" in result
    assert not sdk.sessions and not sdk.requests


@pytest.mark.asyncio
@pytest.mark.parametrize("transport", ["streamable_http", "sse"])
async def test_real_sdk_redirect_never_sends_credential_canary(monkeypatch, transport, caplog):
    # Actual installed SDK and real httpx request pipeline; no network/socket.
    seen = []
    canary = "credential-canary-redirect"
    query_secret = "url-secret-canary"
    client_class = httpx.AsyncClient
    def handler(request):
        seen.append(request)
        assert request.url.host == "authorized.test"
        assert request.headers["Authorization"] == f"Bearer {canary}"
        return httpx.Response(307, headers={"Location": "https://attacker.test/steal"})
    class client(client_class):
        def __init__(self, **kwargs):
            super().__init__(transport=httpx.MockTransport(handler), **kwargs)
    monkeypatch.setattr(httpx, "AsyncClient", client)
    result = await call_mcp_tool(transport, f"https://authorized.test/mcp?key={query_secret}", {},
        "canary", {}, auth_headers={"Authorization": f"Bearer {canary}", "X-Api-Key": canary})
    assert len(seen) == 1
    assert "failed" in result
    assert canary not in result and query_secret not in result
    assert canary not in caplog.text and query_secret not in caplog.text


@pytest.mark.asyncio
async def test_real_sse_foreign_event_endpoint_never_receives_canary(monkeypatch, caplog):
    import asyncio
    seen = []
    canary = "sse-foreign-canary"
    client_class = httpx.AsyncClient
    def handler(request):
        seen.append(request)
        assert request.url.host == "authorized.test"
        return httpx.Response(200, headers={"Content-Type": "text/event-stream"},
            content=b"event: endpoint\ndata: https://attacker.test/messages?secret=url-canary\n\n")
    class client(client_class):
        def __init__(self, **kwargs):
            super().__init__(transport=httpx.MockTransport(handler), **kwargs)
    monkeypatch.setattr(httpx, "AsyncClient", client)
    try:
        result = await asyncio.wait_for(call_mcp_tool("sse", "https://authorized.test/sse", {}, "canary", {},
            auth_headers={"Authorization": f"Bearer {canary}"}), timeout=1)
    except asyncio.TimeoutError:
        # SDK may wait for initialization after rejecting the endpoint event.
        result = "failed: bounded initialization timeout"
    assert len(seen) == 1 and "failed" in result
    assert canary not in result + caplog.text and "url-canary" not in result + caplog.text


@pytest.mark.asyncio
@pytest.mark.parametrize("foreign", [False, True])
async def test_sse_factory_guards_post_origin_before_headers(monkeypatch, sdk, foreign):
    seen = []
    client_class = httpx.AsyncClient
    def handler(request):
        seen.append(request)
        assert request.headers["X-Api-Key"] == "factory-canary"
        return httpx.Response(200)
    class client(client_class):
        def __init__(self, **kwargs):
            super().__init__(transport=httpx.MockTransport(handler), **kwargs)
    monkeypatch.setattr(httpx, "AsyncClient", client)
    @asynccontextmanager
    async def stream(url, headers, httpx_client_factory):
        async with httpx_client_factory(headers=headers) as http_client:
            assert "X-Api-Key" not in http_client.headers
            assert http_client.follow_redirects is False
            host = "attacker.test" if foreign else "authorized.test"
            await http_client.post(f"https://{host}/messages?session=allowed")
            yield None, None
    module = ModuleType("mcp.client.sse")
    module.sse_client = stream
    monkeypatch.setitem(sys.modules, "mcp.client.sse", module)
    result = await call_mcp_tool("sse", "https://authorized.test/sse?key=configured", {}, "canary", {},
        auth_headers={"X-Api-Key": "factory-canary"})
    assert len(seen) == (0 if foreign else 1)
    assert ("Refusing to forward" in result) if foreign else result == "ok"
