"""Semantic-model backend client of the YellowStorm Platform MCP, ported from
mcp/mcp-semantic-model: JWT-only assertion forwarding and module-specific
SEMANTIC_MODEL_* error codes preserved exactly. It also carries the module's
semantic_model.mcp.v1 result contract, which stays out of the shared
contracts.py (playbook-scoped envelope) in this phase."""
from typing import Any, Literal

from typing_extensions import NotRequired, TypedDict

import httpx

from auth import require_actor_context
from clients.base import BackendError, YellowStormBackendClient


ErrorCategory = Literal[
    "validation",
    "authorization",
    "conflict",
    "not_found",
    "rate_limit",
    "dependency",
    "internal",
]


class SemanticModelMcpErrorV1(TypedDict):
    code: str
    message: str
    retryable: bool
    category: ErrorCategory
    details: NotRequired[Any]


class SemanticModelMcpMetaV1(TypedDict):
    correlationId: str
    modelId: NotRequired[str]
    modelName: NotRequired[str]
    changeId: NotRequired[str]


class SemanticModelMcpResultV1(TypedDict):
    schemaVersion: Literal["semantic_model.mcp.v1"]
    ok: bool
    data: NotRequired[dict[str, Any]]
    error: NotRequired[SemanticModelMcpErrorV1]
    meta: SemanticModelMcpMetaV1


def error_category(status_code: int) -> ErrorCategory:
    if status_code == 400:
        return "validation"
    if status_code in (401, 403):
        return "authorization"
    if status_code == 404:
        return "not_found"
    if status_code == 409:
        return "conflict"
    if status_code == 429:
        return "rate_limit"
    if status_code in (502, 503, 504):
        return "dependency"
    return "internal"


def success_result(data: dict[str, Any], correlation_id: str) -> SemanticModelMcpResultV1:
    meta: SemanticModelMcpMetaV1 = {"correlationId": correlation_id}
    for source in ("modelId", "changeId"):
        value = data.get(source)
        if isinstance(value, str):
            meta[source] = value  # type: ignore[literal-required]
    model = data.get("model")
    if isinstance(model, dict):
        if isinstance(model.get("id"), str):
            meta["modelId"] = model["id"]
        if isinstance(model.get("name"), str):
            meta["modelName"] = model["name"]
    return {
        "schemaVersion": "semantic_model.mcp.v1",
        "ok": True,
        "data": data,
        "meta": meta,
    }


def failure_result(
    code: str,
    message: str,
    status_code: int,
    correlation_id: str,
    details: Any = None,
) -> SemanticModelMcpResultV1:
    error: SemanticModelMcpErrorV1 = {
        "code": code,
        "message": message,
        "retryable": status_code in (409, 429, 502, 503, 504),
        "category": error_category(status_code),
    }
    if details is not None:
        error["details"] = details
    return {
        "schemaVersion": "semantic_model.mcp.v1",
        "ok": False,
        "error": error,
        "meta": {"correlationId": correlation_id},
    }


class SemanticModelBackendError(BackendError):
    def as_result(self) -> SemanticModelMcpResultV1:
        return failure_result(
            self.code,
            str(self),
            self.status_code,
            require_actor_context().correlation_id,
            self.details,
        )


class YellowStormSemanticModelClient(YellowStormBackendClient):
    def __init__(self, base_url: str, timeout_seconds: float = 120, max_response_bytes: int = 2 * 1024 * 1024,
                 transport: httpx.AsyncBaseTransport | None = None) -> None:
        super().__init__(
            base_url,
            timeout_seconds,
            max_response_bytes,
            transport,
            error_prefix="SEMANTIC_MODEL",
            error_type=SemanticModelBackendError,
        )

    async def post(self, path: str, user_id: str, payload: dict[str, Any] | None = None) -> Any:
        # Undo/publish/run/stop posts carry no body; keep the old wire shape.
        return await self._request("POST", path, user_id, payload)
