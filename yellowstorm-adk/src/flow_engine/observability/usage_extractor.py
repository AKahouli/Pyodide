from __future__ import annotations

from typing import Any

from src.flow_engine.observability.trace_types import UsageSummary


def extract_usage(response: Any, fallback_model: str | None = None) -> UsageSummary | None:
    usage = getattr(response, "usage", None)
    if usage is None and isinstance(response, dict):
        usage = response.get("usage")
    if usage is None:
        return None

    input_tokens = _read_int(usage, "prompt_tokens", "input_tokens", "inputTokens")
    output_tokens = _read_int(usage, "completion_tokens", "output_tokens", "outputTokens")
    total_tokens = _read_int(usage, "total_tokens", "totalTokens")
    model = _read_string(response, "model") or fallback_model

    if input_tokens is None and output_tokens is None and total_tokens is None and model is None:
        return None

    return UsageSummary(
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        total_tokens=total_tokens,
        model=model,
    )


def _read_int(value: Any, *keys: str) -> int | None:
    for key in keys:
        candidate = _read_attr_or_key(value, key)
        if isinstance(candidate, int):
            return candidate
        if isinstance(candidate, float):
            return int(candidate)
    return None


def _read_string(value: Any, *keys: str) -> str | None:
    for key in keys:
        candidate = _read_attr_or_key(value, key)
        if isinstance(candidate, str) and candidate.strip():
            return candidate
    return None


def _read_attr_or_key(value: Any, key: str) -> Any:
    if isinstance(value, dict):
        return value.get(key)
    return getattr(value, key, None)
