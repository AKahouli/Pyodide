from __future__ import annotations

import re
from typing import Any

REDACTED = "[REDACTED]"
MAX_PROMPT_LENGTH = 8000
MAX_OUTPUT_SUMMARY_LENGTH = 2000
MAX_TRACE_VALUE_LENGTH = 2000
MAX_TRACE_KEY_LENGTH = 200
MAX_TRACE_VALUE_ITEMS = 200
MAX_TRACE_VALUE_DEPTH = 8
SENSITIVE_KEY_PATTERN = re.compile(r"token|secret|password|authorization|cookie|api[_-]?key", re.IGNORECASE)


def bound_value(value: Any) -> Any:
    remaining_items = [MAX_TRACE_VALUE_ITEMS]

    def _bound(candidate: Any, depth: int) -> Any:
        if isinstance(candidate, str):
            return bound_string(candidate, MAX_TRACE_VALUE_LENGTH)
        if depth >= MAX_TRACE_VALUE_DEPTH:
            return "[TRUNCATED]"
        if isinstance(candidate, list):
            result = []
            for item in candidate:
                if remaining_items[0] <= 0:
                    break
                remaining_items[0] -= 1
                result.append(_bound(item, depth + 1))
            return result
        if isinstance(candidate, dict):
            result = {}
            for item_key, item_value in candidate.items():
                if remaining_items[0] <= 0:
                    break
                bounded_key = str(item_key)
                if len(bounded_key) > MAX_TRACE_KEY_LENGTH:
                    continue
                remaining_items[0] -= 1
                result[bounded_key] = _bound(item_value, depth + 1)
            return result
        return candidate

    return _bound(value, 0)


def bound_string(value: str, max_length: int | None = None) -> str:
    if max_length is not None and len(value) > max_length:
        return f"{value[:max_length]}..."
    return value


def redact_value(value: Any, key: str | None = None) -> Any:
    if key and SENSITIVE_KEY_PATTERN.search(key):
        return REDACTED
    if isinstance(value, list):
        return [redact_value(item) for item in value]
    if isinstance(value, dict):
        return {item_key: redact_value(item_value, item_key) for item_key, item_value in value.items()}
    if isinstance(value, str):
        return redact_string(value)
    return value


def redact_string(value: str, max_length: int | None = None) -> str:
    redacted = re.sub(r"Bearer\s+[A-Za-z0-9._\-]+", f"Bearer {REDACTED}", value, flags=re.IGNORECASE)
    redacted = re.sub(
        r'("(?:api[_-]?key|token|secret|password)"\s*:\s*")([^"]+)(")',
        rf"\1{REDACTED}\3",
        redacted,
        flags=re.IGNORECASE,
    )
    return bound_string(redacted, max_length)
