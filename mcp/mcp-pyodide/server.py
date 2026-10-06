import json
import os
from typing import Any

from fastmcp import FastMCP
from starlette.middleware import Middleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from auth import TrustedIdentityMiddleware, require_actor_context
from clients.yellowstorm_pyodide_client import PyodideBackendError, YellowStormPyodideClient
from config import Settings
from contracts import error_result


INSTRUCTIONS = """Execute Python code in the user's browser using Pyodide.

Use it for calculations, Python data transformations and supported scientific Python libraries such as NumPy and pandas.

The runtime has no server shell, system processes, native binaries or raw sockets. Execution requires the
user's Yellowmind browser to be connected.

Return JSON-compatible values when possible."""

settings = Settings.from_env()
try:  # Unified logging is provided by the shared runtime when deployed.
    from yellowmind_observability import setup_observability
except Exception:  # pragma: no cover - optional dependency in bare test installs
    def setup_observability(**_kwargs: Any) -> None:
        return None

setup_observability(service_name=os.environ.get("OBS_SERVICE_NAME") or "mcp-pyodide")
mcp = FastMCP("Pyodide MCP", instructions=INSTRUCTIONS)
_client: YellowStormPyodideClient | None = None


def backend() -> YellowStormPyodideClient:
    global _client
    if _client is None:
        _client = YellowStormPyodideClient(
            settings.backend_url,
            settings.internal_token,
            settings.timeout_seconds,
            settings.max_response_bytes,
        )
    return _client


def _input_bytes(value: Any) -> int:
    if value is None:
        return 0
    try:
        return len(json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))
    except (TypeError, ValueError):
        raise ValueError("input must be JSON-compatible")


@mcp.custom_route("/health/live", methods=["GET"])
async def health_live(_request: Request) -> JSONResponse:
    return JSONResponse({"status": "ok"})


@mcp.custom_route("/health/ready", methods=["GET"])
async def health_ready(_request: Request) -> JSONResponse:
    try:
        settings.validate()
    except ValueError:
        return JSONResponse({"status": "not_ready"}, status_code=503)
    return JSONResponse({"status": "ready"})


@mcp.tool()
async def execute_python(
    code: str,
    input: Any = None,
    timeout_seconds: int = 30,
) -> dict[str, Any]:
    """Execute bounded Python code in the user's connected browser and return its result and logs."""
    try:
        require_actor_context()
    except RuntimeError:
        return error_result(
            "PYODIDE_EXECUTION_ERROR",
            "The connector did not provide a trusted acting user.",
        )
    if not isinstance(code, str) or not code.strip():
        return error_result("PYODIDE_EXECUTION_ERROR", "code must be a non-empty string")
    if len(code.encode("utf-8")) > settings.max_code_bytes:
        return error_result("PYODIDE_REQUEST_TOO_LARGE", "code exceeded the configured limit")
    if not isinstance(timeout_seconds, int) or timeout_seconds < 1:
        return error_result("PYODIDE_EXECUTION_ERROR", "timeout_seconds must be a positive integer")
    if timeout_seconds > settings.max_timeout_seconds:
        return error_result("PYODIDE_EXECUTION_ERROR", f"timeout_seconds must not exceed {settings.max_timeout_seconds}")
    try:
        if _input_bytes(input) > settings.max_input_bytes:
            return error_result("PYODIDE_REQUEST_TOO_LARGE", "input exceeded the configured limit")
    except ValueError as exc:
        return error_result("PYODIDE_EXECUTION_ERROR", str(exc))

    try:
        return await backend().execute({
            "code": code,
            "input": input,
            "timeoutMs": timeout_seconds * 1000,
        })
    except PyodideBackendError as exc:
        return error_result(exc.code, str(exc))


if __name__ == "__main__":
    settings.validate()
    middleware = [Middleware(
        TrustedIdentityMiddleware,
        ingress_token=settings.ingress_token,
    )]
    mcp.run(
        transport="streamable-http",
        host="0.0.0.0",
        port=settings.port,
        middleware=middleware,
    )
