"""Bounded envelope snapshot builder (mirrors packages/observability-ts/src/envelope.ts).

Snapshots contain only bounded scalars; the caller retains nothing by reference.
Final JSON rendering happens in the listener (plan §5.3).
"""
from __future__ import annotations

import itertools
import math
import random
import re
import time
from typing import Any, Dict, Optional, Set, Tuple

from .contract import BUDGETS, EVENTS, SEVERITY_NUMBER, is_sensitive_key
from .redaction import REDACTED, bound_stack, frames_to_stack, scrub_text, truncate_utf8

ATTR_KEY_ALLOWED = set("abcdefghijklmnopqrstuvwxyz0123456789_")
TRACE_ID_RE = re.compile(r"^(?!0{32}$)[0-9a-f]{32}$")
SPAN_ID_RE = re.compile(r"^(?!0{16}$)[0-9a-f]{16}$")

CONTEXT_FIELDS = (
    "request_id", "user_id", "username", "actor_type",
    "workspace_id", "conversation_id", "run_id", "job_id", "agent_id",
)

_boot_id = f"{int(time.time()):x}-{random.randrange(1 << 24):06x}"
_sequence = itertools.count(1)


def next_event_id() -> str:
    return f"{_boot_id}:{next(_sequence)}"


class Identity:
    __slots__ = ("service_name", "service_version", "environment", "service_instance_id")

    def __init__(self, service_name: str, service_version: str, environment: str, service_instance_id: str) -> None:
        self.service_name = service_name
        self.service_version = service_version
        self.environment = environment
        self.service_instance_id = service_instance_id


def _add_truncated(truncated: Set[str], field: str) -> None:
    if len(truncated) < 16:
        truncated.add(truncate_utf8(field, 64))


def error_summary(exc: BaseException, depth: int, prefix: str, truncated: Set[str]) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    name = getattr(exc, "name", None) or type(exc).__name__
    out["type"] = truncate_utf8(str(name), 128)
    code = getattr(exc, "code", None)
    if isinstance(code, str):
        out["code"] = truncate_utf8(code, 128)
    scrubbed = scrub_text(str(exc))
    out["message"] = truncate_utf8(scrubbed, BUDGETS["max_error_message_bytes"])
    if out["message"] != scrubbed:
        _add_truncated(truncated, f"{prefix}.message")
    frames = getattr(exc, "__traceback__", None)
    if frames is not None:
        raw_stack = frames_to_stack(frames)
        out["stack"] = bound_stack(raw_stack)
        if out["stack"] != raw_stack:
            _add_truncated(truncated, f"{prefix}.stack")
    if isinstance(getattr(exc, "retryable", None), bool):
        out["retryable"] = exc.retryable  # type: ignore[attr-defined]
    cause = getattr(exc, "__cause__", None)
    if cause is not None and depth < BUDGETS["max_error_cause_depth"]:
        out["cause"] = error_summary(cause, depth + 1, f"{prefix}.cause", truncated)
    return out


def _is_finite_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _clean_attr(key: str, value: Any, truncated: Set[str]) -> Optional[Any]:
    if value is None or isinstance(value, bool):
        return value
    if _is_finite_number(value):
        return value
    if isinstance(value, str):
        out = truncate_utf8(scrub_text(value), BUDGETS["max_attribute_string_bytes"])
        if out != value:
            _add_truncated(truncated, f"attrs.{key}")
        return out
    if isinstance(value, (list, tuple)):
        items: list[Any] = []
        dropped = len(value) > BUDGETS["max_array_items"]
        for item in list(value)[: BUDGETS["max_array_items"]]:
            if isinstance(item, bool) or _is_finite_number(item):
                items.append(item)
            elif isinstance(item, str):
                out = truncate_utf8(scrub_text(item), BUDGETS["max_attribute_string_bytes"])
                if out != item:
                    dropped = True
                items.append(out)
            else:
                dropped = True
        if dropped:
            _add_truncated(truncated, f"attrs.{key}")
        return items
    _add_truncated(truncated, f"attrs.{key}")  # objects/functions discarded: no graphs, no __repr__ calls
    return None


def build_snapshot(
    event_name: str,
    severity: str,
    attrs: Optional[Dict[str, Any]],
    identity: Identity,
    origin: str = "application",
    context: Optional[Dict[str, Any]] = None,
    message_override: Optional[str] = None,
) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """Return (snapshot, None) or (None, invalid_reason). Bounded scalars only."""
    reg = EVENTS.get(event_name)
    truncated: Set[str] = set()
    if reg is None:
        return None, "unknown_event"

    event: Dict[str, Any] = {
        "schema_version": "1.0",
        "timestamp": _utc_now_iso(),
        "event_id": next_event_id(),
        "event_name": event_name,
        "message": truncate_utf8(scrub_text(message_override), BUDGETS["max_error_message_bytes"])
        if message_override
        else reg["message"],
        "severity_text": severity,
        "severity_number": SEVERITY_NUMBER[severity],
        "service_name": identity.service_name,
        "service_version": identity.service_version,
        "environment": identity.environment,
        "event_origin": origin,
        "service_instance_id": identity.service_instance_id,
    }

    # Contextual fields: only valid values are emitted; nothing is fabricated.
    ctx = context or {}
    if isinstance(ctx.get("trace_id"), str) and TRACE_ID_RE.match(ctx["trace_id"]):
        event["trace_id"] = ctx["trace_id"]
    if isinstance(ctx.get("span_id"), str) and SPAN_ID_RE.match(ctx["span_id"]):
        event["span_id"] = ctx["span_id"]
    if "trace_id" in event and isinstance(ctx.get("trace_flags"), int) and 0 <= ctx["trace_flags"] <= 255:
        event["trace_flags"] = ctx["trace_flags"]  # flags without a trace are meaningless
    for field in CONTEXT_FIELDS:
        value = ctx.get(field)
        if isinstance(value, str) and 0 < len(value) <= 128:
            event[field] = value

    attributes: Dict[str, Any] = {}
    count = 0
    error: Optional[BaseException] = None
    error_dict: Optional[Dict[str, Any]] = None
    if attrs:
        for key, value in attrs.items():
            if key == "error" and value is not None:
                if isinstance(value, BaseException):
                    error = value
                elif isinstance(value, dict):
                    error_dict = value
                continue
            if is_sensitive_key(key):
                if count < BUDGETS["max_attributes"]:
                    attributes[key] = REDACTED
                    count += 1
                continue
            if count >= BUDGETS["max_attributes"]:
                _add_truncated(truncated, f"attrs.{key}")
                continue
            if not (key and key[0] in "abcdefghijklmnopqrstuvwxyz" and set(key) <= ATTR_KEY_ALLOWED and len(key) <= 64):
                _add_truncated(truncated, f"attrs.{truncate_utf8(str(key), 32)}")
                continue
            clean = _clean_attr(key, value, truncated)
            if clean is None and value is not None:
                continue
            attributes[key] = clean
            count += 1

    if error is not None:
        try:
            event["error"] = error_summary(error, 0, "error", truncated)
        except Exception:
            _add_truncated(truncated, "error")  # hostile exception object
    elif error_dict is not None:
        summary: Dict[str, Any] = {}
        try:
            for field in ("type", "code", "message", "stack"):
                value = error_dict.get(field)
                if not isinstance(value, str):
                    continue
                if field == "message":
                    summary[field] = truncate_utf8(scrub_text(value), BUDGETS["max_error_message_bytes"])
                elif field == "stack":
                    summary[field] = bound_stack(value)  # same path sanitization as exception stacks
                else:
                    summary[field] = truncate_utf8(value, 128)
            if isinstance(error_dict.get("retryable"), bool):
                summary["retryable"] = error_dict["retryable"]
        except Exception:
            _add_truncated(truncated, "error")
        if summary:
            event["error"] = summary

    event["attributes"] = attributes  # required by the contract, possibly empty
    if truncated:
        event["truncated_fields"] = sorted(truncated)
    return event, None


def build_invalid_event(identity: Identity, severity: str, reason_code: str, scope: str) -> Dict[str, Any]:
    """Internal event for invalid developer calls; bypasses registry checks; never recurses."""
    return {
        "schema_version": "1.0",
        "timestamp": _utc_now_iso(),
        "event_id": next_event_id(),
        "event_name": "logger.event.invalid",
        "message": EVENTS["logger.event.invalid"]["message"],
        "severity_text": severity,
        "severity_number": SEVERITY_NUMBER[severity],
        "service_name": identity.service_name,
        "service_version": identity.service_version,
        "environment": identity.environment,
        "event_origin": "logger",
        "service_instance_id": identity.service_instance_id,
        "attributes": {
            "reason_code": truncate_utf8(reason_code, 512),
            "scope": truncate_utf8(scope, 512),
        },
    }


def _utc_now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + f".{int((time.time() % 1) * 1000):03d}Z"
