from typing import Any
from collections.abc import AsyncIterator

import httpx

from auth import require_actor_context, verified_mcp_jwt


class BackendError(RuntimeError):
    def __init__(self, code: str, message: str, status_code: int, details: Any = None) -> None:
        super().__init__(message)
        self.code = code
        self.status_code = status_code
        self.details = details


class YellowStormBackendClient:
    """Shared backend plumbing for every platform tool module: one HTTP session
    with the configured timeout and response cap, signed-assertion forwarding and
    error translation. Tool modules subclass it with their error prefix and type
    so stable error codes stay module-specific (e.g. PLAYBOOK_TOOL_TIMEOUT)."""

    def __init__(
        self,
        base_url: str,
        timeout_seconds: float = 190,
        max_response_bytes: int = 2 * 1024 * 1024,
        transport: httpx.AsyncBaseTransport | None = None,
        error_prefix: str = "BACKEND",
        error_type: type[BackendError] = BackendError,
    ) -> None:
        self._client = httpx.AsyncClient(
            base_url=base_url,
            timeout=httpx.Timeout(timeout_seconds),
            transport=transport,
        )
        self._max_response_bytes = max_response_bytes
        self._prefix = error_prefix
        self._error = error_type

    async def close(self) -> None:
        await self._client.aclose()

    async def get(self, path: str, user_id: str) -> Any:
        return await self._request("GET", path, user_id)

    async def post(self, path: str, user_id: str, payload: dict[str, Any], idempotency_key: str | None = None) -> Any:
        headers = {"Idempotency-Key": idempotency_key} if idempotency_key else None
        return await self._request("POST", path, user_id, payload, headers)

    async def delete(self, path: str, user_id: str) -> Any:
        return await self._request("DELETE", path, user_id)

    async def stream(self, path: str, user_id: str, last_event_id: int = 0) -> AsyncIterator[bytes]:
        headers = {
            "Last-Event-ID": str(last_event_id),
            **self._actor_headers(),
        }
        try:
            async with self._client.stream("GET", path, headers=headers) as response:
                if response.is_error:
                    body = await response.aread()
                    raise self._error(f"{self._prefix}_MCP_BACKEND_UNAVAILABLE", f"Construction stream returned HTTP {response.status_code}", response.status_code, {"bodyLength": len(body)})
                async for chunk in response.aiter_bytes():
                    yield chunk
        except BackendError:
            raise
        except httpx.TimeoutException as exc:
            raise self._error(f"{self._prefix}_TOOL_TIMEOUT", "Construction stream timed out", 504) from exc
        except httpx.HTTPError as exc:
            raise self._error(f"{self._prefix}_MCP_BACKEND_UNAVAILABLE", "Construction stream is unavailable", 503) from exc

    async def _request(self, method: str, path: str, user_id: str, payload: dict[str, Any] | None = None, extra_headers: dict[str, str] | None = None) -> Any:
        try:
            response = await self._client.request(
                method,
                path,
                json=payload,
                headers={
                    **self._actor_headers(),
                    **(extra_headers or {}),
                },
            )
        except httpx.TimeoutException as exc:
            raise self._error(f"{self._prefix}_TOOL_TIMEOUT", "YellowStorm backend request timed out", 504) from exc
        except httpx.HTTPError as exc:
            raise self._error(f"{self._prefix}_MCP_BACKEND_UNAVAILABLE", "YellowStorm backend is unavailable", 503) from exc

        if len(response.content) > self._max_response_bytes:
            raise self._error(f"{self._prefix}_RESPONSE_TOO_LARGE", "YellowStorm backend response exceeded the configured limit", 502)
        body = self._safe_json(response)
        if response.is_error:
            error = body.get("error", {}) if isinstance(body, dict) else {}
            raise self._error(
                str(error.get("code") or f"{self._prefix}_MCP_BACKEND_UNAVAILABLE"),
                str(error.get("message") or f"YellowStorm backend returned HTTP {response.status_code}"),
                response.status_code,
                error.get("details"),
            )
        if isinstance(body, dict) and body.get("success") is True and "data" in body:
            return body["data"]
        return body

    def _actor_headers(self) -> dict[str, str]:
        context = require_actor_context()
        assertion = verified_mcp_jwt.get()
        if not assertion:
            raise self._error(f"{self._prefix}_MCP_UNAUTHORIZED", "Missing verified MCP assertion", 401)
        return {
            "X-YellowStorm-Mcp-Assertion": assertion,
            "X-Correlation-Id": context.correlation_id,
            # Execution selectors are checked against backend-owned turn bindings;
            # only the signed assertion supplies the acting user identity.
            "X-YellowStorm-Conversation-Id": context.conversation_id,
        }

    @staticmethod
    def _safe_json(response: httpx.Response) -> Any:
        try:
            return response.json()
        except ValueError:
            return {}
