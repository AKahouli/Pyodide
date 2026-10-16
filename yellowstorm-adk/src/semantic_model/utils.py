"""Shared helpers for semantic-model attribute extraction."""

from __future__ import annotations

from typing import Any


_PLACEHOLDER_VALUES = {
    "null", "none", "nil", "n/a", "na", "unknown", "not found", "not_found",
    "missing", "empty", "-", "--", "aucun", "aucune", "inconnu", "inconnue",
}


def is_meaningful_value(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        stripped = value.strip()
        return bool(stripped) and stripped.casefold() not in _PLACEHOLDER_VALUES
    if isinstance(value, (list, tuple, dict)):
        return len(value) > 0
    return True


def normalize_evidence(evidence: list[Any], normalize_text: Any) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for item in evidence:
        if not isinstance(item, dict):
            continue
        quote = str(item.get("quote", "")).strip()
        if not quote:
            continue
        normalized.append({**item, "quote": normalize_text(quote)})
    return normalized
