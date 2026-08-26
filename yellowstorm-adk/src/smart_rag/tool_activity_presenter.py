import json
import re
from dataclasses import dataclass
from typing import Any


_SENSITIVE_KEY = re.compile(
    r"^(authorization|cookie|set-cookie|(?:[A-Za-z0-9_-]*(?:password|passwd|secret|token|"
    r"api[-_]?key|access[-_]?key|private[-_]?key|connection[-_]?string)[A-Za-z0-9_-]*))$",
    re.IGNORECASE,
)
_PHYSICAL_PATH = re.compile(r"(?:^|[\s\"'])(?:users?/)?[A-Za-z0-9_-]{8,}/(?:runs?|workspaces?)/[^\s\"']+", re.IGNORECASE)
_PATH_BOUNDARY = r"(?:^|\s|=|:|\(|'|\"|\\)"
_ABSOLUTE_PATH = re.compile(rf"{_PATH_BOUNDARY}(?:[A-Za-z]:[\\/]|/|\\\\)\S+")
_STORAGE_KEY = re.compile(rf"{_PATH_BOUNDARY}(?:[A-Za-z0-9._-]+/){{2,}}[^\s\"']+")
_ATTACHMENT_SENTINEL = re.compile(r"YELLOWSTORM_ATTACHMENT_SENTINEL_\d+", re.IGNORECASE)
_CODE_LIKE = re.compile(r"\b(?:const|let|var|def|class|import|from)\s+[A-Za-z_$]|=>|[{};]", re.IGNORECASE)
_CONTROL = re.compile(r"[\x00-\x1f\x7f]+")
_OPAQUE_IDENTIFIER = re.compile(
    r"(?:\b[a-f0-9]{24}\b|\b[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}\b)",
    re.IGNORECASE,
)
_CREDENTIAL_VALUE = re.compile(
    r"(?:AKIA|ASIA)[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{20,}|"
    r"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b|"
    r"\b(?:gh[opsu]_|sk-|xox[baprs]-)[A-Za-z0-9_-]{8,}|"
    r"-----BEGIN [A-Z ]*PRIVATE KEY-----",
)
_ENV_CREDENTIAL = re.compile(
    r"\b([A-Z][A-Z0-9_]*(?:PASSWORD|PASSWD|SECRET|TOKEN|API_KEY|ACCESS_KEY|PRIVATE_KEY|CONNECTION_STRING)[A-Z0-9_]*)\b(\s*=\s*)[^\s,;]+",
    re.IGNORECASE,
)
_URL_USERINFO_PASSWORD = re.compile(
    r"(\b[A-Za-z][A-Za-z0-9+.-]*://[^\s/@:]+:)[^\s/@]+(?=@)",
    re.IGNORECASE,
)
_SIGNED_URL_QUERY_VALUE = re.compile(
    r"([?&](?:x-amz-(?:signature|credential|security-token)|"
    r"x-goog-(?:signature|credential)|sig|signature|credential)=)[^&#\s]+",
    re.IGNORECASE,
)
_COMMAND_LIKE_PURPOSE = re.compile(
    r"(?:&&|\|\||[|`$])|"
    r"\b(?:sudo|cd|ls|cat|cp|mv|rm|chmod|chown|mkdir|touch|grep|sed|"
    r"awk|tar|zip|unzip|printf|echo|head|tail|wc|sort|cut|tee|python3?|node|"
    r"npm|npx|bash|sh|pwsh|powershell|pandoc|curl|wget|git)\b(?=\s+\S+)|"
    r"\b[A-Za-z0-9_.-]+\.(?:py|js|ts|sh|ps1|md|txt|csv|json|pdf|xlsx?)\b",
    re.IGNORECASE,
)
_MAX_RESULT_BYTES = 64 * 1024
DISPLAY_PURPOSE_KEY = "display_purpose"
LEGACY_DISPLAY_PURPOSE_KEY = "_display_purpose"


@dataclass(frozen=True)
class ToolPresentation:
    display_key: str | None
    fallback_display_name: str | None
    summary: str
    render_kind: str


_TOOL_STYLES: dict[str, tuple[str, str]] = {
    "run_code": ("runCode", "run_code"),
    "code_interpreter_sandbox_create": ("createSandbox", "generic"),
    "code_interpreter_file_find": ("findFiles", "file"),
    "code_interpreter_file_list": ("findFiles", "file"),
    "code_interpreter_shell_exec": ("runCommand", "run_code"),
    "code_interpreter_send_file_to_user": ("sendFile", "file"),
    "perform_document_search": ("searchKnowledge", "search"),
    "perform_web_search": ("searchWeb", "web"),
    "perform_standard_search": ("search", "search"),
}


def _humanize(value: str) -> str:
    return " ".join(part.capitalize() for part in re.split(r"[_\-\s]+", value) if part)


def sanitize_activity_summary(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    text = _CONTROL.sub(" ", value).replace("\r", " ").replace("\n", " ")
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"Bearer\s+\S+", "Bearer [REDACTED]", text, flags=re.IGNORECASE)
    text = re.sub(
        r"\b(authorization|cookie|password|secret|api[-_]?key|access[-_]?token|refresh[-_]?token)\b\s*[:=]\s*\S+",
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


def _safe_tool_summary(value: Any) -> str:
    summary = sanitize_activity_summary(value)
    if not summary:
        return ""
    if (
        _OPAQUE_IDENTIFIER.search(summary)
        or _CREDENTIAL_VALUE.search(summary)
        or _COMMAND_LIKE_PURPOSE.search(summary)
    ):
        return ""
    return summary


def present_tool_call(tool_name: str, args: dict[str, Any]) -> ToolPresentation:
    normalized = tool_name.strip().lower().replace("-", "_")
    purpose_value = args.get(DISPLAY_PURPOSE_KEY, args.get(LEGACY_DISPLAY_PURPOSE_KEY))
    if normalized == "run_code" and purpose_value is None:
        purpose_value = args.get("description")
    purpose = _safe_tool_summary(purpose_value)
    style = _TOOL_STYLES.get(normalized)
    if style:
        display_key, render_kind = style
        return ToolPresentation(display_key, None, purpose, render_kind)

    if any(token in normalized for token in ("glob", "find_file", "list_file")):
        return ToolPresentation("findFiles", None, purpose, "file")
    for token, display_key, kind in (
        ("read", "read", "read"),
        ("write", "write", "write"),
        ("copy", "copy", "file"),
    ):
        if token in normalized:
            return ToolPresentation(display_key, None, purpose, kind)

    return ToolPresentation(None, _humanize(tool_name), purpose, "generic")


def serialize_tool_args(args: dict[str, Any]) -> str:
    return serialize_tool_result(tool_args_without_display_purpose(args))


def tool_args_without_display_purpose(args: dict[str, Any]) -> dict[str, Any]:
    forwarded_args = dict(args)
    forwarded_args.pop(DISPLAY_PURPOSE_KEY, None)
    forwarded_args.pop(LEGACY_DISPLAY_PURPOSE_KEY, None)
    return forwarded_args


def sanitize_tool_value(value: Any, depth: int = 0) -> Any:
    if depth >= 6:
        return "[truncated]"
    if isinstance(value, str):
        redacted = _URL_USERINFO_PASSWORD.sub(r"\1[REDACTED]", value)
        redacted = _SIGNED_URL_QUERY_VALUE.sub(r"\1[REDACTED]", redacted)
        redacted = re.sub(r"Bearer\s+\S+", "Bearer [REDACTED]", redacted, flags=re.IGNORECASE)
        redacted = re.sub(
            r"\b(authorization)\b(\s*[:=]\s*)(?:(?:Basic|Bearer)\s+\S+|[^\s,;]+)",
            r"\1\2[REDACTED]",
            redacted,
            flags=re.IGNORECASE,
        )
        redacted = re.sub(
            r"\b(password|secret|api[-_]?key|access[-_]?token|refresh[-_]?token)\b\s*[:=]\s*\S+",
            r"\1=[REDACTED]",
            redacted,
            flags=re.IGNORECASE,
        )
        redacted = _ENV_CREDENTIAL.sub(r"\1\2[REDACTED]", redacted)
        redacted = _PHYSICAL_PATH.sub(" [REDACTED]", redacted)
        redacted = _ABSOLUTE_PATH.sub(" [REDACTED]", redacted)
        redacted = _STORAGE_KEY.sub(" [REDACTED]", redacted)
        return redacted[:20_000] + ("... [truncated]" if len(redacted) > 20_000 else "")
    if isinstance(value, list):
        return [sanitize_tool_value(item, depth + 1) for item in value[:100]]
    if isinstance(value, dict):
        return {
            str(key): "[REDACTED]" if _SENSITIVE_KEY.match(str(key)) else sanitize_tool_value(item, depth + 1)
            for key, item in list(value.items())[:100]
        }
    return value


def sanitize_tool_result_value(value: Any, depth: int = 0) -> Any:
    if depth >= 6:
        return "[truncated]"
    if isinstance(value, str):
        redacted = _URL_USERINFO_PASSWORD.sub(r"\1[REDACTED]", value)
        redacted = _SIGNED_URL_QUERY_VALUE.sub(r"\1[REDACTED]", redacted)
        redacted = re.sub(r"Bearer\s+\S+", "Bearer [REDACTED]", redacted, flags=re.IGNORECASE)
        redacted = re.sub(
            r"\b(authorization|cookie|set-cookie|password|passwd|secret|api[-_]?key|"
            r"access[-_]?key|(?:access|refresh|id|client|api|session)[-_]?token|token|"
            r"private[-_]?key|connection[-_]?string)\b(\s*[:=]\s*)"
            r"(?:(?:Basic|Bearer)\s+)?[^\s,;]+",
            r"\1\2[REDACTED]",
            redacted,
            flags=re.IGNORECASE,
        )
        redacted = _ENV_CREDENTIAL.sub(r"\1\2[REDACTED]", redacted)
        redacted = _CREDENTIAL_VALUE.sub("[REDACTED]", redacted)
        redacted = _ATTACHMENT_SENTINEL.sub("[REDACTED]", redacted)
        return redacted[:20_000] + ("... [truncated]" if len(redacted) > 20_000 else "")
    if isinstance(value, list):
        return [sanitize_tool_result_value(item, depth + 1) for item in value[:100]]
    if isinstance(value, dict):
        return {
            str(key): "[REDACTED]" if _SENSITIVE_KEY.match(str(key)) else sanitize_tool_result_value(item, depth + 1)
            for key, item in list(value.items())[:100]
        }
    return value


def serialize_tool_value(value: Any) -> str:
    try:
        encoded = json.dumps(sanitize_tool_value(value), default=str, separators=(",", ":"), ensure_ascii=False)
    except (TypeError, ValueError):
        return ""
    return encoded if len(encoded.encode("utf-8")) <= _MAX_RESULT_BYTES else ""


def serialize_tool_result(value: Any) -> str:
    try:
        encoded = json.dumps(sanitize_tool_result_value(value), default=str, separators=(",", ":"), ensure_ascii=False)
    except (TypeError, ValueError):
        return ""
    return encoded if len(encoded.encode("utf-8")) <= _MAX_RESULT_BYTES else ""
