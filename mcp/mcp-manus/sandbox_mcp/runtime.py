"""Unified sandbox acquisition runtime — probe, retry, readiness."""
from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING

import httpx

from .client import SandboxClient, SandboxLeaseGone
from .config import Settings
from .errors import SandboxAcquireError

if TYPE_CHECKING:
    from .manager import SandboxManager

logger = logging.getLogger(__name__)


def classify_error(exc: BaseException) -> tuple[bool, str]:
    """Return (retryable, error_code) for an acquisition failure."""
    if isinstance(exc, SandboxLeaseGone):
        return True, "LEASE_GONE"
    if isinstance(exc, TimeoutError):
        return False, "QUEUE_TIMEOUT"
    if isinstance(exc, httpx.ConnectError):
        return True, "MANAGER_UNREACHABLE"
    if isinstance(exc, (httpx.ReadTimeout, httpx.WriteTimeout, httpx.PoolTimeout)):
        return True, "MANAGER_UNREACHABLE"
    if isinstance(exc, httpx.HTTPStatusError):
        if exc.response.status_code in (502, 503, 504):
            return True, "MANAGER_UNREACHABLE"
        return False, "CREATE_FAILED"
    if isinstance(exc, SandboxAcquireError):
        return exc.retryable, exc.code
    if isinstance(exc, RuntimeError):
        msg = str(exc).lower()
        if "failed" in msg or "queue" in msg:
            return True, "QUEUE_FAILED"
        return False, "CREATE_FAILED"
    return False, "CREATE_FAILED"


class SandboxRuntime:
    """Single entry point for acquiring a ready sandbox client."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    async def acquire(self, manager: "SandboxManager") -> SandboxClient:
        max_attempts = self._settings.sandbox_acquire_max_attempts
        last_exc: BaseException | None = None

        for attempt in range(1, max_attempts + 1):
            try:
                return await self._acquire_once(manager)
            except Exception as exc:
                last_exc = exc
                retryable, code = classify_error(exc)
                logger.warning(
                    "Sandbox acquire attempt %d/%d failed: %s code=%s retryable=%s",
                    attempt,
                    max_attempts,
                    type(exc).__name__,
                    code,
                    retryable,
                )
                await manager.drop_cached_client()
                if not retryable or attempt >= max_attempts:
                    raise SandboxAcquireError(
                        str(exc),
                        code=code if attempt < max_attempts else "ACQUIRE_EXHAUSTED",
                        retryable=retryable,
                        attempts=attempt,
                        scope_id=manager.scope_id,
                        lane_id=manager.lane_id,
                    ) from exc
                await self._backoff(attempt)

        raise SandboxAcquireError(
            str(last_exc or "unknown"),
            code="ACQUIRE_EXHAUSTED",
            retryable=True,
            attempts=max_attempts,
            scope_id=manager.scope_id,
            lane_id=manager.lane_id,
        )

    async def invalidate(self, manager: "SandboxManager") -> None:
        await manager.drop_cached_client()

    async def get_inventory_preview(self, client: SandboxClient) -> str:
        try:
            inventory = await asyncio.wait_for(
                client.inventory_mounts(),
                timeout=30.0,
            )
            interesting = [
                ln
                for ln in (inventory or "").splitlines()
                if ln.startswith("===")
                or "BROKEN" in ln
                or "/mnt/workspace" in ln
                or "size=" in ln
            ][:40]
            return "\n".join(interesting) or "(empty)"
        except Exception as exc:
            logger.warning(
                "[mcp-fs-audit] inventory preview failed: %s:%s",
                type(exc).__name__,
                exc,
            )
            return f"(inventory failed: {type(exc).__name__}: {exc})"

    async def _acquire_once(self, manager: "SandboxManager") -> SandboxClient:
        async with manager._lock:
            cached = manager._sandbox
            if cached is not None:
                if await self._probe_with_retries(cached):
                    manager.touch()
                    logger.debug("Sandbox cache hit after probe: id=%s", cached.id)
                    return cached
                manager._clear_cache_unlocked()

            client = await manager._boot_sandbox()
            await client.wait_until_executable(
                max_attempts=self._settings.sandbox_executable_max_attempts,
                interval=self._settings.sandbox_executable_interval_sec,
            )
            await client.ensure_ready(
                fail_on_timeout=self._settings.sandbox_ready_fail_on_timeout,
            )
            manager._set_sandbox(client)
            manager.touch()
            logger.info(
                "[mcp-fs-audit] Sandbox acquired: user=%s id=%s ip=%s",
                manager.user_id,
                client.id,
                client.ip,
            )

        self._schedule_background_inventory(client)
        return client

    async def _probe_with_retries(self, client: SandboxClient) -> bool:
        for attempt in range(1, self._settings.sandbox_probe_max_attempts + 1):
            if await client.probe():
                return True
            if attempt < self._settings.sandbox_probe_max_attempts:
                await asyncio.sleep(self._settings.sandbox_probe_interval_ms / 1000.0)
        return False

    def _schedule_background_inventory(self, client: SandboxClient) -> None:
        async def _run() -> None:
            try:
                inventory = await client.inventory_mounts()
                for line in (inventory or "").splitlines()[:140]:
                    logger.info("[mcp-fs-audit] VM_INVENTORY background | %s", line)
            except Exception as exc:
                logger.warning(
                    "[mcp-fs-audit] VM_INVENTORY background failed: %s:%s",
                    type(exc).__name__,
                    exc,
                )

        asyncio.create_task(_run())

    @staticmethod
    async def _backoff(attempt: int) -> None:
        delay = min(2 ** attempt * 0.2, 2.0)
        await asyncio.sleep(delay)
