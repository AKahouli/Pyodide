import httpx
import pytest

from auth import PlatformActorContext, actor_context
from clients.yellowstorm_pyodide_client import PyodideBackendError, YellowStormPyodideClient


@pytest.mark.asyncio
async def test_forwards_internal_and_acting_user_headers_and_returns_result():
    seen = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        seen["token"] = request.headers["X-Internal-Token"]
        seen["user"] = request.headers["X-YellowStorm-User-Id"]
        seen["agent"] = request.headers["X-YellowStorm-Agent-Id"]
        seen["correlation"] = request.headers["X-Correlation-Id"]
        seen["body"] = request.content.decode()
        return httpx.Response(200, json={"ok": True, "stdout": "1\n", "stderr": "", "execution": {"runtime": "pyodide"}})

    token = actor_context.set(PlatformActorContext("user-1", "agent-1", "conversation-1", "correlation-1"))
    try:
        client = YellowStormPyodideClient("http://backend", "internal-secret", transport=httpx.MockTransport(handler))
        result = await client.execute({"code": "1 + 1", "input": None, "timeoutMs": 30000})
        await client.close()
    finally:
        actor_context.reset(token)

    assert seen["path"] == "/api/v1/internal/pyodide-runtime/execute"
    assert seen["token"] == "internal-secret"
    assert seen["user"] == "user-1"
    assert seen["agent"] == "agent-1"
    assert seen["correlation"] == "correlation-1"
    assert result["ok"] is True


@pytest.mark.asyncio
async def test_omits_optional_actor_headers_when_absent():
    seen = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        seen["agent"] = request.headers.get("X-YellowStorm-Agent-Id")
        seen["correlation"] = request.headers.get("X-Correlation-Id")
        return httpx.Response(200, json={"ok": True})

    token = actor_context.set(PlatformActorContext("user-1", "", "", ""))
    try:
        client = YellowStormPyodideClient("http://backend", "internal-secret", transport=httpx.MockTransport(handler))
        await client.execute({"code": "1", "input": None, "timeoutMs": 1000})
        await client.close()
    finally:
        actor_context.reset(token)

    assert seen["agent"] is None
    assert seen["correlation"] is None


@pytest.mark.asyncio
async def test_normalizes_backend_error():
    async def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(409, json={"error": {"code": "PYODIDE_RUNTIME_BUSY", "message": "busy"}})

    token = actor_context.set(PlatformActorContext("user-1", "", "", ""))
    try:
        client = YellowStormPyodideClient("http://backend", "internal-secret", transport=httpx.MockTransport(handler))
        with pytest.raises(PyodideBackendError) as error:
            await client.execute({"code": "1", "input": None, "timeoutMs": 1000})
        await client.close()
    finally:
        actor_context.reset(token)

    assert error.value.code == "PYODIDE_RUNTIME_BUSY"


@pytest.mark.asyncio
async def test_normalizes_a_non_object_error_body():
    async def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"statusCode": 404, "message": "Cannot POST", "error": "Not Found"})

    token = actor_context.set(PlatformActorContext("user-1", "", "", ""))
    try:
        client = YellowStormPyodideClient("http://backend", "internal-secret", transport=httpx.MockTransport(handler))
        with pytest.raises(PyodideBackendError) as error:
            await client.execute({"code": "1", "input": None, "timeoutMs": 1000})
        await client.close()
    finally:
        actor_context.reset(token)

    assert error.value.code == "PYODIDE_EXECUTION_ERROR"
    assert "Not Found" in str(error.value)


@pytest.mark.asyncio
async def test_rejects_oversized_response():
    async def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"x" * 4096)

    token = actor_context.set(PlatformActorContext("user-1", "", "", ""))
    try:
        client = YellowStormPyodideClient(
            "http://backend", "internal-secret", max_response_bytes=1024, transport=httpx.MockTransport(handler),
        )
        with pytest.raises(PyodideBackendError) as error:
            await client.execute({"code": "1", "input": None, "timeoutMs": 1000})
        await client.close()
    finally:
        actor_context.reset(token)

    assert error.value.code == "PYODIDE_RESULT_TOO_LARGE"
