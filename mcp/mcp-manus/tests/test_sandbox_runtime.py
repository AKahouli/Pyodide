"""Unit tests for SandboxRuntime acquisition logic."""
from __future__ import annotations

from datetime import datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from sandbox_mcp.client import SandboxClient, SandboxLeaseGone
from sandbox_mcp.config import Settings
from sandbox_mcp.errors import SandboxAcquireError
from sandbox_mcp.manager import MultiUserSandboxManager, SandboxManager
from sandbox_mcp.runtime import SandboxRuntime, classify_error


def _settings(**overrides) -> Settings:
    base = {
        "sandbox_acquire_max_attempts": 3,
        "sandbox_probe_max_attempts": 1,
        "sandbox_probe_interval_ms": 0,
        "sandbox_executable_max_attempts": 2,
        "sandbox_executable_interval_sec": 0,
        "sandbox_ready_fail_on_timeout": False,
    }
    base.update(overrides)
    return Settings(**base)


def _make_manager(settings: Settings | None = None) -> SandboxManager:
    return SandboxManager(
        settings or _settings(),
        user_id="alice",
        conversation_id="conv-1",
        scope_type="conversation",
        scope_id="conversation:conv-1",
        lane_id="main",
    )


def _fake_client(client_id: str = "lease-1") -> SandboxClient:
    client = MagicMock(spec=SandboxClient)
    client.id = client_id
    client.ip = "10.0.0.1"
    client.probe = AsyncMock(return_value=True)
    client.wait_until_executable = AsyncMock()
    client.ensure_ready = AsyncMock()
    client.inventory_mounts = AsyncMock(return_value="=== VM_WORKSPACE_LS ===\n")
    return client


@pytest.mark.asyncio
async def test_acquire_cache_hit_probe_ok():
    runtime = SandboxRuntime(_settings())
    manager = _make_manager()
    cached = _fake_client()
    manager._sandbox = cached

    client = await runtime.acquire(manager)

    assert client is cached
    cached.probe.assert_awaited_once()
    cached.wait_until_executable.assert_not_awaited()
    assert manager.last_used_at is not None


@pytest.mark.asyncio
async def test_acquire_stale_cache_recreate():
    runtime = SandboxRuntime(_settings())
    manager = _make_manager()
    stale = _fake_client("stale")
    stale.probe = AsyncMock(return_value=False)
    manager._sandbox = stale
    fresh = _fake_client("fresh")

    with patch.object(manager, "_boot_sandbox", new=AsyncMock(return_value=fresh)):
        client = await runtime.acquire(manager)

    assert client is fresh
    assert manager._sandbox is fresh


@pytest.mark.asyncio
async def test_acquire_lease_gone_retry():
    runtime = SandboxRuntime(_settings(sandbox_acquire_max_attempts=2))
    manager = _make_manager()
    fresh = _fake_client("fresh-2")
    fresh.wait_until_executable = AsyncMock(
        side_effect=[SandboxLeaseGone("gone"), None],
    )

    with patch.object(manager, "_boot_sandbox", new=AsyncMock(return_value=fresh)):
        client = await runtime.acquire(manager)

    assert client is fresh
    assert fresh.wait_until_executable.await_count == 2


@pytest.mark.asyncio
async def test_acquire_transient_network_retry():
    runtime = SandboxRuntime(_settings(sandbox_acquire_max_attempts=3))
    manager = _make_manager()
    fresh = _fake_client()
    calls = {"n": 0}

    async def boot():
        calls["n"] += 1
        if calls["n"] < 3:
            raise httpx.ConnectError("refused")
        return fresh

    with patch.object(manager, "_boot_sandbox", new=AsyncMock(side_effect=boot)):
        with patch.object(runtime, "_backoff", new=AsyncMock()):
            client = await runtime.acquire(manager)

    assert client is fresh
    assert calls["n"] == 3


@pytest.mark.asyncio
async def test_acquire_exhausted_raises():
    runtime = SandboxRuntime(_settings(sandbox_acquire_max_attempts=2))
    manager = _make_manager()

    with patch.object(
        manager,
        "_boot_sandbox",
        new=AsyncMock(side_effect=httpx.ConnectError("down")),
    ):
        with patch.object(runtime, "_backoff", new=AsyncMock()):
            with pytest.raises(SandboxAcquireError) as exc_info:
                await runtime.acquire(manager)

    assert exc_info.value.code == "ACQUIRE_EXHAUSTED"
    assert exc_info.value.attempts == 2


@pytest.mark.asyncio
async def test_inventory_background_never_blocks_acquire():
    runtime = SandboxRuntime(_settings())
    manager = _make_manager()
    client = _fake_client()
    client.inventory_mounts = AsyncMock(side_effect=RuntimeError("inventory boom"))

    with patch.object(manager, "_boot_sandbox", new=AsyncMock(return_value=client)):
        acquired = await runtime.acquire(manager)

    assert acquired is client
    await asyncio_sleep_short()


@pytest.mark.asyncio
async def test_ttl_eviction():
    settings = _settings(sandbox_ttl_minutes=30)
    multi = MultiUserSandboxManager(settings)
    manager = multi.get_manager(
        "alice",
        "conv-1",
        scope_type="conversation",
        scope_id="conversation:conv-1",
    )
    manager._sandbox = _fake_client()
    manager._created_at = datetime.now() - timedelta(minutes=31)
    manager.touch()
    manager._last_used_at = datetime.now() - timedelta(minutes=31)
    manager.destroy = AsyncMock()

    evicted = await multi.evict_idle()

    assert evicted == 1
    manager.destroy.assert_awaited_once()


@pytest.mark.asyncio
async def test_classify_error():
    assert classify_error(SandboxLeaseGone("x")) == (True, "LEASE_GONE")
    assert classify_error(TimeoutError()) == (False, "QUEUE_TIMEOUT")
    assert classify_error(httpx.ConnectError("x")) == (True, "MANAGER_UNREACHABLE")


@pytest.mark.asyncio
async def test_invalidate_drops_cache():
    runtime = SandboxRuntime(_settings())
    manager = _make_manager()
    manager._sandbox = _fake_client()
    manager._sandbox.client = MagicMock()
    manager._sandbox.client.aclose = AsyncMock()

    await runtime.invalidate(manager)

    assert manager._sandbox is None


async def asyncio_sleep_short() -> None:
    import asyncio
    await asyncio.sleep(0.01)
