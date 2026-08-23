import json
import re
from dataclasses import dataclass
from typing import Any


_SENSITIVE_KEY = re.compile(
    r"^(authorization|cookie|set-cookie|password|passwd|secret|api[-_]?key|"
    r"access[-_]?token|refresh[-_]?token|id[-_]?token|client[-_]?secret|"
    r"private[-_]?key|connection[-_]?string)$",
    re.IGNORECASE,
)
_PHYSICAL_PATH = re.compile(r"(?:^|[\s\"'])(?:users?/)?[A-Za-z0-9_-]{8,}/(?:runs?|workspaces?)/[^\s\"']+", re.IGNORECASE)
_PATH_BOUNDARY = r"(?:^|\s|=|:|\(|'|\"|\\)"
_ABSOLUTE_PATH = re.compile(rf"{_PATH_BOUNDARY}(?:[A-Za-z]:[\\/]|/|\\\\)\S+")
_STORAGE_KEY = re.compile(rf"{_PATH_BOUNDARY}(?:[A-Za-z0-9._-]+/){{2,}}[^\s\"']+")
_ATTACHMENT_SENTINEL = re.compile(r"YELLOWSTORM_ATTACHMENT_SENTINEL_\d+", re.IGNORECASE)
_CODE_LIKE = re.compile(r"\b(?:const|let|var|def|class|import|from)\s+[A-Za-z_$]|=>|[{};]", re.IGNORECASE)
_CONTROL = re.compile(r"[\x00-\x1f\x7f]+")
_MAX_RESULT_BYTES = 64 * 1024


@dataclass(frozen=True)
class ToolPresentation:
    display_key: str | None
    fallback_display_name: str | None
    summary: str
    render_kind: str


_KNOWN: dict[str, tuple[str, str, tuple[str, ...]]] = {
    "run_code": ("runCode", "run_code", ("description",)),
    "perform_document_search": ("searchKnowledge", "search", ("query",)),
    "perform_web_search": ("searchWeb", "web", ("query",)),
    "perform_standard_search": ("search", "search", ("query",)),
}


def _humanize(value: str) -> str:
    return " ".join(part.capitalize() for part in re.split(r"[_\-\s]+", value) if part)


def _safe_summary(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    text = _CONTROL.sub(" ", value).replace("\r", " ").replace("\n", " ")
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"Bearer\s+\S+", "Bearer [REDACTED]", text, flags=re.IGNORECASE)
    text = re.sub(
        r"\b(password|secret|api[-_]?key|access[-_]?token|refresh[-_]?token)\b\s*[:=]\s*\S+",
        r"\1=[REDACTED]",
        text,
        flags=re.IGNORECASE,
    )
    if (
        _PHYSICAL_PATH.search(text)
        or _ABSOLUTE_PATH.search(text)
        or _STORAGE_KEY.search(text)
        or _ATTACHMENT_SENTINEL.search(text)
        or _CODE_LIKE.search(text)
        or "[REDACTED]" in text
    ):
        return ""
    return text[:137] + "..." if len(text) > 140 else text


def _safe_file_label(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    filename = value.replace("\\", "/").rstrip("/").rsplit("/", 1)[-1]
    return _safe_summary(filename)


def present_tool_call(tool_name: str, args: dict[str, Any]) -> ToolPresentation:
    normalized = tool_name.strip().lower().replace("-", "_")
    known = _KNOWN.get(normalized)
    if known:
        display_key, render_kind, summary_keys = known
        summary = next((_safe_summary(args.get(key)) for key in summary_keys if _safe_summary(args.get(key))), "")
        return ToolPresentation(display_key, None, summary, render_kind)

    if any(token in normalized for token in ("glob", "find_file", "list_file")):
        return ToolPresentation("findFiles", None, _safe_file_label(args.get("pattern") or args.get("query")), "file")
    for token, display_key, kind, keys in (
        ("read", "read", "read", ("path", "file_path")),
        ("write", "write", "write", ("path", "file_path")),
        ("copy", "copy", "file", ("source", "path")),
    ):
        if token in normalized:
            return ToolPresentation(display_key, None, next((_safe_file_label(args.get(key)) for key in keys if _safe_file_label(args.get(key))), ""), kind)

    summary = next((_safe_summary(args.get(key)) for key in ("description", "query", "path") if _safe_summary(args.get(key))), "")
    return ToolPresentation(None, _humanize(tool_name), summary, "generic")


def sanitize_tool_value(value: Any, depth: int = 0) -> Any:
    if depth >= 6:
        return "[truncated]"
    if isinstance(value, str):
        redacted = re.sub(r"Bearer\s+\S+", "Bearer [REDACTED]", value, flags=re.IGNORECASE)
        redacted = re.sub(
            r"\b(password|secret|api[-_]?key|access[-_]?token|refresh[-_]?token)\b\s*[:=]\s*\S+",
            r"\1=[REDACTED]",
            redacted,
            flags=re.IGNORECASE,
        )
        redacted = _PHYSICAL_PATH.sub(" [REDACTED]", redacted)
        return redacted[:20_000] + ("... [truncated]" if len(redacted) > 20_000 else "")
    if isinstance(value, list):
        return [sanitize_tool_value(item, depth + 1) for item in value[:100]]
    if isinstance(value, dict):
        return {
            str(key): "[REDACTED]" if _SENSITIVE_KEY.match(str(key)) else sanitize_tool_value(item, depth + 1)
            for key, item in list(value.items())[:100]
        }
    return value


def serialize_tool_value(value: Any) -> str:
    try:
        encoded = json.dumps(sanitize_tool_value(value), default=str, separators=(",", ":"), ensure_ascii=False)
    except (TypeError, ValueError):
        return ""
    return encoded if len(encoded.encode("utf-8")) <= _MAX_RESULT_BYTES else ""
