from typing import Any

import httpx

from src.config.settings import get_settings
from src.infrastructure.run_code.context import RunCodeContext
from src.logger.logging import get_logger


logger = get_logger("api.infrastructure.run_code.client")


class RunCodeClient:
    async def execute(
        self,
        *,
        code: str,
        input_value: Any,
        context: RunCodeContext,
    ) -> dict[str, Any]:
        settings = get_settings()
        url = settings.RUN_CODE_RUNTIME_URL.rstrip("/") + "/v1/execute"
        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(settings.RUN_CODE_REQUEST_TIMEOUT_SECONDS)
            ) as client:
                response = await client.post(
                    url,
                    headers={
                        "Authorization": f"Bearer {settings.RUN_CODE_RUNTIME_API_KEY}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "code": code,
                        "input": input_value,
                        "context": context.model_dump(),
                    },
                )
        except (httpx.TimeoutException, httpx.TransportError):
            logger.warning("run_code_transport_error")
            return {
                "ok": False,
                "error": {
                    "code": "RUNTIME_UNAVAILABLE",
                    "message": "The lightweight code runtime is unavailable.",
                },
                "logs": [],
                "written_files": [],
            }

        try:
            payload = response.json()
        except ValueError:
            payload = {}
        if not isinstance(payload, dict):
            payload = {}
        if response.status_code >= 500 and not payload.get("error"):
            payload = {
                "ok": False,
                "error": {
                    "code": "RUNTIME_UNAVAILABLE",
                    "message": "The lightweight code runtime is unavailable.",
                },
            }
        return self._normalize(payload)

    def _normalize(self, payload: dict[str, Any]) -> dict[str, Any]:
        execution = payload.get("execution")
        execution = execution if isinstance(execution, dict) else {}
        files = payload.get("writtenFiles")
        files = files if isinstance(files, list) else []
        normalized: dict[str, Any] = {
            "ok": payload.get("ok") is True,
            "logs": payload.get("logs") if isinstance(payload.get("logs"), list) else [],
            "written_files": files,
            "execution_ms": int(execution.get("durationMs") or 0),
        }
        if normalized["ok"]:
            normalized["result"] = payload.get("result")
        else:
            error = payload.get("error")
            normalized["error"] = error if isinstance(error, dict) else {
                "code": "RUNTIME_ERROR",
                "message": "Lightweight code execution failed.",
            }
        return normalized
