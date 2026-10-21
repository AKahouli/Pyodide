from typing import Any

import httpx

from auth import require_actor_context, verified_mcp_jwt
from contracts import SemanticModelMcpResultV1, failure_result


class SemanticModelBackendError(RuntimeError):
    def __init__(self, code: str, message: str, status_code: int, details: Any = None) -> None:
        super().__init__(message)
        self.code = code
        self.status_code = status_code
        self.details = details

    def as_result(self) -> SemanticModelMcpResultV1:
        return failure_result(
            self.code,
            str(self),
            self.status_code,
            require_actor_context().correlation_id,
            self.details,
        )


class YellowStormSemanticModelClient:
    def __init__(self, base_url: str, timeout_seconds: float = 120, max_response_bytes: int = 2 * 1024 * 1024,
                 transport: httpx.AsyncBaseTransport | None = None) -> None:
        self._client = httpx.AsyncClient(
            base_url=base_url,
            timeout=httpx.Timeout(timeout_seconds),
            transport=transport,
        )
        self._max_response_bytes = max_response_bytes

    async def close(self) -> None:
        await self._client.aclose()

    async def get(self, path: str, user_id: str) -> Any:
        return await self._request("GET", path, user_id)

    async def post(self, path: str, user_id: str, payload: dict[str, Any] | None = None) -> Any:
        return await self._request("POST", path, user_id, payload)

    async def patch(self, path: str, user_id: str, payload: dict[str, Any]) -> Any:
        return await self._request("PATCH", path, user_id, payload)

    async def delete(self, path: str, user_id: str) -> Any:
        return await self._request("DELETE", path, user_id)

    async def _request(self, method: str, path: str, user_id: str, payload: dict[str, Any] | None = None) -> Any:
        headers = self._actor_headers()
        try:
            response = await self._client.request(
                method,
                path,
                json=payload,
                headers=headers,
            )
        except httpx.TimeoutException as exc:
            raise SemanticModelBackendError("SEMANTIC_MODEL_TOOL_TIMEOUT", "Semantic model backend request timed out", 504) from exc
        except httpx.HTTPError as exc:
            raise SemanticModelBackendError("SEMANTIC_MODEL_MCP_BACKEND_UNAVAILABLE", "Semantic model backend is unavailable", 503) from exc

        if len(response.content) > self._max_response_bytes:
            raise SemanticModelBackendError("SEMANTIC_MODEL_RESPONSE_TOO_LARGE", "Semantic model backend response exceeded the configured limit", 502)
        body = self._safe_json(response)
        if response.is_error:
            error = body.get("error", {}) if isinstance(body, dict) else {}
            raise SemanticModelBackendError(
                str(error.get("code") or "SEMANTIC_MODEL_MCP_BACKEND_UNAVAILABLE"),
                str(error.get("message") or f"Semantic model backend returned HTTP {response.status_code}"),
                response.status_code,
                error.get("details"),
            )
        if isinstance(body, dict) and body.get("success") is True and "data" in body:
            return body["data"]
        return body

    @staticmethod
    def _actor_headers() -> dict[str, str]:
        context = require_actor_context()
        assertion = verified_mcp_jwt.get()
        if not assertion:
            raise SemanticModelBackendError("SEMANTIC_MODEL_MCP_UNAUTHORIZED", "Missing verified MCP assertion", 401)
        return {"X-YellowStorm-Mcp-Assertion": assertion, "X-Correlation-Id": context.correlation_id}

    @staticmethod
    def _safe_json(response: httpx.Response) -> Any:
        try:
            return response.json()
        except ValueError:
            return {}
