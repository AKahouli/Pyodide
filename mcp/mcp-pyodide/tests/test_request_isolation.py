"""Exercise the production entrypoint and downstream identity, not a toy MCP."""
import asyncio
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
                  actor_context, input_file_names, verified_mcp_jwt, workspace_id)


def signed(keys, user="65f000000000000000000001"):
    now = int(time.time())
    return jwt.encode(dict(sub=user, iss="yellowstorm", aud="mcp-pyodide",
                           iat=now, exp=now + 300), keys[0], algorithm="RS256")


def identity():
    return (acting_user_id.get(), actor_context.get(), verified_mcp_jwt.get(),
            workspace_id.get(), input_file_names.get(), get_contextvars())


def middleware(app, keys):
    return TrustedIdentityMiddleware(app, jwt_public_key=keys[1],
                                     jwt_issuer="yellowstorm", jwt_audience="mcp-pyodide")


@pytest.mark.asyncio
@pytest.mark.parametrize("outcome", ["success", "reject", "invalid", "error", "cancel", "setup-error"])
async def test_nested_context_is_restored(keys, outcome, monkeypatch):
    outer = PlatformActorContext("outer", "agent", "conversation", "request")
    tokens = [acting_user_id.set("outer"), actor_context.set(outer),
              verified_mcp_jwt.set("outer-assertion"), workspace_id.set("65f0000000000000000000aa"),
              input_file_names.set(("outer.txt",))]
    logs = bind_contextvars(username="outer", agent_id="outer-agent", conversation_id="outer-conversation",
                            request_id="outer-request", unrelated="preserved")
    before = identity()
    assertion = signed(keys)
    called = []

    async def app(scope, receive, send):
        called.append(True)
        assert acting_user_id.get() == "65f000000000000000000001"
        assert verified_mcp_jwt.get() == assertion
        assert get_contextvars()["username"] == "65f000000000000000000001"
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
        headers.append((b"x-yellowstorm-user-id", b"65f000000000000000000002"))
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
        for var, token in ((acting_user_id, tokens[0]), (actor_context, tokens[1]),
                           (verified_mcp_jwt, tokens[2]), (workspace_id, tokens[3]),
                            (input_file_names, tokens[4])):
            var.reset(token)


@pytest.mark.asyncio
async def test_workspace_parser_failure_leaves_no_partial_identity(keys):
    outer = PlatformActorContext("outer", "agent", "conversation", "request")
    tokens = [acting_user_id.set("outer"), actor_context.set(outer),
              verified_mcp_jwt.set("outer-assertion"), workspace_id.set("65f0000000000000000000aa"),
              input_file_names.set(("outer.txt",))]
    before = identity()
    assertion = signed(keys)
    called = []

    async def app(scope, receive, send):
        called.append(True)

    # A deeply nested JSON array makes json.loads raise RecursionError inside the
    # workspace-id parser; nothing may be installed behind the cleanup boundary.
    deep = ("[" * 100000) + ("]" * 100000)
    scope = dict(type="http", path="/mcp", headers=[
        (b"authorization", f"Bearer {assertion}".encode()),
        (b"workspace_id", deep.encode()),
    ])
    try:
        with pytest.raises(RecursionError):
            await middleware(app, keys)(scope, None, None)
        assert not called
        assert identity() == before
    finally:
        for var, token in ((acting_user_id, tokens[0]), (actor_context, tokens[1]),
                           (verified_mcp_jwt, tokens[2]), (workspace_id, tokens[3]),
                           (input_file_names, tokens[4])):
            var.reset(token)


@pytest.mark.asyncio
async def test_real_task_cancellation_unwinds_nested_requests(keys):
    entered = asyncio.Event()
    restored = []
    baseline = identity()

    def scope(user):
        return dict(type="http", path="/mcp", headers=[
            (b"authorization", f"Bearer {signed(keys, user)}".encode())])

    async def inner_app(scope, receive, send):
        assert acting_user_id.get() == "65f000000000000000000002"
        entered.set()
        await asyncio.Future()

    async def outer_app(scope_, receive, send):
        before = identity()
        assert before[0] == "65f000000000000000000001"
        try:
            await middleware(inner_app, keys)(scope("65f000000000000000000002"), receive, send)
        finally:
            restored.append(identity() == before)

    async def request():
        try:
            await middleware(outer_app, keys)(scope("65f000000000000000000001"), None, None)
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
async def test_production_stateless_entrypoint_mounts_jwt_middleware(keys, monkeypatch, tmp_path):
    public_file = tmp_path / "public.pem"
    public_file.write_text(keys[1], encoding="utf-8")
    from config import Settings
    settings = SimpleNamespace(validate=lambda: None,
        jwt_public_key_file=str(public_file), jwt_issuer="yellowstorm", jwt_audience="mcp-pyodide",
        host="0.0.0.0", port=8027, transport="streamable-http")
    monkeypatch.setattr(Settings, "from_env", lambda: settings)
    launched = {}
    monkeypatch.setattr(FastMCP, "run", lambda self, **kw: launched.update(server=self, **kw))
    try:  # Keep the real observability setup out of the test run when installed.
        import yellowmind_observability
        monkeypatch.setattr(yellowmind_observability, "setup_observability", lambda **kw: None)
    except ImportError:  # pragma: no cover - bare test installs use the local fallback
        pass
    runpy.run_path(str(Path(__file__).parents[1] / "server.py"), run_name="__main__")
    assert launched["transport"] == "streamable-http"
    assert launched.get("stateless_http") is True
    app = launched["server"].http_app(stateless_http=launched["stateless_http"],
                                      middleware=launched["middleware"])
    initialization = {"protocolVersion": "2025-03-26", "capabilities": {},
                      "clientInfo": {"name": "regression", "version": "1"}}
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://mcp") as client:
            for path in ("/health/live", "/health/ready"):
                response = await client.get(path)
                assert response.status_code == 200
            for headers in ({}, {"Authorization": "Bearer invalid"},
                            {"Authorization": f"Bearer {signed(keys)}", "X-YellowStorm-User-Id": "65f0000000000000000000ff"}):
                response = await client.post("/mcp", headers=headers, json={
                    "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": initialization})
                assert response.status_code == 401
            response = await client.post("/mcp", headers={
                "Authorization": f"Bearer {signed(keys)}",
                "Accept": "application/json, text/event-stream",
                "MCP-Protocol-Version": "2025-03-26",
            }, json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": initialization})
            assert response.status_code == 200, response.text
            # Stateless mode: no server-managed session is issued.
            assert "mcp-session-id" not in response.headers
