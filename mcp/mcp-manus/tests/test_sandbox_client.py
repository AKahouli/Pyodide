"""Unit tests for SandboxClient probe, executable wait, and lease helpers."""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from sandbox_mcp.client import SandboxClient, SandboxLeaseGone, ToolResult
from sandbox_mcp.errors import SandboxAcquireError


def _make_client() -> SandboxClient:
    return SandboxClient(
        ip="10.0.0.1",
        container_name="lease-abc",
        manager_url="http://manager.test",
        manager_token="tok",
        scope_type="conversation",
        scope_id="conversation:conv-1",
        lane_id="main",
        user_id="alice",
    )


@pytest.mark.asyncio
async def test_probe_success():
    client = _make_client()
    client._ssh_exec = AsyncMock(  # type: ignore[method-assign]
        return_value=ToolResult(success=True, data={"stdout": "__probe__\n", "exit_code": 0})
    )
    assert await client.probe() is True


@pytest.mark.asyncio
async def test_probe_lease_gone_returns_false():
    client = _make_client()
    client._ssh_exec = AsyncMock(side_effect=SandboxLeaseGone("gone"))  # type: ignore[method-assign]
    assert await client.probe() is False


@pytest.mark.asyncio
async def test_probe_connect_error_returns_false():
    client = _make_client()
    client._ssh_exec = AsyncMock(side_effect=httpx.ConnectError("refused"))  # type: ignore[method-assign]
    assert await client.probe() is False


@pytest.mark.asyncio
async def test_wait_until_executable_success():
    client = _make_client()
    client._ssh_exec = AsyncMock(  # type: ignore[method-assign]
        return_value=ToolResult(success=True, data={"stdout": "__executable__\n", "exit_code": 0})
    )
    await client.wait_until_executable(max_attempts=3, interval=0)


@pytest.mark.asyncio
async def test_wait_until_executable_timeout_raises():
    client = _make_client()
    client._ssh_exec = AsyncMock(  # type: ignore[method-assign]
        return_value=ToolResult(success=False, data={"stdout": "", "exit_code": 1})
    )
    with pytest.raises(SandboxAcquireError) as exc_info:
        await client.wait_until_executable(max_attempts=2, interval=0)
    assert exc_info.value.code == "PROBE_FAILED"


@pytest.mark.asyncio
async def test_wait_until_executable_reraises_lease_gone():
    client = _make_client()
    client._ssh_exec = AsyncMock(side_effect=SandboxLeaseGone("gone"))  # type: ignore[method-assign]
    with pytest.raises(SandboxLeaseGone):
        await client.wait_until_executable(max_attempts=2, interval=0)


@pytest.mark.asyncio
async def test_ensure_ready_fail_on_timeout_raises():
    client = _make_client()
    client._ssh_exec = AsyncMock(  # type: ignore[method-assign]
        return_value=ToolResult(success=False, data={"stdout": "bad", "exit_code": 1})
    )
    with patch("sandbox_mcp.client.asyncio.sleep", new_callable=AsyncMock):
        with pytest.raises(SandboxAcquireError) as exc_info:
            await client.ensure_ready(fail_on_timeout=True)
    assert exc_info.value.code == "PROBE_FAILED"


@pytest.mark.asyncio
async def test_raise_if_lease_gone_on_404():
    client = _make_client()
    response = MagicMock()
    response.status_code = 404
    response.text = "not found"
    with pytest.raises(SandboxLeaseGone):
        client._raise_if_lease_gone(response)


@pytest.mark.asyncio
async def test_resolve_lease_returns_client():
    payload = {
        "lease_id": "lease-xyz",
        "ip": "10.0.0.9",
        "status": "ready",
        "cdp_url": "http://10.0.0.9:9222",
        "vnc_ws_url": "ws://10.0.0.9:5901",
        "reused": True,
    }

    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/sandbox/lease"
        return httpx.Response(200, json=payload)

    transport = httpx.MockTransport(handler)
    async_client = httpx.AsyncClient(transport=transport)

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return async_client

        async def __aexit__(self, *args):
            return None

    with patch("sandbox_mcp.client.httpx.AsyncClient", FakeAsyncClient):
        client = await SandboxClient.resolve_lease(
            manager_url="http://manager.test",
            manager_token="tok",
            scope_type="conversation",
            scope_id="conversation:conv-1",
            lane_id="main",
            user_id="alice",
        )
    assert client is not None
    assert client.id == "lease-xyz"
    assert client.ip == "10.0.0.9"


@pytest.mark.asyncio
async def test_resolve_lease_404_returns_none():
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"error": "not found"})

    transport = httpx.MockTransport(handler)
    async_client = httpx.AsyncClient(transport=transport)

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return async_client

        async def __aexit__(self, *args):
            return None

    with patch("sandbox_mcp.client.httpx.AsyncClient", FakeAsyncClient):
        client = await SandboxClient.resolve_lease(
            manager_url="http://manager.test",
            manager_token="tok",
            scope_type="conversation",
            scope_id="conversation:conv-1",
        )
    assert client is None
