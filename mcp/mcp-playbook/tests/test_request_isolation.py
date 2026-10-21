"""Exercise the production entrypoint and downstream identity, not a toy MCP."""
import asyncio
import json
import runpy
import time
from pathlib import Path
from types import SimpleNamespace

import httpx
import jwt
import pytest
from fastmcp import FastMCP
from structlog.contextvars import bind_contextvars, get_contextvars, reset_contextvars

from auth import (PlatformActorContext, TrustedIdentityMiddleware, acting_user_id,
                  actor_context, verified_mcp_jwt)
from clients.yellowstorm_playbook_client import YellowStormPlaybookClient
from test_jwt_auth import keys


def signed(keys, user, generation=0):
    now = int(time.time())
    return jwt.encode(dict(sub=user, iss="yellowstorm", aud="mcp-playbook",
                           iat=now, exp=now + 300, jti=str(generation)), keys[0], algorithm="RS256")


def identity():
    return acting_user_id.get(), actor_context.get(), verified_mcp_jwt.get(), get_contextvars()


def middleware(app, keys):
    return TrustedIdentityMiddleware(app, "", auth_mode="JWT", jwt_public_key=keys[1],
                                     jwt_issuer="yellowstorm")


@pytest.mark.asyncio
@pytest.mark.parametrize("outcome", ["success", "reject", "invalid", "error", "cancel", "setup-error"])
async def test_nested_context_is_restored(keys, outcome, monkeypatch):
    outer = PlatformActorContext("outer", "agent", "conversation", "request")
    tokens = [acting_user_id.set("outer"), actor_context.set(outer), verified_mcp_jwt.set("outer-assertion")]
    logs = bind_contextvars(username="outer", agent_id="outer-agent", conversation_id="outer-conversation",
                            request_id="outer-request", unrelated="preserved")
    before = identity()
    assertion = signed(keys, "alice")
    called = []

    async def app(scope, receive, send):
        called.append(True)
        assert acting_user_id.get() == "alice"
        assert verified_mcp_jwt.get() == assertion
        assert get_contextvars()["username"] == "alice"
        if outcome == "error":
            raise RuntimeError("downstream")
        if outcome == "cancel":
            raise asyncio.CancelledError()

    async def send(message):
        assert message.get("status", 401) == 401

    if outcome == "setup-error":
        def fail_bind(**kwargs):
            raise RuntimeError("logging setup")
        monkeypatch.setattr("auth.bind_contextvars", fail_bind)
    headers = [(b"authorization", f"Bearer {assertion}".encode())]
    if outcome == "reject":
        headers.append((b"x-yellowstorm-user-id", b"bob"))
    if outcome == "invalid":
        headers = [(b"authorization", b"Bearer invalid")]
    try:
        if outcome in ("error", "setup-error", "cancel"):
            with pytest.raises(asyncio.CancelledError if outcome == "cancel" else RuntimeError):
                await middleware(app, keys)(dict(type="http", path="/mcp", headers=headers), None, send)
        else:
            await middleware(app, keys)(dict(type="http", path="/mcp", headers=headers), None, send)
        assert bool(called) == (outcome not in ("reject", "invalid", "setup-error"))
        assert identity() == before
    finally:
        reset_contextvars(**logs)
        acting_user_id.reset(tokens[0])
        actor_context.reset(tokens[1])
        verified_mcp_jwt.reset(tokens[2])


@pytest.mark.asyncio
async def test_real_task_cancellation_unwinds_nested_requests(keys):
    entered = asyncio.Event()
    restored = []
    baseline = identity()

    def scope(user):
        return dict(type="http", path="/mcp", headers=[
            (b"authorization", f"Bearer {signed(keys, user)}".encode())])

    async def inner_app(scope, receive, send):
        assert acting_user_id.get() == "bob"
        entered.set()
        await asyncio.Future()

    async def outer_app(scope_, receive, send):
        before = identity()
        assert before[0] == "alice"
        try:
            await middleware(inner_app, keys)(scope("bob"), receive, send)
        finally:
            restored.append(identity() == before)

    async def request():
        try:
            await middleware(outer_app, keys)(scope("alice"), None, None)
        finally:
            restored.append(identity() == baseline)

    task = asyncio.create_task(request())
    try:
        await asyncio.wait_for(entered.wait(), timeout=5)
    finally:
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    assert restored == [True, True]
    assert identity() == baseline


@pytest.mark.asyncio
async def test_production_stateless_transport_isolates_actors_and_renewal(keys, monkeypatch, tmp_path):
    seen = []

    async def backend_handler(request):
        await asyncio.sleep(0)
        assertion = request.headers["x-yellowstorm-mcp-assertion"]
        actor = jwt.decode(assertion, keys[1], algorithms=["RS256"], issuer="yellowstorm", audience="mcp-playbook")["sub"]
        assert "x-yellowstorm-service-token" not in request.headers
        assert "x-yellowstorm-user-id" not in request.headers
        seen.append((actor, assertion))
        return httpx.Response(200, json={"playbooks": []})

    backend = YellowStormPlaybookClient("http://backend", transport=httpx.MockTransport(backend_handler))
    from config import Settings
    import clients.yellowstorm_playbook_client as client_module
    public_file = tmp_path / "public.pem"
    public_file.write_text(keys[1], encoding="utf-8")
    settings = SimpleNamespace(validate=lambda: None, auth_mode="JWT", ingress_token="",
        jwt_public_key_file=str(public_file), jwt_issuer="yellowstorm", jwt_audience="mcp-playbook",
        port=8025, backend_url="http://backend", timeout_seconds=190,
        max_response_bytes=2097152, search_limit_max=25)
    monkeypatch.setattr(Settings, "from_env", lambda: settings)
    class MockBackendClient(YellowStormPlaybookClient):
        def __new__(cls, *args, **kwargs):
            return backend

    monkeypatch.setattr(client_module, "YellowStormPlaybookClient", MockBackendClient)
    launched = {}
    monkeypatch.setattr(FastMCP, "run", lambda self, **kw: launched.update(server=self, **kw))
    import yellowmind_observability
    monkeypatch.setattr(yellowmind_observability, "setup_observability", lambda **kw: None)
    monkeypatch.setenv("HOST", "127.0.0.1")
    try:
        runpy.run_path(str(Path(__file__).parents[1] / "server.py"), run_name="__main__")
        assert launched["transport"] == "streamable-http"
        assert launched.get("stateless_http") is True
        app = launched["server"].http_app(stateless_http=launched["stateless_http"], middleware=launched["middleware"])
        baseline = identity()
        initialization = {"protocolVersion": "2025-03-26", "capabilities": {},
                          "clientInfo": {"name": "regression", "version": "1"}}
        legacy = launched["server"].http_app(stateless_http=False, middleware=launched["middleware"])
        async with legacy.router.lifespan_context(legacy):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=legacy), base_url="http://legacy") as old:
                response = await old.post("/mcp", headers={"Authorization": f"Bearer {signed(keys, 'alice')}",
                    "Accept": "application/json, text/event-stream"}, json={"jsonrpc": "2.0", "id": 1,
                    "method": "initialize", "params": initialization})
                assert response.status_code == 200
                foreign_session = response.headers["mcp-session-id"]
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://mcp") as client:
                async def rpc(user, method, params, generation=0, session=None):
                    assertion = signed(keys, user, generation)
                    headers = {"Authorization": f"Bearer {assertion}", "Accept": "application/json, text/event-stream",
                               "MCP-Protocol-Version": "2025-03-26"}
                    if session:
                        headers["Mcp-Session-Id"] = session
                    response = await client.post("/mcp", headers=headers, json={
                        "jsonrpc": "2.0", "id": generation + 1, "method": method, "params": params})
                    assert response.status_code == 200, response.text
                    assert response.headers["content-type"].startswith("text/event-stream")
                    assert "mcp-session-id" not in response.headers
                    data = [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith("data: ")]
                    assert data and "result" in data[-1] and not data[-1]["result"].get("isError"), response.text
                    assert identity() == baseline
                    return assertion

                await rpc("alice", "initialize", initialization)
                await rpc("bob", "tools/list", {})
                params = {"name": "search_playbooks", "arguments": {}}
                alice, bob = await asyncio.gather(rpc("alice", "tools/call", params),
                    rpc("bob", "tools/call", params, session=foreign_session))
                renewed = await rpc("alice", "tools/call", params, 1, session=foreign_session)
                assert sorted(seen[:2]) == sorted([("alice", alice), ("bob", bob)])
                assert seen[2] == ("alice", renewed) and renewed != alice
                for headers in ({}, {"Authorization": "Bearer invalid"},
                    {"Authorization": f"Bearer {bob}", "X-YellowStorm-User-Id": "alice"}):
                    response = await client.post("/mcp", headers=headers, json={
                        "jsonrpc": "2.0", "id": 9, "method": "tools/call", "params": params})
                    assert response.status_code == 401
                assert len(seen) == 3
                assert identity() == baseline
    finally:
        await backend.close()
