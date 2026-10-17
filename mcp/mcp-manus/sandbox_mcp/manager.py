"""Sandbox lifecycle management — per-user and multi-user."""
from __future__ import annotations

import asyncio
import logging
import socket
from datetime import datetime
from typing import Optional

from .client import SandboxClient
from .config import Settings

logger = logging.getLogger(__name__)


class SandboxManager:
    """Owns one SandboxClient for a specific scope/lane. Created lazily, destroyed explicitly."""

    def __init__(
        self,
        settings: Settings,
        user_id: str,
        conversation_id: str = "",
        workspace_paths: Optional[list[str]] = None,
        file_paths: Optional[list[str]] = None,
        scope_type: str = "",
        scope_id: str = "",
        lane_id: str = "main",
        node_id: str = "",
    ) -> None:
        self._settings = settings
        self._user_id = user_id
        self._conversation_id = conversation_id
        self._workspace_paths = workspace_paths or []
        self._file_paths = file_paths or []
        self._scope_type = scope_type
        self._scope_id = scope_id
        self._lane_id = lane_id or "main"
        self._node_id = node_id or ""
        self._sandbox: Optional[SandboxClient] = None
        self._lock = asyncio.Lock()
        self._created_at: Optional[datetime] = None
        self._last_used_at: Optional[datetime] = None

    @property
    def user_id(self) -> str:
        return self._user_id

    @property
    def scope_id(self) -> str:
        return self._scope_id

    @property
    def lane_id(self) -> str:
        return self._lane_id

    @property
    def is_alive(self) -> bool:
        return self._sandbox is not None

    @property
    def last_used_at(self) -> Optional[datetime]:
        return self._last_used_at

    def touch(self) -> None:
        self._last_used_at = datetime.now()

    def _set_sandbox(self, client: SandboxClient) -> None:
        self._sandbox = client
        self._created_at = datetime.now()

    def _clear_cache_unlocked(self) -> Optional[SandboxClient]:
        """Clear cached client without acquiring the lock. Returns the old client."""
        sandbox = self._sandbox
        self._sandbox = None
        self._created_at = None
        return sandbox

    async def _boot_sandbox(self) -> SandboxClient:
        """Create or reconnect to a sandbox without readiness checks or inventory."""
        s = self._settings
        if s.sandbox_address:
            ip = await self._resolve(s.sandbox_address)
            return SandboxClient(
                ip=ip,
                container_name="dev-sandbox",
                manager_url=s.sandbox_manager_url,
                manager_token=s.sandbox_manager_token,
                scope_type=self._scope_type,
                scope_id=self._scope_id,
                lane_id=self._lane_id,
                user_id=self._user_id,
            )

        if s.sandbox_use_lease_lookup and self._scope_id:
            existing = await SandboxClient.resolve_lease(
                manager_url=s.sandbox_manager_url,
                manager_token=s.sandbox_manager_token,
                scope_type=self._scope_type,
                scope_id=self._scope_id,
                lane_id=self._lane_id,
                user_id=self._user_id,
            )
            if existing:
                return existing

        return await SandboxClient.create(
            manager_url=s.sandbox_manager_url,
            manager_token=s.sandbox_manager_token,
            user_id=self._user_id,
            workspace_paths=self._workspace_paths,
            file_paths=self._file_paths,
            session_id=self._conversation_id,
            scope_type=self._scope_type,
            scope_id=self._scope_id,
            lane_id=self._lane_id,
            node_id=self._node_id,
        )

    async def drop_cached_client(self) -> None:
        async with self._lock:
            sandbox = self._clear_cache_unlocked()
        if sandbox is None:
            return
        try:
            await sandbox.client.aclose()
        except Exception:
            pass
        logger.warning("Dropped stale sandbox cache: user=%s id=%s", self._user_id, sandbox.id)

    async def destroy(self, failed: bool = False) -> None:
        async with self._lock:
            if self._sandbox:
                await self._sandbox.destroy(failed=failed)
                self._sandbox = None
                self._created_at = None
                self._last_used_at = None
                logger.info("Sandbox destroyed: user=%s", self._user_id)

    def info(self) -> dict:
        if not self._sandbox:
            return {"status": "not_running", "user_id": self._user_id}
        return {
            "status": "running",
            "user_id": self._user_id,
            "sandbox_id": self._sandbox.id,
            "ip": self._sandbox.ip,
            "cdp_url": self._sandbox.cdp_url,
            "vnc_url": self._sandbox.vnc_url,
            "created_at": self._created_at.isoformat() if self._created_at else None,
        }

    @staticmethod
    async def _resolve(hostname: str) -> str:
        try:
            socket.inet_pton(socket.AF_INET, hostname)
            return hostname
        except OSError:
            pass
        ai = await asyncio.to_thread(socket.getaddrinfo, hostname, None, socket.AF_INET)
        return ai[0][4][0]


class MultiUserSandboxManager:
    """Registry of per-scope SandboxManagers."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._managers: dict[str, SandboxManager] = {}
        self._lock = asyncio.Lock()

    def get_manager(
        self,
        user_id: str,
        conversation_id: str = "",
        workspace_paths: Optional[list[str]] = None,
        file_paths: Optional[list[str]] = None,
        scope_type: str = "",
        scope_id: str = "",
        lane_id: str = "main",
        node_id: str = "",
    ) -> SandboxManager:
        key = f"{scope_id}:{lane_id}" if scope_id else f"{user_id}:{conversation_id}"
        if key not in self._managers:
            self._managers[key] = SandboxManager(
                self._settings,
                user_id=user_id,
                conversation_id=conversation_id,
                workspace_paths=workspace_paths,
                file_paths=file_paths,
                scope_type=scope_type,
                scope_id=scope_id,
                lane_id=lane_id,
                node_id=node_id,
            )
            logger.info(
                "[mcp-fs-audit] Created sandbox manager for user=%s scope=%s lane=%s "
                "workspace_paths=%s file_paths=%s",
                user_id, scope_id, lane_id, workspace_paths or [], file_paths or [],
            )
        else:
            mgr = self._managers[key]
            if workspace_paths is not None:
                mgr._workspace_paths = workspace_paths
            if file_paths is not None:
                mgr._file_paths = file_paths
            logger.info(
                "[mcp-fs-audit] Reusing sandbox manager key=%s user=%s "
                "workspace_paths=%s file_paths_count=%s alive=%s",
                key,
                user_id,
                workspace_paths or [],
                len(file_paths or []),
                mgr.is_alive,
            )
        return self._managers[key]

    async def evict_idle(self) -> int:
        """Destroy sandboxes idle longer than sandbox_ttl_minutes. Returns eviction count."""
        ttl = self._settings.sandbox_ttl_minutes
        if ttl <= 0:
            return 0

        now = datetime.now()
        evicted = 0
        keys_to_remove: list[str] = []

        for key, manager in list(self._managers.items()):
            if not manager.is_alive:
                continue
            last_used = manager.last_used_at or manager._created_at
            if last_used is None:
                continue
            idle_minutes = (now - last_used).total_seconds() / 60.0
            if idle_minutes >= ttl:
                logger.info(
                    "TTL eviction: key=%s idle_minutes=%.1f ttl=%d",
                    key,
                    idle_minutes,
                    ttl,
                )
                await manager.destroy()
                keys_to_remove.append(key)
                evicted += 1

        for key in keys_to_remove:
            self._managers.pop(key, None)
        return evicted

    async def destroy_by_key(self, scope_id: str, lane_id: str = "main") -> None:
        key = f"{scope_id}:{lane_id}"
        manager = self._managers.pop(key, None)
        if manager:
            await manager.destroy()

    async def destroy_all_for_user(self, user_id: str) -> None:
        keys = [k for k, m in self._managers.items() if m.user_id == user_id]
        for key in keys:
            manager = self._managers.pop(key, None)
            if manager:
                await manager.destroy()

    async def destroy_user(self, user_id: str) -> None:
        await self.destroy_all_for_user(user_id)

    async def destroy_all(self) -> None:
        for manager in list(self._managers.values()):
            await manager.destroy()
        self._managers.clear()

    def list_users(self) -> list[str]:
        return list(self._managers.keys())
