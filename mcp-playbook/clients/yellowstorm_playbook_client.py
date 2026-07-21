from typing import Any
from collections.abc import AsyncIterator

import httpx


class PlaybookBackendError(RuntimeError):
    def __init__(self, code: str, message: str, status_code: int, details: Any = None) -> None:
        super().__init__(message)
        self.code = code
        self.status_code = status_code
        self.details = details

    def as_result(self) -> dict[str, Any]:
        return {
            "status": "error",
            "code": self.code,
            "message": str(self),
            "retryable": self.status_code in (409, 429, 502, 503, 504),
            "details": self.details,
        }


class YellowStormPlaybookClient:
    def __init__(self, base_url: str, internal_token: str, timeout_seconds: float = 190, max_response_bytes: int = 2 * 1024 * 1024, transport: httpx.AsyncBaseTransport | None = None) -> None:
        if not internal_token:
            raise ValueError("YELLOWSTORM_INTERNAL_SERVICE_TOKEN is required")
        self._client = httpx.AsyncClient(
            base_url=base_url,
            timeout=httpx.Timeout(timeout_seconds),
            transport=transport,
        )
        self._internal_token = internal_token
        self._max_response_bytes = max_response_bytes

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
            "X-Internal-Token": self._internal_token,
            "X-YellowStorm-User-Id": user_id,
            "Last-Event-ID": str(last_event_id),
        }
        try:
            async with self._client.stream("GET", path, headers=headers) as response:
                if response.is_error:
                    body = await response.aread()
                    raise PlaybookBackendError("PLAYBOOK_MCP_BACKEND_UNAVAILABLE", f"Construction stream returned HTTP {response.status_code}", response.status_code, {"bodyLength": len(body)})
                async for chunk in response.aiter_bytes():
                    yield chunk
        except PlaybookBackendError:
            raise
        except httpx.TimeoutException as exc:
            raise PlaybookBackendError("PLAYBOOK_TOOL_TIMEOUT", "Construction stream timed out", 504) from exc
        except httpx.HTTPError as exc:
            raise PlaybookBackendError("PLAYBOOK_MCP_BACKEND_UNAVAILABLE", "Construction stream is unavailable", 503) from exc

    async def _request(self, method: str, path: str, user_id: str, payload: dict[str, Any] | None = None, extra_headers: dict[str, str] | None = None) -> Any:
        try:
            response = await self._client.request(
                method,
                path,
                json=payload,
                headers={
                    "X-Internal-Token": self._internal_token,
                    "X-YellowStorm-User-Id": user_id,
                    **(extra_headers or {}),
                },
            )
        except httpx.TimeoutException as exc:
            raise PlaybookBackendError("PLAYBOOK_TOOL_TIMEOUT", "Playbook backend request timed out", 504) from exc
        except httpx.HTTPError as exc:
            raise PlaybookBackendError("PLAYBOOK_MCP_BACKEND_UNAVAILABLE", "Playbook backend is unavailable", 503) from exc

        if len(response.content) > self._max_response_bytes:
            raise PlaybookBackendError("PLAYBOOK_RESPONSE_TOO_LARGE", "Playbook backend response exceeded the configured limit", 502)
        body = self._safe_json(response)
        if response.is_error:
            error = body.get("error", {}) if isinstance(body, dict) else {}
            raise PlaybookBackendError(
                str(error.get("code") or "PLAYBOOK_MCP_BACKEND_UNAVAILABLE"),
                str(error.get("message") or f"Playbook backend returned HTTP {response.status_code}"),
                response.status_code,
                error.get("details"),
            )
        if isinstance(body, dict) and body.get("success") is True and "data" in body:
            return body["data"]
        return body

    @staticmethod
    def _safe_json(response: httpx.Response) -> Any:
        try:
            return response.json()
        except ValueError:
            return {}
