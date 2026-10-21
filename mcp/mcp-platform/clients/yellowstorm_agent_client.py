"""Agent/Team backend client of the YellowStorm Platform MCP, ported from
mcp/mcp-agent: the agent.mcp.v1 result envelope plus the agent-crud HTTP client
(ADR-0035). Subclasses the shared client with the AGENT prefix so stable error
codes stay module-specific; assertion forwarding is JWT-only (ADR-0033/0024)."""
from typing import Any, Literal

import httpx
from typing_extensions import NotRequired, TypedDict

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


class AgentMcpErrorV1(TypedDict):
    code: str
    message: str
    retryable: bool
    category: ErrorCategory
    details: NotRequired[Any]


class AgentMcpMetaV1(TypedDict):
    correlationId: str
    agentId: NotRequired[str]
    teamId: NotRequired[str]


class AgentMcpResultV1(TypedDict):
    schemaVersion: Literal["agent.mcp.v1"]
    ok: bool
    data: NotRequired[dict[str, Any]]
    error: NotRequired[AgentMcpErrorV1]
    meta: AgentMcpMetaV1


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


def success_result(data: dict[str, Any], correlation_id: str) -> AgentMcpResultV1:
    meta: AgentMcpMetaV1 = {"correlationId": correlation_id}
    for source in ("agentId", "teamId"):
        value = data.get(source)
        if isinstance(value, str):
            meta[source] = value  # type: ignore[literal-required]
    return {
        "schemaVersion": "agent.mcp.v1",
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
) -> AgentMcpResultV1:
    error: AgentMcpErrorV1 = {
        "code": code,
        "message": message,
        "retryable": status_code in (409, 429, 502, 503, 504),
        "category": error_category(status_code),
    }
    if details is not None:
        error["details"] = details
    return {
        "schemaVersion": "agent.mcp.v1",
        "ok": False,
        "error": error,
        "meta": {"correlationId": correlation_id},
    }


class AgentBackendError(BackendError):
    def as_result(self) -> AgentMcpResultV1:
        return failure_result(
            self.code,
            str(self),
            self.status_code,
            require_actor_context().correlation_id,
            self.details,
        )


class YellowStormAgentClient(YellowStormBackendClient):
    def __init__(self, base_url: str, timeout_seconds: float = 60, max_response_bytes: int = 2 * 1024 * 1024, transport: httpx.AsyncBaseTransport | None = None) -> None:
        super().__init__(
            base_url,
            timeout_seconds,
            max_response_bytes,
            transport,
            error_prefix="AGENT",
            error_type=AgentBackendError,
        )

    async def patch(self, path: str, user_id: str, payload: dict[str, Any]) -> Any:
        # The shared base client only implements GET/POST/DELETE/stream; agent-crud
        # updates need PATCH, so the module client owns the verb.
        return await self._request("PATCH", path, user_id, payload)
