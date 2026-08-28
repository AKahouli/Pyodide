import logging
import sys
from types import ModuleType, SimpleNamespace
from typing import Any

import pytest

from src.flow_engine.mcp import call_mcp_tool


class _AsyncContext:
    def __init__(self, value: Any) -> None:
        self.value = value

    async def __aenter__(self) -> Any:
        return self.value

    async def __aexit__(self, exc_type: Any, exc: Any, traceback: Any) -> None:
        return None


class _ClientSession:
    def __init__(self, read_stream: Any, write_stream: Any) -> None:
        self.read_stream = read_stream
        self.write_stream = write_stream

    async def __aenter__(self) -> "_ClientSession":
        return self

    async def __aexit__(self, exc_type: Any, exc: Any, traceback: Any) -> None:
        return None

    async def initialize(self) -> None:
        return None

    async def call_tool(self, action_key: str, arguments: dict[str, Any]) -> Any:
        return SimpleNamespace(
            content=[SimpleNamespace(text='{"text": "ok", "sources": []}')],
            isError=False,
        )


class _ImageClientSession(_ClientSession):
    async def call_tool(self, action_key: str, arguments: dict[str, Any]) -> Any:
        return SimpleNamespace(
            content=[
                SimpleNamespace(text='{"text": "ok", "images": [{"image_content_index": 1}]}'),
                SimpleNamespace(type="image", data="YWJjMTIz", mimeType="image/png"),
            ],
            isError=False,
        )


class _SensitiveErrorClientSession(_ClientSession):
    async def call_tool(self, action_key: str, arguments: dict[str, Any]) -> Any:
        return SimpleNamespace(
            content=[SimpleNamespace(text="file not found: /mnt/workspace/private/report.pdf")],
            isError=True,
        )


class _StdioServerParameters:
    def __init__(self, **kwargs: Any) -> None:
        self.kwargs = kwargs


def _stdio_client(server_params: _StdioServerParameters) -> _AsyncContext:
    return _AsyncContext(("read", "write"))


class _ExceptionGroupContext:
    async def __aenter__(self) -> Any:
        raise ExceptionGroup(
            "transport failed",
            [RuntimeError("file not found: /mnt/workspace/private/report.pdf")],
        )

    async def __aexit__(self, exc_type: Any, exc: Any, traceback: Any) -> None:
        return None


def _failing_stdio_client(server_params: _StdioServerParameters) -> _ExceptionGroupContext:
    return _ExceptionGroupContext()


@pytest.mark.asyncio
async def test_call_mcp_tool_logs_request_and_response(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    mcp_module = ModuleType("mcp")
    mcp_module.ClientSession = _ClientSession
    mcp_client_module = ModuleType("mcp.client")
    stdio_module = ModuleType("mcp.client.stdio")
    stdio_module.stdio_client = _stdio_client
    stdio_module.StdioServerParameters = _StdioServerParameters
    monkeypatch.setitem(sys.modules, "mcp", mcp_module)
    monkeypatch.setitem(sys.modules, "mcp.client", mcp_client_module)
    monkeypatch.setitem(sys.modules, "mcp.client.stdio", stdio_module)

    caplog.set_level(logging.INFO, logger="src.flow_engine.mcp")

    response = await call_mcp_tool(
        "stdio",
        "fake-command",
        {},
        "get_document_strategy",
        {"query": "strategy"},
    )

    assert response == {"text": "ok"}
    messages = [record.getMessage() for record in caplog.records]
    assert any(
        message.startswith("mcp_call_tool action=get_document_strategy")
        for message in messages
    )
    assert any(
        message.startswith("mcp_call_tool_response action=get_document_strategy")
        and '"text": "ok"' in message
        for message in messages
    )


@pytest.mark.asyncio
async def test_call_mcp_tool_can_suppress_sensitive_payload_logging(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    mcp_module = ModuleType("mcp")
    mcp_module.ClientSession = _ClientSession
    mcp_client_module = ModuleType("mcp.client")
    stdio_module = ModuleType("mcp.client.stdio")
    stdio_module.stdio_client = _stdio_client
    stdio_module.StdioServerParameters = _StdioServerParameters
    monkeypatch.setitem(sys.modules, "mcp", mcp_module)
    monkeypatch.setitem(sys.modules, "mcp.client", mcp_client_module)
    monkeypatch.setitem(sys.modules, "mcp.client.stdio", stdio_module)
    caplog.set_level(logging.INFO, logger="src.flow_engine.mcp")

    await call_mcp_tool(
        "stdio",
        "fake-command",
        {},
        "file_download_base64",
        {"path": "/mnt/workspace/private/report.pdf"},
        log_payload=False,
    )

    messages = [record.getMessage() for record in caplog.records]
    assert any("request_payload=[suppressed]" in message for message in messages)
    assert any("response_payload=[suppressed]" in message for message in messages)
    assert not any("/mnt/workspace" in message or '"text": "ok"' in message for message in messages)


@pytest.mark.asyncio
async def test_call_mcp_tool_suppresses_sensitive_error_text(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    mcp_module = ModuleType("mcp")
    mcp_module.ClientSession = _SensitiveErrorClientSession
    mcp_client_module = ModuleType("mcp.client")
    stdio_module = ModuleType("mcp.client.stdio")
    stdio_module.stdio_client = _stdio_client
    stdio_module.StdioServerParameters = _StdioServerParameters
    monkeypatch.setitem(sys.modules, "mcp", mcp_module)
    monkeypatch.setitem(sys.modules, "mcp.client", mcp_client_module)
    monkeypatch.setitem(sys.modules, "mcp.client.stdio", stdio_module)
    caplog.set_level(logging.INFO, logger="src.flow_engine.mcp")

    response = await call_mcp_tool(
        "stdio",
        "fake-command",
        {},
        "file_download_base64",
        {"path": "/mnt/workspace/private/report.pdf"},
        log_payload=False,
    )

    assert response == "Connector action 'file_download_base64' failed"
    assert not any("/mnt/workspace" in record.getMessage() for record in caplog.records)


@pytest.mark.asyncio
async def test_call_mcp_tool_suppresses_exception_group_text(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    mcp_module = ModuleType("mcp")
    mcp_module.ClientSession = _ClientSession
    mcp_client_module = ModuleType("mcp.client")
    stdio_module = ModuleType("mcp.client.stdio")
    stdio_module.stdio_client = _failing_stdio_client
    stdio_module.StdioServerParameters = _StdioServerParameters
    monkeypatch.setitem(sys.modules, "mcp", mcp_module)
    monkeypatch.setitem(sys.modules, "mcp.client", mcp_client_module)
    monkeypatch.setitem(sys.modules, "mcp.client.stdio", stdio_module)
    caplog.set_level(logging.INFO, logger="src.flow_engine.mcp")

    response = await call_mcp_tool(
        "stdio",
        "fake-command",
        {},
        "file_download_base64",
        {"path": "/mnt/workspace/private/report.pdf"},
        log_payload=False,
    )

    assert response == "Connector action 'file_download_base64' failed"
    assert any("MCP sub-exception" in record.getMessage() for record in caplog.records)
    assert not any("/mnt/workspace" in record.getMessage() for record in caplog.records)


@pytest.mark.asyncio
async def test_call_mcp_tool_preserves_image_content_parts(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    mcp_module = ModuleType("mcp")
    mcp_module.ClientSession = _ImageClientSession
    mcp_client_module = ModuleType("mcp.client")
    stdio_module = ModuleType("mcp.client.stdio")
    stdio_module.stdio_client = _stdio_client
    stdio_module.StdioServerParameters = _StdioServerParameters
    monkeypatch.setitem(sys.modules, "mcp", mcp_module)
    monkeypatch.setitem(sys.modules, "mcp.client", mcp_client_module)
    monkeypatch.setitem(sys.modules, "mcp.client.stdio", stdio_module)

    caplog.set_level(logging.INFO, logger="src.flow_engine.mcp")

    response = await call_mcp_tool(
        "stdio",
        "fake-command",
        {},
        "read_content",
        {"query": "recipe"},
    )

    parts = response["__mcp_content_parts"]
    assert response["text"] == "ok"
    assert parts[0]["type"] == "text"
    assert parts[1]["type"] == "image"
    assert parts[1]["data"] == "YWJjMTIz"
    assert parts[1]["mimeType"] == "image/png"
    assert parts[1]["decodedByteSize"] == 6

    messages = [record.getMessage() for record in caplog.records]
    assert any("mcp_image_bridge_received action=read_content" in message for message in messages)
    assert not any("YWJjMTIz" in message for message in messages)
    assert any("[redacted image base64 length=8]" in message for message in messages)
