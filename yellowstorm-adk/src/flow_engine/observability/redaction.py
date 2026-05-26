from __future__ import annotations

import re
from typing import Any

REDACTED = "[REDACTED]"
MAX_PROMPT_LENGTH = 8000
MAX_OUTPUT_SUMMARY_LENGTH = 2000
SENSITIVE_KEY_PATTERN = re.compile(r"token|secret|password|authorization|cookie|api[_-]?key", re.IGNORECASE)


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
    if max_length is not None and len(redacted) > max_length:
        return f"{redacted[:max_length]}..."
    return redacted
