"""HTTP client for runtime → NestJS state-mutation callbacks.

Every method sends a service-to-service token via `X-Service-Token` and
the per-call idempotency key via `X-Event-Id`. NestJS' `WorkyIdempotencyService`
deduplicates the (streamId, eventId) pair, so a retry from the runtime
is safe.

The client is shared per-event-loop; `httpx.AsyncClient` is created
lazily in `start()` and closed in `aclose()`.
"""
from __future__ import annotations

import logging
import uuid
from typing import Any

import httpx

from ..config import Settings

logger = logging.getLogger("worky.backend_client")


SERVICE_TOKEN_HEADER = "X-Service-Token"
EVENT_ID_HEADER = "X-Event-Id"
# NestJS global API prefix is `api` and the default URI version is
# `1` (see YellowStorm/back/src/main.ts), so every internal callback
# lives under `/api/v1/worky/internal/...`. The runtime was
# historically posting to `/api/...` only, which yielded 404 — the
# `/_post` path is built from this constant so all callbacks stay in
# lock-step with the backend.
API_PREFIX = "/api/v1/worky/internal"


class BackendClient:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._client: httpx.AsyncClient | None = None

    async def start(self) -> None:
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=self._settings.backend_base_url,
                timeout=self._settings.request_timeout_seconds,
                headers=self._default_headers(),
            )

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    def _default_headers(self) -> dict[str, str]:
        headers: dict[str, str] = {"Content-Type": "application/json"}
        if self._settings.service_token:
            headers[SERVICE_TOKEN_HEADER] = self._settings.service_token
        return headers

    def _ensure_started(self) -> httpx.AsyncClient:
        if self._client is None:
            raise RuntimeError("BackendClient.start() must be awaited before use")
        return self._client

    @staticmethod
    def new_event_id() -> str:
        return f"worky-{uuid.uuid4().hex}"

    async def plan_delta(
        self,
        stream_id: str,
        body: dict[str, Any],
        event_id: str | None = None,
    ) -> dict[str, Any]:
        return await self._post(
            f"{API_PREFIX}/streams/{stream_id}/plan-delta",
            event_id=event_id,
            json=body,
        )

    async def spawn_worker(
        self,
        stream_id: str,
        body: dict[str, Any],
        event_id: str | None = None,
    ) -> dict[str, Any]:
        return await self._post(
            f"{API_PREFIX}/streams/{stream_id}/spawn-worker",
            event_id=event_id,
            json=body,
        )

    async def request_interaction(
        self,
        stream_id: str,
        body: dict[str, Any],
        event_id: str | None = None,
    ) -> dict[str, Any]:
        return await self._post(
            f"{API_PREFIX}/streams/{stream_id}/interaction",
            event_id=event_id,
            json=body,
        )

    async def governance_check(
        self,
        stream_id: str,
        body: dict[str, Any],
        event_id: str | None = None,
    ) -> dict[str, Any]:
        return await self._post(
            f"{API_PREFIX}/streams/{stream_id}/governance/check",
            event_id=event_id,
            json=body,
        )

    async def budget_reserve(
        self,
        stream_id: str,
        body: dict[str, Any],
        event_id: str | None = None,
    ) -> dict[str, Any]:
        return await self._post(
            f"{API_PREFIX}/streams/{stream_id}/budget/reserve",
            event_id=event_id,
            json=body,
        )

    async def record_cost(
        self,
        stream_id: str,
        body: dict[str, Any],
        event_id: str | None = None,
    ) -> dict[str, Any]:
        return await self._post(
            f"{API_PREFIX}/streams/{stream_id}/cost-event",
            event_id=event_id,
            json=body,
        )

    async def persist_artifact(
        self,
        stream_id: str,
        body: dict[str, Any],
        event_id: str | None = None,
    ) -> dict[str, Any]:
        return await self._post(
            f"{API_PREFIX}/streams/{stream_id}/artifact",
            event_id=event_id,
            json=body,
        )

    async def emit_audit(
        self,
        stream_id: str,
        body: dict[str, Any],
        event_id: str | None = None,
    ) -> dict[str, Any]:
        return await self._post(
            f"{API_PREFIX}/streams/{stream_id}/audit",
            event_id=event_id,
            json=body,
        )

    async def submit_task_result(
        self,
        task_id: str,
        body: dict[str, Any],
        event_id: str | None = None,
    ) -> dict[str, Any]:
        return await self._post(
            f"{API_PREFIX}/tasks/{task_id}/result",
            event_id=event_id,
            json=body,
        )

    async def _post(
        self,
        path: str,
        *,
        event_id: str | None,
        json: dict[str, Any],
    ) -> dict[str, Any]:
        client = self._ensure_started()
        eid = event_id or self.new_event_id()
        logger.debug("POST %s event_id=%s", path, eid)
        response = await client.post(path, json={**json, "eventId": eid}, headers={EVENT_ID_HEADER: eid})
        response.raise_for_status()
        return response.json()
