"""Standalone HTTP client for a Firecracker microVM sandbox."""
from __future__ import annotations

import asyncio
import base64
import logging
import socket
import time
import uuid
from typing import BinaryIO, List, Optional

import httpx
from pydantic import BaseModel

from .errors import SandboxAcquireError

logger = logging.getLogger(__name__)


class SandboxLeaseGone(Exception):
    """The manager no longer has this lease (404/403). Drop the cached client and recreate."""


class ToolResult(BaseModel):
    success: bool = True
    message: str = ""
    data: dict = {}


class SandboxClient:
    """HTTP client wrapping a single Firecracker microVM via the sandbox manager API."""

    def __init__(
        self,
        ip: str,
        container_name: str,
        manager_url: str,
        manager_token: str = "",
        cdp_url: str = "",
        vnc_url: str = "",
        scope_type: str = "",
        scope_id: str = "",
        lane_id: str = "main",
        user_id: str = "",
    ) -> None:
        self.ip = ip
        self._container_name = container_name
        self._manager_url = manager_url.rstrip("/")
        self._manager_token = manager_token
        self._scope_type = scope_type
        self._scope_id = scope_id
        self._lane_id = lane_id or "main"
        self._user_id = user_id
        self._cdp_url = (cdp_url.replace("ws://", "http://") if cdp_url else None) or f"http://{ip}:9222"
        self._vnc_url = vnc_url or f"ws://{ip}:5901"
        # Bearer token + canonical scope headers on EVERY data-plane call so the
        # Coordinator can validate lease ownership (remediation §6/§38).
        headers = {"Authorization": f"Bearer {manager_token}"} if manager_token else {}
        headers.update(self._scope_headers())
        self.client = httpx.AsyncClient(timeout=600, headers=headers)
        self._shell_outputs: dict = {}

    def _scope_headers(self) -> dict:
        if not self._scope_id:
            return {}
        return {
            "x-sandbox-scope-type": self._scope_type or "conversation",
            "x-sandbox-scope-id": self._scope_id,
            "x-sandbox-lane-id": self._lane_id or "main",
            "x-user-id": self._user_id or "",
        }

    # -- identity ----------------------------------------------------------------

    @property
    def id(self) -> str:
        return self._container_name

    @property
    def cdp_url(self) -> str:
        return self._cdp_url

    @property
    def vnc_url(self) -> str:
        return self._vnc_url

    # -- low-level HTTP ----------------------------------------------------------

    def _raise_if_lease_gone(self, r: httpx.Response) -> None:
        if r.status_code in (404, 403):
            raise SandboxLeaseGone(
                f"lease {self._container_name} gone ({r.status_code}): {r.text[:200]}"
            )

    async def _ssh_exec(self, command: str) -> ToolResult:
        r = await self.client.post(
            f"{self._manager_url}/sandbox/execute",
            json={"sandbox_id": self._container_name, "command": command},
        )
        self._raise_if_lease_gone(r)
        d = r.json()
        if isinstance(d, dict) and d.get("error") == "sandbox not found":
            raise SandboxLeaseGone(f"lease {self._container_name} not found")
        rc = d.get("exit_code", 0)
        return ToolResult(
            success=(rc == 0),
            message=(d.get("stderr") or "").strip(),
            data={
                "stdout": d.get("stdout", ""),
                "stderr": d.get("stderr", ""),
                "exit_code": rc,
            },
        )

    async def _manager_post(self, path: str, body: dict) -> ToolResult:
        body["sandbox_id"] = self._container_name
        r = await self.client.post(f"{self._manager_url}{path}", json=body)
        self._raise_if_lease_gone(r)
        return ToolResult(**r.json())

    # -- readiness ---------------------------------------------------------------

    async def probe(self) -> bool:
        """Lightweight health check via the data-plane execute endpoint."""
        try:
            r = await self._ssh_exec("echo __probe__")
            stdout = (r.data or {}).get("stdout", "") or ""
            return r.success and "__probe__" in stdout
        except SandboxLeaseGone:
            return False
        except (httpx.ConnectError, httpx.ReadTimeout, httpx.WriteTimeout, httpx.PoolTimeout):
            return False

    async def wait_until_executable(
        self,
        max_attempts: int = 15,
        interval: float = 2.0,
    ) -> None:
        """Block until /sandbox/execute accepts commands on this lease."""
        for attempt in range(max_attempts):
            try:
                r = await self._ssh_exec("echo __executable__")
                stdout = (r.data or {}).get("stdout", "") or ""
                if r.success and "__executable__" in stdout:
                    logger.info("Sandbox executable after %d attempt(s)", attempt + 1)
                    return
            except SandboxLeaseGone:
                raise
            except (httpx.ConnectError, httpx.ReadTimeout, httpx.WriteTimeout, httpx.PoolTimeout) as exc:
                logger.debug("Executable check %d/%d: %s", attempt + 1, max_attempts, exc)
            await asyncio.sleep(interval)
        raise SandboxAcquireError(
            f"Sandbox {self._container_name} not executable after {max_attempts} attempts",
            code="PROBE_FAILED",
            retryable=True,
            scope_id=self._scope_id,
            lane_id=self._lane_id,
        )

    async def ensure_ready(self, *, fail_on_timeout: bool = False) -> None:
        """Block until supervisord services inside the VM are all RUNNING."""
        for attempt in range(30):
            try:
                r = await self._ssh_exec("supervisorctl status 2>&1")
                if r.data.get("exit_code") == 127:
                    logger.warning("Sandbox readiness check skipped: supervisorctl is not available")
                    return
                if r.success:
                    lines = [
                        ln.strip()
                        for ln in (r.data.get("stdout") or "").split("\n")
                        if ln.strip()
                    ]
                    if lines and all(
                        ln.split()[1] in ("RUNNING", "STARTING")
                        for ln in lines
                        if len(ln.split()) >= 2
                    ):
                        logger.info("Sandbox ready (%d supervisor services)", len(lines))
                        return
            except SandboxLeaseGone:
                raise
            except Exception as exc:
                logger.debug("Readiness check %d/%d: %s", attempt + 1, 30, exc)
            await asyncio.sleep(2)
        msg = "Sandbox readiness timed out after 60 s"
        if fail_on_timeout:
            raise SandboxAcquireError(
                msg,
                code="PROBE_FAILED",
                retryable=True,
                scope_id=self._scope_id,
                lane_id=self._lane_id,
            )
        logger.warning("%s — continuing anyway", msg)

    # -- shell -------------------------------------------------------------------

    async def exec_command(self, exec_dir: str, command: str) -> ToolResult:
        cmd = f"cd '{exec_dir}' && {command}" if exec_dir else command
        result = await self._ssh_exec(cmd)
        stdout = (result.data or {}).get("stdout", "")
        self._shell_outputs["__last__"] = (command, stdout)
        return result

    # -- file --------------------------------------------------------------------

    async def file_write(self, path: str, content: str, append: bool = False) -> ToolResult:
        """Write content to a file using base64 encoding (safe for any content)."""
        b64 = base64.b64encode(content.encode()).decode()
        op = ">>" if append else ">"
        cmd = f"mkdir -p \"$(dirname '{path}')\" && printf '%s' '{b64}' | base64 -d {op} '{path}'"
        return await self._ssh_exec(cmd)

    async def file_read(self, path: str) -> ToolResult:
        result = await self._ssh_exec(f"cat '{path}'")
        if result.success:
            return ToolResult(success=True, data={"content": result.data.get("stdout", "")})
        return result

    async def file_list(self, path: str) -> ToolResult:
        result = await self._ssh_exec(f"ls -la '{path}'")
        if result.success:
            return ToolResult(success=True, data={"listing": result.data.get("stdout", "")})
        return result

    async def inventory_mounts(self) -> str:
        """Dump mounted workspace / yellowmind / home inventory for audit logs."""
        cmd = r"""
set +e
echo '=== VM_WORKSPACE_LS ==='
ls -la /mnt/workspace 2>&1 | head -80
echo '=== VM_WORKSPACE_SYMLINKS ==='
find /mnt/workspace -maxdepth 1 \( -type l -o -type d \) -printf '%p -> %l\n' 2>/dev/null | head -60
echo '=== VM_BROKEN_SYMLINKS ==='
find /mnt/workspace -maxdepth 2 -xtype l -printf 'BROKEN %p -> %l\n' 2>/dev/null | head -40
echo '=== VM_WORKSPACE_FILES ==='
find /mnt/workspace -maxdepth 4 -type f -printf '%p size=%s\n' 2>/dev/null | head -100
echo '=== VM_YELLOWMIND_OUTPUTS ==='
ls -la /mnt/yellowmind/run/outputs 2>&1 | head -60
find /mnt/yellowmind -maxdepth 5 -type f -printf '%p size=%s\n' 2>/dev/null | head -80
echo '=== VM_INVENTORY_END ==='
""".strip()
        result = await self._ssh_exec(cmd)
        return ((result.data or {}).get("stdout") or "") + ((result.data or {}).get("stderr") or "")

    async def file_delete(self, path: str) -> ToolResult:
        return await self._ssh_exec(f"rm -rf '{path}'")

    async def file_find(self, path: str, pattern: str) -> ToolResult:
        result = await self._ssh_exec(f"find '{path}' -name '{pattern}' 2>/dev/null")
        if result.success:
            files = [f for f in result.data.get("stdout", "").split("\n") if f.strip()]
            return ToolResult(success=True, data={"files": files})
        return result

    async def file_upload(self, file_data: BinaryIO, path: str) -> ToolResult:
        files = {"file": ("upload", file_data, "application/octet-stream")}
        r = await self.client.post(
            f"{self._manager_url}/api/v1/file/upload",
            data={"path": path, "sandbox_id": self._container_name},
            files=files,
        )
        self._raise_if_lease_gone(r)
        return ToolResult(**r.json())

    async def file_download(self, path: str) -> bytes:
        result = await self._ssh_exec(f"base64 '{path}' 2>/dev/null")
        b64 = "".join(result.data.get("stdout", "").split())
        if not b64:
            raise FileNotFoundError(f"File not found or empty: {path}")
        return base64.b64decode(b64)

    # -- lifecycle ---------------------------------------------------------------

    async def destroy(self, failed: bool = False) -> bool:
        try:
            await self.client.aclose()
        except Exception:
            pass
        try:
            headers = {"Authorization": f"Bearer {self._manager_token}"} if self._manager_token else {}
            with httpx.Client(timeout=30, headers=headers) as c:
                c.post(
                    f"{self._manager_url}/sandbox/destroy",
                    json={"sandbox_id": self._container_name, "failed": failed},
                )
            logger.info("Destroyed sandbox %s", self._container_name)
            return True
        except Exception as exc:
            logger.error("Sandbox destroy failed: %s", exc)
            return False

    # -- factories ---------------------------------------------------------------

    @classmethod
    async def create(
        cls,
        manager_url: str,
        manager_token: str,
        user_id: str,
        workspace_paths: List[str] | None = None,
        file_paths: List[str] | None = None,
        session_id: str = "",
        scope_type: str = "",
        scope_id: str = "",
        lane_id: str = "main",
        node_id: str = "",
    ) -> "SandboxClient":
        """Acquire a scoped lease + microVM via the Runtime Coordinator (remediation §6)."""
        session_id = session_id or str(uuid.uuid4())
        if not scope_id:
            scope_type = scope_type or "conversation"
            scope_id = f"{scope_type}:{session_id}"
        scope_type = scope_type or (scope_id.split(":", 1)[0] if ":" in scope_id else "conversation")
        lane_id = lane_id or "main"

        payload = {
            "user_id": user_id,
            "scope_type": scope_type,
            "scope_id": scope_id,
            "lane_id": lane_id,
            "workspace_paths": workspace_paths or [],
            "filename_paths": file_paths or [],
        }
        if node_id:
            payload["node_id"] = node_id
        logger.info(
            "[mcp-fs-audit] CREATE_REQUEST scope=%s lane=%s user=%s "
            "workspace_paths=%s filename_paths=%s filename_paths_count=%s",
            scope_id,
            lane_id,
            user_id,
            workspace_paths or [],
            file_paths or [],
            len(file_paths or []),
        )
        for i, p in enumerate(workspace_paths or []):
            logger.info("[mcp-fs-audit] CREATE_REQUEST workspace_paths[%s]=%s", i, p)
        for i, p in enumerate(file_paths or []):
            logger.info("[mcp-fs-audit] CREATE_REQUEST filename_paths[%s]=%s", i, p)
        headers = {"Authorization": f"Bearer {manager_token}"} if manager_token else {}
        manager_url = manager_url.rstrip("/")

        def _sync_create() -> dict:
            with httpx.Client(timeout=180, headers=headers) as c:
                r = c.post(f"{manager_url}/sandbox/create", json=payload)
                r.raise_for_status()
                d = r.json()
                if d.get("status") in ("queued", "creating"):
                    lease_id = d.get("lease_id") or d.get("leaseId")
                    logger.info("Sandbox queued at position %s — polling…", d.get("position"))
                    for _ in range(120):
                        s = c.get(
                            f"{manager_url}/sandbox/queue/status",
                            params={"lease_id": lease_id},
                        )
                        s.raise_for_status()
                        d = s.json()
                        if d.get("status") in ("running", "busy", "ready"):
                            break
                        if d.get("status") == "failed":
                            raise RuntimeError(f"Sandbox manager: {d.get('message')}")
                        time.sleep(3)
                    else:
                        raise TimeoutError("Queued sandbox timed out after 6 minutes")
                return d

        d = await asyncio.to_thread(_sync_create)

        if d.get("status") == "error":
            raise RuntimeError(f"Sandbox manager error: {d.get('message')}")

        # sandbox_id is the leaseId (deterministic from scope+lane); used for all data-plane calls.
        sandbox_id = d.get("sandbox_id") or d.get("leaseId") or session_id
        ip = d.get("ip")
        if not ip:
            raise RuntimeError(f"No IP returned for sandbox {sandbox_id}: {d}")

        cdp = (d.get("cdp_url") or "").replace("ws://", "http://")
        vnc = d.get("vnc_ws_url", "")
        logger.info(
            "[mcp-fs-audit] CREATE_RESPONSE id=%s ip=%s scope=%s reused=%s "
            "status=%s workspaces_field=%s",
            sandbox_id,
            ip,
            scope_id,
            d.get("reused"),
            d.get("status"),
            d.get("workspaces"),
        )
        return cls(
            ip=ip,
            container_name=sandbox_id,
            manager_url=manager_url,
            manager_token=manager_token,
            cdp_url=cdp,
            vnc_url=vnc,
            scope_type=scope_type,
            scope_id=scope_id,
            lane_id=lane_id,
            user_id=user_id,
        )

    @classmethod
    async def resolve_lease(
        cls,
        manager_url: str,
        manager_token: str,
        scope_type: str,
        scope_id: str,
        lane_id: str = "main",
        user_id: str = "",
    ) -> Optional["SandboxClient"]:
        """Resolve an existing lease via GET /sandbox/lease (coordinator extension)."""
        headers = {"Authorization": f"Bearer {manager_token}"} if manager_token else {}
        manager_url = manager_url.rstrip("/")
        params = {
            "scope_type": scope_type,
            "scope_id": scope_id,
            "lane_id": lane_id or "main",
        }
        try:
            async with httpx.AsyncClient(timeout=30, headers=headers) as c:
                r = await c.get(f"{manager_url}/sandbox/lease", params=params)
                if r.status_code == 404:
                    return None
                r.raise_for_status()
                d = r.json()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 404:
                return None
            logger.warning("Lease lookup failed: %s", exc)
            return None
        except Exception as exc:
            logger.warning("Lease lookup error: %s", exc)
            return None

        if d.get("status") not in ("ready", "running", "busy"):
            return None

        sandbox_id = d.get("lease_id") or d.get("sandbox_id") or d.get("leaseId")
        ip = d.get("ip")
        if not sandbox_id or not ip:
            return None

        cdp = (d.get("cdp_url") or "").replace("ws://", "http://")
        vnc = d.get("vnc_ws_url", "") or d.get("vnc_url", "")
        logger.info(
            "[mcp-fs-audit] LEASE_LOOKUP hit id=%s ip=%s scope=%s reused=%s",
            sandbox_id,
            ip,
            scope_id,
            d.get("reused"),
        )
        return cls(
            ip=ip,
            container_name=sandbox_id,
            manager_url=manager_url,
            manager_token=manager_token,
            cdp_url=cdp,
            vnc_url=vnc,
            scope_type=scope_type,
            scope_id=scope_id,
            lane_id=lane_id or "main",
            user_id=user_id,
        )

    @classmethod
    async def get(
        cls,
        sandbox_id: str,
        manager_url: str,
        manager_token: str,
        scope_type: str = "",
        scope_id: str = "",
        lane_id: str = "main",
        user_id: str = "",
    ) -> Optional["SandboxClient"]:
        """Reconnect to an existing sandbox by ID. Returns None if not found."""
        headers = {"Authorization": f"Bearer {manager_token}"} if manager_token else {}
        manager_url = manager_url.rstrip("/")
        try:
            async with httpx.AsyncClient(timeout=30, headers=headers) as c:
                r = await c.get(f"{manager_url}/sandbox/list")
                r.raise_for_status()
                vms = r.json()
            if isinstance(vms, dict):
                vms = vms.get("sandboxes", vms.get("data", []))
            for vm in vms or []:
                if isinstance(vm, dict) and vm.get("sandbox_id") == sandbox_id:
                    ip = vm.get("ip")
                    if ip:
                        cdp = (vm.get("cdp_url") or "").replace("ws://", "http://")
                        vnc = vm.get("vnc_ws_url", "")
                        logger.info("Reconnected to sandbox %s ip=%s", sandbox_id, ip)
                        return cls(
                            ip=ip,
                            container_name=sandbox_id,
                            manager_url=manager_url,
                            manager_token=manager_token,
                            cdp_url=cdp,
                            vnc_url=vnc,
                            scope_type=scope_type,
                            scope_id=scope_id,
                            lane_id=lane_id,
                            user_id=user_id,
                        )
        except Exception as exc:
            logger.warning("Could not find sandbox %s: %s", sandbox_id, exc)
        return None

    @classmethod
    async def get_or_create(
        cls,
        sandbox_id: str | None,
        manager_url: str,
        manager_token: str,
        user_id: str,
        workspace_paths: List[str] | None = None,
        file_paths: List[str] | None = None,
        scope_type: str = "",
        scope_id: str = "",
        lane_id: str = "main",
    ) -> "SandboxClient":
        """Return existing sandbox by ID if still alive, otherwise create a new one."""
        if sandbox_id:
            existing = await cls.get(
                sandbox_id, manager_url, manager_token,
                scope_type=scope_type, scope_id=scope_id, lane_id=lane_id, user_id=user_id,
            )
            if existing:
                return existing
        return await cls.create(
            manager_url=manager_url,
            manager_token=manager_token,
            user_id=user_id,
            workspace_paths=workspace_paths,
            file_paths=file_paths,
            scope_type=scope_type,
            scope_id=scope_id,
            lane_id=lane_id,
        )
