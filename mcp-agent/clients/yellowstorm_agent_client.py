from typing import Any

import httpx

from auth import require_actor_context
from contracts import AgentMcpResultV1, failure_result


class AgentBackendError(RuntimeError):
    def __init__(self, code: str, message: str, status_code: int, details: Any = None) -> None:
        super().__init__(message)
        self.code = code
        self.status_code = status_code
        self.details = details

    def as_result(self) -> AgentMcpResultV1:
        return failure_result(
            self.code,
            str(self),
            self.status_code,
            require_actor_context().correlation_id,
            self.details,
        )


class YellowStormAgentClient:
    def __init__(self, base_url: str, internal_token: str, timeout_seconds: float = 60, max_response_bytes: int = 2 * 1024 * 1024, transport: httpx.AsyncBaseTransport | None = None) -> None:
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

    async def post(self, path: str, user_id: str, payload: dict[str, Any] | None = None) -> Any:
        return await self._request("POST", path, user_id, payload)

    async def patch(self, path: str, user_id: str, payload: dict[str, Any]) -> Any:
        return await self._request("PATCH", path, user_id, payload)

    async def delete(self, path: str, user_id: str) -> Any:
        return await self._request("DELETE", path, user_id)

    async def _request(self, method: str, path: str, user_id: str, payload: dict[str, Any] | None = None) -> Any:
        try:
            response = await self._client.request(
                method,
                path,
                json=payload,
                headers={
                    "X-Internal-Token": self._internal_token,
                    "X-YellowStorm-User-Id": user_id,
                    **self._actor_headers(),
                },
            )
        except httpx.TimeoutException as exc:
            raise AgentBackendError("AGENT_TOOL_TIMEOUT", "Agent backend request timed out", 504) from exc
        except httpx.HTTPError as exc:
            raise AgentBackendError("AGENT_MCP_BACKEND_UNAVAILABLE", "Agent backend is unavailable", 503) from exc

        if len(response.content) > self._max_response_bytes:
            raise AgentBackendError("AGENT_RESPONSE_TOO_LARGE", "Agent backend response exceeded the configured limit", 502)
        body = self._safe_json(response)
        if response.is_error:
            error = body.get("error", {}) if isinstance(body, dict) else {}
            raise AgentBackendError(
                str(error.get("code") or "AGENT_MCP_BACKEND_UNAVAILABLE"),
                str(error.get("message") or f"Agent backend returned HTTP {response.status_code}"),
                response.status_code,
                error.get("details"),
            )
        if isinstance(body, dict) and body.get("success") is True and "data" in body:
            return body["data"]
        return body

    @staticmethod
    def _actor_headers() -> dict[str, str]:
        context = require_actor_context()
        return {
            "X-YellowStorm-User-Id": context.user_id,
            "X-YellowStorm-Agent-Id": context.agent_id,
            "X-YellowStorm-Conversation-Id": context.conversation_id,
            "X-Correlation-Id": context.correlation_id,
        }

    @staticmethod
    def _safe_json(response: httpx.Response) -> Any:
        try:
            return response.json()
        except ValueError:
            return {}
