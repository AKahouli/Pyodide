from typing import Any, Literal

from typing_extensions import NotRequired, TypedDict


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
