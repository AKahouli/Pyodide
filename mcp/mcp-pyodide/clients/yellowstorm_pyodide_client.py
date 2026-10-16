from typing import Any

import httpx

from auth import input_file_names, require_actor_context, workspace_id


class PyodideBackendError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class YellowStormPyodideClient:
    def __init__(
        self,
        base_url: str,
        internal_token: str,
        timeout_seconds: float = 100,
        max_response_bytes: int = 512 * 1024,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
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

    async def execute(self, payload: dict[str, Any]) -> Any:
        headers = {
            "X-Internal-Token": self._internal_token,
            **self._actor_headers(),
        }
        try:
            response = await self._client.post(
                "/api/v1/internal/pyodide-runtime/execute",
                json=payload,
                headers=headers,
            )
        except httpx.TimeoutException as exc:
            raise PyodideBackendError("PYODIDE_EXECUTION_TIMEOUT", "Pyodide execution timed out") from exc
        except httpx.HTTPError as exc:
            raise PyodideBackendError("PYODIDE_RUNTIME_OFFLINE", "Pyodide runtime relay is unavailable") from exc

        if len(response.content) > self._max_response_bytes:
            raise PyodideBackendError("PYODIDE_RESULT_TOO_LARGE", "Pyodide result exceeded the configured limit")

        body = self._safe_json(response)
        if response.is_error:
            # Nest can answer with {error: {code, message}}, a bare {message}, or no error field at all.
            error = body.get("error") if isinstance(body, dict) else None
            if isinstance(error, dict):
                code = error.get("code")
                message = error.get("message")
            elif isinstance(error, str):
                code, message = None, error
            else:
                code, message = None, body.get("message") if isinstance(body, dict) else None
            raise PyodideBackendError(
                str(code or "PYODIDE_EXECUTION_ERROR"),
                str(message or f"Pyodide relay returned HTTP {response.status_code}"),
            )
        return body

    @staticmethod
    def _actor_headers() -> dict[str, str]:
        context = require_actor_context()
        headers = {"X-YellowStorm-User-Id": context.user_id}
        if context.agent_id:
            headers["X-YellowStorm-Agent-Id"] = context.agent_id
        if context.conversation_id:
            headers["X-YellowStorm-Conversation-Id"] = context.conversation_id
        if context.correlation_id:
            headers["X-Correlation-Id"] = context.correlation_id
        workspace = workspace_id.get()
        if workspace:
            headers["X-YellowStorm-Workspace-Id"] = workspace
        names = input_file_names.get()
        if names:
            headers["X-YellowStorm-Input-Files"] = ",".join(names)
        return headers

    @staticmethod
    def _safe_json(response: httpx.Response) -> Any:
        try:
            return response.json()
        except ValueError:
            return {}
