"""Redaction and byte-bounding helpers (mirrors packages/observability-ts/src/redact.ts)."""
from __future__ import annotations

import os
import re
from typing import Any, Optional

from .contract import BUDGETS, REDACTED, is_sensitive_key

_URL_USERINFO = re.compile(r"(?:https?|wss?|postgres(?:ql)?|redis|mongodb(?:\+srv)?|amqps?)://[^\s/@]+:[^\s/@]+@")
_DSN = re.compile(r"\b(?:postgres(?:ql)?|redis|mongodb(?:\+srv)?|mysql)://[^\s]+")
_BEARER = re.compile(r"\bBearer\s+[\w.~\-+/]+=*", re.IGNORECASE)


def scrub_text(value: str) -> str:
    value = _URL_USERINFO.sub(lambda m: m.group(0).split("://")[0] + "://[REDACTED]@", value)
    value = _DSN.sub(lambda m: m.group(0).split("://")[0] + "://[REDACTED]", value)
    return _BEARER.sub("Bearer [REDACTED]", value)


def truncate_utf8(value: str, max_bytes: int) -> str:
    encoded = value.encode("utf-8")
    if len(encoded) <= max_bytes:
        return value
    lo, hi = 0, len(value)
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if len(value[:mid].encode("utf-8")) <= max_bytes:
            lo = mid
        else:
            hi = mid - 1
    return value[:lo]


def sanitize_stack(stack: str) -> str:
    cwd = os.getcwd()
    if cwd and cwd != "/":
        stack = stack.replace(cwd + "\\", "").replace(cwd + "/", "")
    home = os.environ.get("HOME") or os.environ.get("USERPROFILE")
    if home:
        stack = stack.replace(home, "~")
    return stack


def frames_to_stack(tb: Any) -> str:
    """Frame metadata only (filename/line/function) — no linecache, no source lines, no locals."""
    entries = []
    node = tb
    while node is not None:
        code = node.tb_frame.f_code
        entries.append(f'  File "{code.co_filename}", line {node.tb_lineno}, in {code.co_name}')
        node = node.tb_next
    lines = ["Traceback (most recent call last):", *entries]
    return sanitize_stack("\n".join(lines))


def bound_stack(stack: str) -> str:
    lines = sanitize_stack(stack).split("\n")[: BUDGETS["max_error_stack_frames"] + 1]
    out = ""
    for line in lines:
        if len(out.encode("utf-8")) + len(line.encode("utf-8")) + 1 > BUDGETS["max_error_stack_bytes"]:
            break
        out = f"{out}\n{line}" if out else line
    return out


def bounded_detail(value: Any, max_bytes: int = BUDGETS["max_attribute_string_bytes"], max_depth: int = 5) -> Optional[str]:
    """Legacy adapter helper: bounded, redacted JSON summary of an arbitrary object. Never throws."""
    seen: set[int] = set()

    def walk(v: Any, depth: int) -> Any:
        if v is None or isinstance(v, bool):
            return v
        if isinstance(v, int) or isinstance(v, float):
            return v if v == v and v not in (float("inf"), float("-inf")) else str(v)
        if isinstance(v, str):
            return truncate_utf8(scrub_text(v), 256)
        if depth >= max_depth:
            return "[MAX_DEPTH]"
        if id(v) in seen:
            return "[Circular]"
        seen.add(id(v))
        try:
            if isinstance(v, dict):
                out: dict[str, Any] = {}
                for key, item in v.items():
                    key_str = str(key)
                    out[key_str] = REDACTED if is_sensitive_key(key_str) else walk(item, depth + 1)
                return out
            if isinstance(v, (list, tuple, set)):
                return [walk(item, depth + 1) for item in list(v)[:16]]
            return str(v)[:64]
        finally:
            seen.discard(id(v))

    try:
        return truncate_utf8(json_dumps(walk(value, 0)) or "", max_bytes)
    except Exception:
        return None


def json_dumps(obj: Any) -> Optional[str]:
    import json

    try:
        return json.dumps(obj, ensure_ascii=False, default=str)
    except (TypeError, ValueError):
        return None
