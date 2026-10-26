import httpx
import pytest

from auth import (PlatformActorContext, actor_context, input_file_names,
                  verified_mcp_jwt, workspace_id)
from clients.yellowstorm_pyodide_client import PyodideBackendError, YellowStormPyodideClient


def actor(token="65f000000000000000000001"):
    return [
        (actor_context, PlatformActorContext(token, "agent-1", "conversation-1", "correlation-1")),
        (verified_mcp_jwt, "assertion-jwt"),
    ]


def apply(tokens):
    set_tokens = [var.set(value) for var, value in tokens]
    return tokens, set_tokens


def restore(tokens, set_tokens):
    for (var, _value), token in zip(tokens, set_tokens):
        var.reset(token)


@pytest.mark.asyncio
async def test_forwards_assertion_and_tracing_headers_without_retired_credentials():
    seen = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        seen["assertion"] = request.headers["X-YellowStorm-Mcp-Assertion"]
        seen["agent"] = request.headers["X-YellowStorm-Agent-Id"]
        seen["conversation"] = request.headers["X-YellowStorm-Conversation-Id"]
        seen["correlation"] = request.headers["X-Correlation-Id"]
        seen["body"] = request.content.decode()
        return httpx.Response(200, json={"ok": True, "stdout": "1\n", "stderr": "", "execution": {"runtime": "pyodide"}})

    tokens, set_tokens = apply(actor())
    try:
        client = YellowStormPyodideClient("http://backend", transport=httpx.MockTransport(handler))
        result = await client.execute({"code": "1 + 1", "input": None, "timeoutMs": 30000})
        await client.close()
    finally:
        restore(tokens, set_tokens)

    assert seen["path"] == "/api/v1/internal/pyodide-runtime/execute"
    assert seen["assertion"] == "assertion-jwt"
    assert seen["agent"] == "agent-1"
    assert seen["conversation"] == "conversation-1"
    assert seen["correlation"] == "correlation-1"
    assert result["ok"] is True


@pytest.mark.asyncio
async def test_never_sends_user_id_or_internal_token_headers():
    seen = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        seen["user"] = request.headers.get("X-YellowStorm-User-Id")
        seen["internal"] = request.headers.get("X-Internal-Token")
        seen["assertion"] = request.headers.get("X-YellowStorm-Mcp-Assertion")
        return httpx.Response(200, json={"ok": True})

    assertion = "signed-assertion-jwt"
    tokens = [
        (actor_context, PlatformActorContext("65f000000000000000000001", "", "", "correlation-1")),
        (verified_mcp_jwt, assertion),
    ]
    set_tokens = [var.set(value) for var, value in tokens]
    try:
        client = YellowStormPyodideClient("http://backend", transport=httpx.MockTransport(handler))
        await client.execute({"code": "1", "input": None, "timeoutMs": 1000})
        await client.close()
    finally:
        restore(tokens, set_tokens)

    assert seen["user"] is None
    assert seen["internal"] is None
    assert seen["assertion"] == assertion


@pytest.mark.asyncio
async def test_fails_closed_without_a_verified_assertion():
    async def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"ok": True})

    token = actor_context.set(PlatformActorContext("user-1", "", "", "correlation-1"))
    try:
        client = YellowStormPyodideClient("http://backend", transport=httpx.MockTransport(handler))
        with pytest.raises(PyodideBackendError) as error:
            await client.execute({"code": "1", "input": None, "timeoutMs": 1000})
        await client.close()
    finally:
        actor_context.reset(token)

    assert error.value.code == "PYODIDE_MCP_UNAUTHORIZED"


@pytest.mark.asyncio
async def test_forwards_the_trusted_workspace_header():
    seen = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        seen["workspace"] = request.headers.get("X-YellowStorm-Workspace-Id")
        return httpx.Response(200, json={"ok": True})

    tokens, set_tokens = apply(actor() + [(workspace_id, "65f0000000000000000000aa")])
    try:
        client = YellowStormPyodideClient("http://backend", transport=httpx.MockTransport(handler))
        await client.execute({"code": "1", "input": None, "timeoutMs": 1000})
        await client.close()
    finally:
        restore(tokens, set_tokens)

    assert seen["workspace"] == "65f0000000000000000000aa"


@pytest.mark.asyncio
async def test_forwards_trusted_input_file_names():
    seen = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        seen["files"] = request.headers.get("X-YellowStorm-Input-Files")
        return httpx.Response(200, json={"ok": True})

    tokens, set_tokens = apply(actor() + [(input_file_names, ("test_2.txt", "other.csv"))])
    try:
        client = YellowStormPyodideClient("http://backend", transport=httpx.MockTransport(handler))
        await client.execute({"code": "1", "input": None, "timeoutMs": 1000})
        await client.close()
    finally:
        restore(tokens, set_tokens)

    assert seen["files"] == "test_2.txt,other.csv"


@pytest.mark.asyncio
async def test_omits_optional_tracing_headers_when_absent():
    seen = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        seen["agent"] = request.headers.get("X-YellowStorm-Agent-Id")
        seen["conversation"] = request.headers.get("X-YellowStorm-Conversation-Id")
        seen["workspace"] = request.headers.get("X-YellowStorm-Workspace-Id")
        seen["files"] = request.headers.get("X-YellowStorm-Input-Files")
        seen["correlation"] = request.headers.get("X-Correlation-Id")
        return httpx.Response(200, json={"ok": True})

    tokens = [
        (actor_context, PlatformActorContext("user-1", "", "", "correlation-1")),
        (verified_mcp_jwt, "assertion-jwt"),
    ]
    set_tokens = [var.set(value) for var, value in tokens]
    try:
        client = YellowStormPyodideClient("http://backend", transport=httpx.MockTransport(handler))
        await client.execute({"code": "1", "input": None, "timeoutMs": 1000})
        await client.close()
    finally:
        restore(tokens, set_tokens)

    assert seen["agent"] is None
    assert seen["conversation"] is None
    assert seen["workspace"] is None
    assert seen["files"] is None
    assert seen["correlation"] == "correlation-1"


@pytest.mark.asyncio
async def test_normalizes_backend_error():
    async def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(409, json={"error": {"code": "PYODIDE_RUNTIME_BUSY", "message": "busy"}})

    tokens, set_tokens = apply(actor())
    try:
        client = YellowStormPyodideClient("http://backend", transport=httpx.MockTransport(handler))
        with pytest.raises(PyodideBackendError) as error:
            await client.execute({"code": "1", "input": None, "timeoutMs": 1000})
        await client.close()
    finally:
        restore(tokens, set_tokens)

    assert error.value.code == "PYODIDE_RUNTIME_BUSY"


@pytest.mark.asyncio
async def test_normalizes_a_non_object_error_body():
    async def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"statusCode": 404, "message": "Cannot POST", "error": "Not Found"})

    tokens, set_tokens = apply(actor())
    try:
        client = YellowStormPyodideClient("http://backend", transport=httpx.MockTransport(handler))
        with pytest.raises(PyodideBackendError) as error:
            await client.execute({"code": "1", "input": None, "timeoutMs": 1000})
        await client.close()
    finally:
        restore(tokens, set_tokens)

    assert error.value.code == "PYODIDE_EXECUTION_ERROR"
    assert "Not Found" in str(error.value)


@pytest.mark.asyncio
async def test_rejects_oversized_response():
    async def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"x" * 4096)

    tokens, set_tokens = apply(actor())
    try:
        client = YellowStormPyodideClient("http://backend", max_response_bytes=1024,
                                          transport=httpx.MockTransport(handler))
        with pytest.raises(PyodideBackendError) as error:
            await client.execute({"code": "1", "input": None, "timeoutMs": 1000})
        await client.close()
    finally:
        restore(tokens, set_tokens)

    assert error.value.code == "PYODIDE_RESULT_TOO_LARGE"


@pytest.mark.asyncio
async def test_publish_output_relays_name_and_returns_receipt():
    seen = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        seen["body"] = request.content.decode()
        return httpx.Response(200, json={
            "ceph_path": "65f000000000000000000001/system_conversation-1/rapport.pdf",
            "filename": "rapport.pdf",
            "mime_type": "application/pdf",
            "size": 1234,
        })

    tokens, set_tokens = apply(actor())
    try:
        client = YellowStormPyodideClient("http://backend", transport=httpx.MockTransport(handler))
        receipt = await client.publish_output("rapport.pdf")
        await client.close()
    finally:
        restore(tokens, set_tokens)

    assert seen["path"] == "/api/v1/internal/pyodide-runtime/publish-output"
    assert seen["body"] == '{"name":"rapport.pdf"}'
    assert receipt["ceph_path"].endswith("/system_conversation-1/rapport.pdf")
