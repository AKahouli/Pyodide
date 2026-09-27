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
