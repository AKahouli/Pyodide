from __future__ import annotations

import asyncio
import json
from collections.abc import Awaitable, Callable
from typing import Any


DEFAULT_SANDBOX_CALLS_PER_STEP = 30
MAX_SANDBOX_CALLS_PER_STEP = 100


def sandbox_call_limit_message(limit: int) -> str:
    return (
        f"Error: Code Interpreter sandbox call limit reached ({limit} per step). "
        "Finish with available results or report the step as blocked."
    )


class SandboxMountValidationError(RuntimeError):
    pass


class SandboxCallBudget:
    def __init__(self, limit: int = DEFAULT_SANDBOX_CALLS_PER_STEP) -> None:
        self._limit = min(MAX_SANDBOX_CALLS_PER_STEP, max(1, int(limit)))
        self._count = 0
        self._lock = asyncio.Lock()

    @property
    def limit_message(self) -> str:
        return sandbox_call_limit_message(self._limit)

    async def try_acquire(self) -> bool:
        async with self._lock:
            if self._count >= self._limit:
                return False
            self._count += 1
            return True


class SandboxMountGuard:
    def __init__(
        self,
        expected_inputs: list[dict[str, str]],
        available_actions: set[str],
    ) -> None:
        self._expected_inputs = expected_inputs
        self._available_actions = available_actions
        self._create_started = False
        self._ready = asyncio.Event()
        self._failure: str | None = None

    async def create_validated(
        self,
        call: Callable[[str, dict[str, Any]], Awaitable[Any]],
        create_params: dict[str, Any],
    ) -> Any:
        if self._create_started:
            raise SandboxMountValidationError(
                "Sandbox creation already attempted for this step; repeated discovery is disabled"
            )
        self._create_started = True
        try:
            required_actions = {"file_list", "sandbox_destroy"}
            if not required_actions.issubset(self._available_actions):
                raise SandboxMountValidationError(
                    "Code interpreter lacks the actions required for bounded mount validation"
                )

            created = await call("sandbox_create", create_params)
            missing = await self._missing_inputs(call)
            if missing:
                await call("sandbox_destroy", {})
                created = await call("sandbox_create", create_params)
                missing = await self._missing_inputs(call)
            if missing:
                aliases = ", ".join(missing)
                recreation_error = (
                    f"Sandbox recreation failed: {created}\n"
                    if _validation_failed(created)
                    else ""
                )
                raise SandboxMountValidationError(
                    f"{recreation_error}Required sandbox inputs were not mounted "
                    f"after one recreation: {aliases}"
                )

            if isinstance(created, str):
                paths = ", ".join(item["path"] for item in self._expected_inputs)
                return f"{created}\nValidated sandbox inputs: {paths}"
            return created
        except BaseException as exc:
            self._failure = str(exc)
            raise
        finally:
            self._ready.set()

    async def wait_until_ready(self) -> None:
        if not self._create_started:
            raise SandboxMountValidationError(
                "Create and validate the sandbox before using Code Interpreter tools"
            )
        await self._ready.wait()
        if self._failure is not None:
            raise SandboxMountValidationError(
                "Sandbox input validation did not complete successfully"
            )

    def allows_discovery(self, action: str, params: dict[str, Any]) -> bool:
        if action != "file_list":
            return False
        requested = str(params.get("path") or "").rstrip("/")
        return any(
            item.get("kind") == "directory"
            and str(item.get("path") or "").rstrip("/") == requested
            for item in self._expected_inputs
        )

    @property
    def authoritative_paths(self) -> list[str]:
        return [item["path"] for item in self._expected_inputs]

    async def _missing_inputs(
        self,
        call: Callable[[str, dict[str, Any]], Awaitable[Any]],
    ) -> list[str]:
        missing: list[str] = []
        for item in self._expected_inputs:
            path = item["path"]
            check_path = f"{path.rstrip('/')}/" if item.get("kind") == "directory" else path
            response = await call("file_list", {"path": check_path})
            if _validation_failed(response):
                missing.append(path.rsplit("/", 1)[-1] or path)
        return missing


def _validation_failed(response: Any) -> bool:
    text = response if isinstance(response, str) else json.dumps(response, default=str)
    normalized = text.strip().lower()
    return not normalized or normalized.startswith(("error", "connector action")) or any(
        marker in normalized
        for marker in (
            "no such file or directory",
            "cannot access",
            "file not found",
            "sandbox acquire failed",
            "create_failed",
        )
    )
