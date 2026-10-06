import json
import os
import re
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


_SAFE_FILE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._ -]{0,254}$")


def _safe_file_name(value: Any) -> str:
    """A bare filename (no path, no traversal): the model never provides storage paths (§27)."""
    name = str(value or "").strip()
    if not name or ".." in name or "/" in name or "\\" in name or not _SAFE_FILE_NAME.fullmatch(name):
        raise ValueError("file names must be simple basenames without paths")
    return name


def _input_file_specs(raw: Any) -> list[dict[str, str]]:
    """Logical references only: a workspace document id or an exact file name, never a path/URL."""
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise ValueError("inputs must be a list of {document_id|name, as?}")
    specs: list[dict[str, str]] = []
    for item in raw:
        if not isinstance(item, dict):
            raise ValueError("each input must be an object")
        document_id = str(item.get("document_id") or "").strip()
        name = str(item.get("name") or "").strip()
        if bool(document_id) == bool(name):
            raise ValueError("each input must set exactly one of document_id or name")
        spec = {"as": _safe_file_name(item.get("as") or name)}
        if document_id:
            spec["document_id"] = document_id
        else:
            spec["name"] = name
        specs.append(spec)
    return specs


def _output_file_names(raw: Any) -> list[str]:
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise ValueError("outputs must be a list of file names")
    return [_safe_file_name(item) for item in raw]


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
    inputs: list[dict[str, Any]] | None = None,
    outputs: list[str] | None = None,
) -> dict[str, Any]:
    """Execute bounded Python code in the user's connected browser and return its result and logs.

    Optionally read workspace files (logical references only: ``inputs=[{"document_id"| "name": ..., "as": ...}]``)
    mounted under /workspace/input, and capture named files from /workspace/output as artifacts.
    """
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
        input_files = _input_file_specs(inputs)
        output_files = _output_file_names(outputs)
    except ValueError as exc:
        return error_result("PYODIDE_EXECUTION_ERROR", str(exc))
    if len(input_files) > settings.max_input_files:
        return error_result("PYODIDE_REQUEST_TOO_LARGE", f"inputs must not exceed {settings.max_input_files} files")
    if len(output_files) > settings.max_output_files:
        return error_result("PYODIDE_REQUEST_TOO_LARGE", f"outputs must not exceed {settings.max_output_files} files")

    payload: dict[str, Any] = {
        "code": code,
        "input": input,
        "timeoutMs": timeout_seconds * 1000,
    }
    if input_files:
        payload["inputs"] = input_files
    if output_files:
        payload["outputs"] = output_files

    try:
        return await backend().execute(payload)
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
