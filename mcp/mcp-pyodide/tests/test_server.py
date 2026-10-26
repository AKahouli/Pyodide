import pytest
from fastmcp import Client
from types import SimpleNamespace

import server
from auth import PlatformActorContext, actor_context
from server import mcp


class BackendStub:
    def __init__(self, response=None, error=None, publication=None, publication_error=None):
        self._response = response
        self._error = error
        self._publication = publication
        self._publication_error = publication_error
        self.payloads = []
        self.published = []

    async def execute(self, payload):
        self.payloads.append(payload)
        if self._error is not None:
            raise self._error
        return self._response

    async def publish_output(self, name):
        self.published.append(name)
        if self._publication_error is not None:
            raise self._publication_error
        return self._publication


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
async def test_registers_execute_python_and_sandbox_tools():
    async with Client(mcp) as client:
        tools = await client.list_tools()
    assert {tool.name for tool in tools} == {
        "execute_python",
        "send_file_to_user_simple",
        "sandbox_create", "sandbox_info", "sandbox_destroy",
        "shell_exec", "file_read", "file_write", "file_list", "file_delete", "file_find",
        "send_file_to_user", "file_upload_base64", "file_download_base64",
    }


@pytest.mark.asyncio
async def test_execute_python_never_exposes_identity_arguments():
    async with Client(mcp) as client:
        tools = await client.list_tools()
    properties = set(tools[0].inputSchema["properties"])
    assert properties == {"code", "input", "timeout_seconds", "inputs", "outputs"}
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
async def test_send_file_to_user_simple_publishes_by_exact_name(monkeypatch):
    receipt = {
        "ceph_path": "user-1/system_conversation-1/rapport.pdf",
        "filename": "rapport.pdf",
        "mime_type": "application/pdf",
        "size": 1234,
    }
    stub = BackendStub(publication=receipt)
    monkeypatch.setattr(server, "backend", lambda: stub)
    token = actor_headers()
    try:
        async with Client(mcp) as client:
            response = await client.call_tool("send_file_to_user_simple", {"name": "rapport.pdf"})
    finally:
        actor_context.reset(token)

    assert stub.published == ["rapport.pdf"]
    assert result_dict(response) == receipt


@pytest.mark.asyncio
async def test_send_file_to_user_simple_rejects_paths(monkeypatch):
    stub = BackendStub()
    monkeypatch.setattr(server, "backend", lambda: stub)
    token = actor_headers()
    try:
        async with Client(mcp) as client:
            response = await client.call_tool("send_file_to_user_simple", {"name": "../escape.pdf"})
    finally:
        actor_context.reset(token)

    assert result_dict(response)["error"]["code"] == "PYODIDE_EXECUTION_ERROR"
    assert stub.published == []


@pytest.mark.asyncio
async def test_send_file_to_user_simple_requires_a_trusted_actor(monkeypatch):
    stub = BackendStub()
    monkeypatch.setattr(server, "backend", lambda: stub)
    async with Client(mcp) as client:
        response = await client.call_tool("send_file_to_user_simple", {"name": "rapport.pdf"})

    assert result_dict(response)["error"]["code"] == "PYODIDE_EXECUTION_ERROR"
    assert stub.published == []


@pytest.mark.asyncio
async def test_execute_python_relays_logical_file_references(monkeypatch):
    stub = BackendStub(response={"ok": True})
    monkeypatch.setattr(server, "backend", lambda: stub)
    token = actor_headers()
    try:
        async with Client(mcp) as client:
            await client.call_tool("execute_python", {
                "code": "1",
                "inputs": ["data.txt", "other.csv"],
                "outputs": ["result.csv"],
            })
    finally:
        actor_context.reset(token)

    assert stub.payloads == [{
        "code": "1",
        "input": None,
        "timeoutMs": 30000,
        "inputs": ["data.txt", "other.csv"],
        "outputs": ["result.csv"],
    }]


@pytest.mark.asyncio
async def test_execute_python_accepts_a_single_file_name_as_a_string(monkeypatch):
    stub = BackendStub(response={"ok": True})
    monkeypatch.setattr(server, "backend", lambda: stub)
    token = actor_headers()
    try:
        async with Client(mcp) as client:
            response = await client.call_tool(
                "execute_python",
                {"code": "1", "inputs": "data.txt", "outputs": "result.csv"},
            )
    finally:
        actor_context.reset(token)

    assert stub.payloads == [{
        "code": "1",
        "input": None,
        "timeoutMs": 30000,
        "inputs": ["data.txt"],
        "outputs": ["result.csv"],
    }]
    assert result_dict(response)["ok"] is True


@pytest.mark.asyncio
async def test_execute_python_rejects_paths_in_file_names(monkeypatch):
    stub = BackendStub(response={"ok": True})
    monkeypatch.setattr(server, "backend", lambda: stub)
    token = actor_headers()
    try:
        async with Client(mcp) as client:
            response = await client.call_tool("execute_python", {"code": "1", "outputs": ["../secret.csv"]})
    finally:
        actor_context.reset(token)

    assert result_dict(response)["error"]["code"] == "PYODIDE_EXECUTION_ERROR"
    assert stub.payloads == []


@pytest.mark.asyncio
async def test_execute_python_rejects_too_many_inputs(monkeypatch):
    stub = BackendStub(response={"ok": True})
    monkeypatch.setattr(server, "backend", lambda: stub)
    too_many = [f"f{i}.txt" for i in range(server.settings.max_input_files + 1)]
    token = actor_headers()
    try:
        async with Client(mcp) as client:
            response = await client.call_tool("execute_python", {"code": "1", "inputs": too_many})
    finally:
        actor_context.reset(token)

    assert result_dict(response)["error"]["code"] == "PYODIDE_REQUEST_TOO_LARGE"
    assert stub.payloads == []


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


@pytest.mark.asyncio
async def test_health_live_is_public_and_ready_validates_settings(monkeypatch):
    import httpx

    app = server.mcp.http_app()
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            live = await client.get("/health/live")
            assert live.status_code == 200
            assert live.json() == {"status": "ok"}

            monkeypatch.setattr(server, "settings", SimpleNamespace(validate=lambda: None))
            ready = await client.get("/health/ready")
            assert ready.status_code == 200
            assert ready.json() == {"status": "ready"}

            def broken():
                raise ValueError("missing key material")

            monkeypatch.setattr(server, "settings", SimpleNamespace(validate=broken))
            not_ready = await client.get("/health/ready")
            assert not_ready.status_code == 503
            assert not_ready.json() == {"status": "not_ready"}
