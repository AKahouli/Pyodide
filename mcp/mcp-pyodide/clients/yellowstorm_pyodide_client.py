from typing import Any

import httpx

from auth import input_file_names, require_actor_context, verified_mcp_jwt, workspace_id


class PyodideBackendError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class YellowStormPyodideClient:
    def __init__(
        self,
        base_url: str,
        timeout_seconds: float = 100,
        max_response_bytes: int = 512 * 1024,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._client = httpx.AsyncClient(
            base_url=base_url,
            timeout=httpx.Timeout(timeout_seconds),
            transport=transport,
        )
        self._max_response_bytes = max_response_bytes

    async def close(self) -> None:
        await self._client.aclose()

    async def execute(self, payload: dict[str, Any]) -> Any:
        return await self._post_relay(
            "/api/v1/internal/pyodide-runtime/execute",
            payload,
            "Pyodide execution timed out",
        )

    async def _post_relay(self, path: str, payload: dict[str, Any], timeout_message: str) -> Any:
        try:
            response = await self._client.post(
                path,
                json=payload,
                headers=self._actor_headers(),
            )
        except httpx.TimeoutException as exc:
            raise PyodideBackendError("PYODIDE_EXECUTION_TIMEOUT", timeout_message) from exc
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
        assertion = verified_mcp_jwt.get()
        # Fail closed: only the verified backend-signed assertion authorizes the relay call.
        if not assertion:
            raise PyodideBackendError("PYODIDE_MCP_UNAUTHORIZED", "Missing verified MCP assertion")
        headers = {
            # Execution selectors are checked against backend-owned turn bindings;
            # only the signed assertion supplies the acting user identity.
            "X-YellowStorm-Mcp-Assertion": assertion,
            "X-Correlation-Id": context.correlation_id,
        }
        if context.agent_id:
            headers["X-YellowStorm-Agent-Id"] = context.agent_id
        if context.conversation_id:
            headers["X-YellowStorm-Conversation-Id"] = context.conversation_id
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
