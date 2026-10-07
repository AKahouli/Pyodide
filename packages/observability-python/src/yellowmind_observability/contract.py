"""Normative contract data, synced from /contracts/observability (source of truth)."""
import json
from pathlib import Path
from typing import Any, Dict

_CONTRACTS_DIR = Path(__file__).parent / "_contracts"


def _load(name: str) -> Dict[str, Any]:
    with (_CONTRACTS_DIR / name).open("r", encoding="utf-8") as fh:
        return json.load(fh)


BUDGETS: Dict[str, Any] = _load("budgets.v1.json")
REGISTRY: Dict[str, Any] = _load("log-events.v1.json")
SEVERITY: Dict[str, Any] = _load("severity.v1.json")
REDACTION: Dict[str, Any] = _load("redaction.v1.json")

EVENTS: Dict[str, Dict[str, Any]] = REGISTRY["events"]

SEVERITY_NUMBER: Dict[str, int] = {row["text"]: row["number"] for row in SEVERITY["levels"]}
SEVERITY_ORDER = ["TRACE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL"]
# stdlib logging level name -> envelope severity (Python WARNING->WARN, CRITICAL->FATAL).
STDLIB_LEVEL_MAP: Dict[str, str] = {row["python"]: row["text"] for row in SEVERITY["levels"]}
STDLIB_NUMERIC_MAP: Dict[int, str] = {row["python_numeric"]: row["text"] for row in SEVERITY["levels"]}
STRUCTLOG_METHOD_MAP: Dict[str, str] = {
    "debug": "DEBUG", "info": "INFO", "warning": "WARN", "warn": "WARN",
    "error": "ERROR", "critical": "FATAL", "fatal": "FATAL", "trace": "TRACE", "log": "INFO",
}


def severity_at_least(level: str, threshold: str) -> bool:
    return SEVERITY_ORDER.index(level) >= SEVERITY_ORDER.index(threshold)


_REDACTION_RULES = REDACTION["sensitive_key_rules"]
_SENSITIVE_SUBSTRINGS = [s.lower() for s in _REDACTION_RULES["substring"]]
_SENSITIVE_EXACT = {s.lower() for s in _REDACTION_RULES["exact"]}
_SENSITIVE_SUFFIXES = [s.lower() for s in _REDACTION_RULES["suffix"]]

REDACTED = REDACTION["redacted_marker"]


def is_sensitive_key(key: str) -> bool:
    lower = key.lower()
    if lower in _SENSITIVE_EXACT:
        return True
    if any(lower.endswith(s) for s in _SENSITIVE_SUFFIXES):
        return True
    return any(s in lower for s in _SENSITIVE_SUBSTRINGS)
