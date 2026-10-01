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


class PlaybookMcpErrorV1(TypedDict):
    code: str
    message: str
    retryable: bool
    category: ErrorCategory
    details: NotRequired[Any]


class PlaybookMcpMetaV1(TypedDict):
    correlationId: str
    playbookId: NotRequired[str]
    operationId: NotRequired[str]
    uiTarget: NotRequired[dict[str, Any]]


class PlaybookMcpResultV1(TypedDict):
    schemaVersion: Literal["playbook.mcp.v1"]
    ok: bool
    data: NotRequired[dict[str, Any]]
    error: NotRequired[PlaybookMcpErrorV1]
    meta: PlaybookMcpMetaV1


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


def success_result(data: dict[str, Any], correlation_id: str) -> PlaybookMcpResultV1:
    meta: PlaybookMcpMetaV1 = {"correlationId": correlation_id}
    for source, target in (
        ("playbookId", "playbookId"),
        ("operationId", "operationId"),
        ("uiTarget", "uiTarget"),
    ):
        value = data.get(source)
        if isinstance(value, str) or (source == "uiTarget" and isinstance(value, dict)):
            meta[target] = value  # type: ignore[literal-required]
    return {
        "schemaVersion": "playbook.mcp.v1",
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
) -> PlaybookMcpResultV1:
    error: PlaybookMcpErrorV1 = {
        "code": code,
        "message": message,
        "retryable": status_code in (409, 429, 502, 503, 504),
        "category": error_category(status_code),
    }
    if details is not None:
        error["details"] = details
    return {
        "schemaVersion": "playbook.mcp.v1",
        "ok": False,
        "error": error,
        "meta": {"correlationId": correlation_id},
    }
