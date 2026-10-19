"""Public failure diagnostics: metadata only, never exception payloads or source."""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

_HINTS = {
    "invalid_command": "The queued command is invalid; submit a new run with valid settings.",
    "workspace_required": "A workspace is required; select the source workspace.",
    "workspace_forbidden": "Source access could not be verified; check workspace permissions.",
    "invalid_source": "Source metadata is invalid; check the source mapping.",
    "parser_failed": "Source parsing failed; check the source format and parser configuration.",
    "invalid_specification": "The model specification is invalid; correct it before retrying.",
    "execution_fingerprint_mismatch": "The queued configuration is stale; submit a new run.",
    "no_data_in_use": "No population data is active; populate the model before rebuilding.",
    "manual_snapshot_unavailable": "The manual source snapshot is unavailable; check the source binding.",
    "index_stalled": "Index build stopped making progress; check embedding service availability.",
    "index_interrupted": "Index build was interrupted; check worker and embedding service availability.",
    "attempts_exhausted": "The retry limit was reached; inspect the first failure before retrying.",
}


def _token(value: Any, fallback: str = "unknown") -> str:
    # Identifiers are metadata, not a channel for arbitrary exception messages.
    return value[:128] if isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9_.:-]{1,128}", value) else fallback


def _summary(exc: BaseException) -> dict[str, Any]:
    kind = _token(type(exc).__name__, "Exception")
    message = "Runtime operation failed; inspect the exception type and frame locations."
    if kind == "DataError":
        message = "Database rejected a bound argument; verify parameter types."
        # asyncpg embeds the argument VALUE before the parenthesized reason. Only
        # copy an anchored numeric position and an allowlisted type pair, never it.
        raw = exc.args[0] if exc.args and isinstance(exc.args[0], str) else ""
        match = re.match(r"invalid input for query argument \$(\d{1,6}):", raw)
        if match:
            message = f"Database rejected bound argument ${match[1]}; verify parameter types."
        pair = re.search(r"\(expected (str|int|float|bytes|bool), got (str|int|float|bytes|bool|dict|list|NoneType)\)$", raw)
        if pair:
            message += f" Expected {pair[1]}, got {pair[2]}."
    elif isinstance(exc, TimeoutError):
        message = "Operation timed out; check service availability and configured time limits."
    elif kind in {"AttributeExtractionError", "AssetFetchError", "EmbeddingError", "DataSourceError", "PopulationError"}:
        message = {
            "AttributeExtractionError": "AI extraction failed; verify extraction configuration and provider availability.",
            "AssetFetchError": "Source delivery failed; verify source access and backend availability.",
            "EmbeddingError": "Embedding failed; verify the embedding profile, service access and response format.",
            "DataSourceError": "Datasource processing failed; verify the source format and mapping.",
            "PopulationError": "Population validation failed; verify the specification and source bindings.",
        }[kind]
    result: dict[str, Any] = {"errorType": kind, "message": message}
    state = getattr(exc, "sqlstate", None)
    if isinstance(state, str) and re.fullmatch(r"[A-Z0-9]{5}", state):
        result["sqlState"] = state
    status = getattr(exc, "status_code", None)
    if status is None:
        status = getattr(getattr(exc, "response", None), "status_code", None)
    if type(status) is int and 100 <= status <= 599:
        result["httpStatus"] = status
        result["message"] = f"Upstream service returned HTTP {status}; check access and service availability."
    return result


def capture_error(exc: BaseException, *, code: str | None = None,
                  phase: str | None = None, attempt: int | None = None,
                  job_id: str | None = None, task_id: int | None = None,
                  index_id: str | None = None) -> dict[str, Any]:
    result = {"code": _token(code or getattr(exc, "code", None), _token(type(exc).__name__, "Exception")),
              **_summary(exc), "occurredAt": datetime.now(timezone.utc).isoformat()}
    if result["code"] in _HINTS:
        result["message"] = _HINTS[result["code"]]
    for key, value in (("phase", phase), ("jobId", job_id), ("taskId", str(task_id) if task_id is not None else None),
                       ("indexId", index_id)):
        if value is not None:
            result[key] = _token(value)
    if type(attempt) is int and attempt >= 0:
        result["attempt"] = attempt
    frames = []
    tb = exc.__traceback__
    while tb:
        filename = tb.tb_frame.f_code.co_filename.replace("\\", "/")
        # Retain app-relative points, otherwise only the basename; no source/locals.
        filename = "app/" + filename.rsplit("/app/", 1)[1] if "/app/" in filename else filename.rsplit("/", 1)[-1]
        frames.append({"file": filename.encode("utf-8")[:512].decode("utf-8", "ignore"),
                       "function": _token(tb.tb_frame.f_code.co_name), "line": tb.tb_lineno})
        frames = frames[-8:]
        tb = tb.tb_next
    if frames:
        result["frames"] = frames
    causes, seen = [], {id(exc)}
    cause = exc.__cause__ or exc.__context__
    while cause is not None and id(cause) not in seen and len(causes) < 3:
        seen.add(id(cause))
        causes.append(_summary(cause))
        cause = cause.__cause__ or cause.__context__
    if causes:
        result["causes"] = causes
    return result


def failure_outcome(exc: BaseException, code: str, *, phase: str) -> dict[str, Any]:
    """Capture at the exception boundary, before a domain error becomes a code."""
    return {"ok": False, "errorCode": code,
            "errorDetails": capture_error(exc, code=code, phase=phase)}


def outcome_details(outcome: dict[str, Any], *, phase: str, **context: Any) -> dict[str, Any]:
    # Code-only validation outcomes have no traceback to invent. Their failure
    # type is explicitly a domain outcome, not a synthetic exception traceback.
    details = public_details(outcome.get("errorDetails"))
    if details is None:
        details = capture_error(RuntimeError(), code=outcome.get("errorCode"), phase=phase)
        details["errorType"] = "DomainFailure"
    for key, value in context.items():
        if value is not None:
            details[key] = value if key == "attempt" else _token(str(value))
    return details


def public_details(value: Any) -> dict[str, Any] | None:
    """Project the reserved field, not arbitrary progress or exception extras."""
    if not isinstance(value, dict) or not all(isinstance(value.get(k), str) for k in
                                             ("code", "errorType", "message", "occurredAt")):
        return None
    try:
        datetime.fromisoformat(value["occurredAt"].replace("Z", "+00:00"))
    except ValueError:
        return None
    def summary(item: dict[str, Any]) -> dict[str, Any]:
        # Only summaries produced by this module may pass back through JSON.
        message = item.get("message", "")
        if not isinstance(message, str):
            message = ""
        allowed = message in _HINTS.values() or message in {
            "Runtime operation failed; inspect the exception type and frame locations.",
            "Database rejected a bound argument; verify parameter types.",
            "Operation timed out; check service availability and configured time limits.",
            "Legacy failure: exception details were not recorded; only a stored error identifier is available.",
            "AI extraction failed; verify extraction configuration and provider availability.",
            "Source delivery failed; verify source access and backend availability.",
            "Embedding failed; verify the embedding profile, service access and response format.",
            "Datasource processing failed; verify the source format and mapping.",
            "Population validation failed; verify the specification and source bindings.",
        } or bool(re.fullmatch(r"Database rejected bound argument \$\d{1,6}; verify parameter types\.( Expected (str|int|float|bytes|bool), got (str|int|float|bytes|bool|dict|list|NoneType)\.)?", message)) or bool(re.fullmatch(r"Upstream service returned HTTP [1-5]\d{2}; check access and service availability\.", message))
        result = {"errorType": _token(item.get("errorType")), "message": message if allowed else
                  "Runtime operation failed; inspect the exception type and frame locations."}
        state = item.get("sqlState")
        if isinstance(state, str) and re.fullmatch(r"[A-Z0-9]{5}", state):
            result["sqlState"] = state
        status = item.get("httpStatus")
        if type(status) is int and 100 <= status <= 599:
            result["httpStatus"] = status
        return result
    result = {"code": _token(value["code"]), **summary(value), "occurredAt": value["occurredAt"][:128]}
    for key in ("phase", "jobId", "taskId", "indexId"):
        if isinstance(value.get(key), str):
            result[key] = _token(value[key])
    if type(value.get("attempt")) is int and value["attempt"] >= 0:
        result["attempt"] = value["attempt"]
    if value.get("legacy") is True:
        result["legacy"] = True
    frames = []
    for frame in value.get("frames", [])[-8:] if isinstance(value.get("frames"), list) else []:
        if isinstance(frame, dict) and type(frame.get("line")) is int and frame["line"] > 0:
            file = frame.get("file", "")
            if isinstance(file, str) and re.fullmatch(r"(?:app/)?[A-Za-z0-9_./-]{1,480}", file) and ".." not in file and not file.startswith("/"):
                frames.append({"file": file, "function": _token(frame.get("function")), "line": frame["line"]})
    if frames:
        result["frames"] = frames
    causes = value.get("causes")
    if isinstance(causes, list):
        result["causes"] = [summary(c) for c in causes[:3] if isinstance(c, dict)]
    return result
