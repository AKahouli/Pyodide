import pytest
from fastmcp import Client

import server
from auth import PlatformActorContext, actor_context
from server import mcp


class BackendStub:
    def __init__(self, response=None, error=None):
        self._response = response
        self._error = error
        self.payloads = []

    async def execute(self, payload):
        self.payloads.append(payload)
        if self._error is not None:
            raise self._error
        return self._response


def result_dict(response):
    if response.structured_content is not None:
        return response.structured_content
    data = response.data
    while hasattr(data, "root"):
        data = data.root
    if hasattr(data, "model_dump"):
        return data.model_dump()
    return data


def actor_headers():
    return actor_context.set(PlatformActorContext("user-1", "agent-1", "conversation-1", "correlation-1"))


@pytest.mark.asyncio
async def test_registers_only_execute_python():
    async with Client(mcp) as client:
        tools = await client.list_tools()
    assert {tool.name for tool in tools} == {"execute_python"}


@pytest.mark.asyncio
async def test_execute_python_never_exposes_identity_arguments():
    async with Client(mcp) as client:
        tools = await client.list_tools()
    properties = set(tools[0].inputSchema["properties"])
    assert properties == {"code", "input", "timeout_seconds"}
    assert not properties.intersection({"user_id", "browser_runtime_id", "socket_id", "execution_id", "correlation_id"})


@pytest.mark.asyncio
async def test_execute_python_relays_the_bounded_payload(monkeypatch):
    stub = BackendStub(response={"ok": True, "stdout": "2\n", "stderr": "", "execution": {"runtime": "pyodide"}})
    monkeypatch.setattr(server, "backend", lambda: stub)
    token = actor_headers()
    try:
        async with Client(mcp) as client:
            response = await client.call_tool("execute_python", {"code": "print(1 + 1)", "input": {"a": 1}})
    finally:
        actor_context.reset(token)

    assert stub.payloads == [{"code": "print(1 + 1)", "input": {"a": 1}, "timeoutMs": 30000}]
    assert result_dict(response)["stdout"] == "2\n"


@pytest.mark.asyncio
async def test_execute_python_rejects_oversized_code(monkeypatch):
    stub = BackendStub(response={"ok": True})
    monkeypatch.setattr(server, "backend", lambda: stub)
    token = actor_headers()
    try:
        async with Client(mcp) as client:
            response = await client.call_tool("execute_python", {"code": "x" * (server.settings.max_code_bytes + 1)})
    finally:
        actor_context.reset(token)

    assert result_dict(response)["error"]["code"] == "PYODIDE_REQUEST_TOO_LARGE"
    assert stub.payloads == []


@pytest.mark.asyncio
async def test_execute_python_rejects_timeout_above_maximum(monkeypatch):
    stub = BackendStub(response={"ok": True})
    monkeypatch.setattr(server, "backend", lambda: stub)
    token = actor_headers()
    try:
        async with Client(mcp) as client:
            response = await client.call_tool("execute_python", {"code": "1", "timeout_seconds": 999})
    finally:
        actor_context.reset(token)

    assert result_dict(response)["error"]["code"] == "PYODIDE_EXECUTION_ERROR"
    assert stub.payloads == []


@pytest.mark.asyncio
async def test_execute_python_rejects_a_missing_trusted_actor(monkeypatch):
    stub = BackendStub(response={"ok": True})
    monkeypatch.setattr(server, "backend", lambda: stub)
    token = actor_context.set(None)
    try:
        async with Client(mcp) as client:
            response = await client.call_tool("execute_python", {"code": "1"})
    finally:
        actor_context.reset(token)

    assert result_dict(response)["error"]["code"] == "PYODIDE_EXECUTION_ERROR"
    assert stub.payloads == []


@pytest.mark.asyncio
async def test_execute_python_maps_backend_failure_to_cleaned_error(monkeypatch):
    from clients.yellowstorm_pyodide_client import PyodideBackendError

    stub = BackendStub(error=PyodideBackendError("PYODIDE_RUNTIME_OFFLINE", "runtime offline"))
    monkeypatch.setattr(server, "backend", lambda: stub)
    token = actor_headers()
    try:
        async with Client(mcp) as client:
            response = await client.call_tool("execute_python", {"code": "1"})
    finally:
        actor_context.reset(token)

    assert result_dict(response)["error"]["code"] == "PYODIDE_RUNTIME_OFFLINE"
