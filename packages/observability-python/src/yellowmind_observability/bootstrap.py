"""Idempotent bootstrap: structlog config + one stdlib root bridge (plan §5.3).

Replaces yellowstorm-adk's setup_logging/PostgreSQLHandler at P06 adoption:
no application-DB writes, no unbounded queue, WARNING captured, repeated setup is a no-op.
"""
from __future__ import annotations

import logging
import os
import sys
import threading
from typing import Any, Dict, Optional

import structlog
from structlog.contextvars import get_contextvars

from .contract import BUDGETS, SEVERITY_ORDER, STDLIB_NUMERIC_MAP, severity_at_least
from .envelope import CONTEXT_FIELDS, Identity, _boot_id, build_invalid_event, build_snapshot
from .redaction import truncate_utf8
from .writer import Writer, env_int

_LOCK = threading.Lock()
_STATE: Dict[str, Any] = {"writer": None}

STRUCTLOG_LEVEL_NUM = {"TRACE": 5, "DEBUG": 10, "INFO": 20, "WARN": 30, "ERROR": 40, "FATAL": 50}
# structlog's filtering factory supports [0,10,20,30,40,50] only: TRACE gates at DEBUG (no native TRACE in Python).
STRUCTLOG_LEVEL_NAME = {"TRACE": "debug", "DEBUG": "debug", "INFO": "info", "WARN": "warning", "ERROR": "error", "FATAL": "critical"}
METHOD_TO_SEVERITY = {
    "debug": "DEBUG", "info": "INFO", "warning": "WARN", "warn": "WARN",
    "error": "ERROR", "critical": "FATAL", "fatal": "FATAL", "trace": "TRACE", "log": "INFO",
}
_RESERVED_FIELDS = {"event"} | set(CONTEXT_FIELDS)


def identity_from_env() -> Identity:
    return Identity(
        service_name=os.environ.get("OBS_SERVICE_NAME") or "unknown-service",
        service_version=os.environ.get("OBS_SERVICE_VERSION") or "dev",
        environment=os.environ.get("OBS_ENVIRONMENT") or os.environ.get("ENVIRONMENT") or os.environ.get("NODE_ENV") or "local",
        service_instance_id=os.environ.get("OBS_SERVICE_INSTANCE_ID") or _boot_id,
    )


def setup_observability(
    *,
    service_name: Optional[str] = None,
    service_version: Optional[str] = None,
    environment: Optional[str] = None,
    min_level: Optional[str] = None,
    stderr_fd: Optional[int] = None,
) -> Writer:
    """Initialize once per process; repeated calls return the existing writer (plan T07)."""
    with _LOCK:
        existing: Optional[Writer] = _STATE["writer"]
        if existing is not None:
            return existing

        identity = identity_from_env()
        if service_name:
            identity.service_name = service_name
        if service_version:
            identity.service_version = service_version
        if environment:
            identity.environment = environment

        min_level_value = (min_level or os.environ.get("LOG_LEVEL") or "INFO").upper()
        if min_level_value not in SEVERITY_ORDER:
            min_level_value = "INFO"

        max_events = env_int("OBS_LOG_QUEUE_MAX_EVENTS", BUDGETS["max_queue_events"], 16, 65536)
        max_queue_bytes = env_int("OBS_LOG_QUEUE_MAX_BYTES", BUDGETS["max_queue_bytes"], 65536, 67108864)
        error_reserve_bytes = env_int("OBS_LOG_ERROR_RESERVE_BYTES", BUDGETS["error_reserve_bytes"], 0, max_queue_bytes // 2)
        max_event_bytes = env_int("OBS_LOG_MAX_EVENT_BYTES", BUDGETS["max_event_bytes"], 1024, 65536)
        error_reserve_events = min(max_events, max(1, error_reserve_bytes // max_event_bytes))
        shutdown_timeout_ms = env_int("OBS_LOG_SHUTDOWN_TIMEOUT_MS", BUDGETS["shutdown_drain_ms"], 100, 30000)

        writer = Writer(
            identity=identity,
            max_events=max_events,
            error_reserve_events=error_reserve_events,
            shutdown_timeout_ms=shutdown_timeout_ms,
            stderr_fd=stderr_fd,
        )
        writer.min_severity = min_level_value
        _STATE["writer"] = writer

        _configure_structlog(writer, min_level_value)
        _install_root_bridge(writer, min_level_value)
        _install_excepthook(writer)
        # Bounded drain at interpreter exit so queued events are rendered, not frozen mid-shutdown.
        import atexit

        atexit.register(writer.stop)
        return writer


def get_writer() -> Optional[Writer]:
    return _STATE["writer"]


def reset_for_tests() -> None:
    """Test isolation: drop writer, structlog config and root handlers."""
    with _LOCK:
        writer: Optional[Writer] = _STATE["writer"]
        if writer is not None:
            writer.stop()
        _STATE["writer"] = None
        structlog.reset_defaults()
        root = logging.getLogger()
        for handler in list(root.handlers):
            if isinstance(handler, _StdlibBridge):
                root.removeHandler(handler)


def _configure_structlog(writer: Writer, min_level: str) -> None:
    def finalize(_logger: Any, method: str, event_dict: Dict[str, Any]) -> Any:
        severity = METHOD_TO_SEVERITY.get(method, "INFO")
        _emit(writer, event_dict, severity, origin="application")
        return event_dict  # ReturnLogger discards it

    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            finalize,
        ],
        logger_factory=structlog.ReturnLoggerFactory(),
        wrapper_class=structlog.make_filtering_bound_logger(STRUCTLOG_LEVEL_NAME[min_level]),
        # False: loggers must never outlive a reconfiguration (tests, late env changes).
        cache_logger_on_first_use=False,
    )


def _emit(writer: Writer, event_dict: Dict[str, Any], severity: str, origin: str) -> None:
    try:
        _emit_inner(writer, event_dict, severity, origin)
    except Exception:
        # A hostile event must never propagate into the caller's log call.
        writer.metrics.invalid_total += 1


def _emit_inner(writer: Writer, event_dict: Dict[str, Any], severity: str, origin: str) -> None:
    if not severity_at_least(severity, writer.min_severity):
        return
    writer.metrics.attempted_total += 1
    if writer.is_saturated(severity):
        writer.count_drop("capacity", severity)
        return

    # Registry names only; free-form messages route to legacy.log with the text preserved
    # as detail (matching the TS facade), so cutover never silently discards messages.
    event_name = str(event_dict.get("event") or "")
    context: Dict[str, Any] = {}
    for field in (*CONTEXT_FIELDS, "trace_id", "span_id", "trace_flags"):
        value = event_dict.pop(field, None)
        if value is not None:
            context[field] = value
    attrs: Dict[str, Any] = {key: value for key, value in event_dict.items() if key not in _RESERVED_FIELDS}

    snapshot, invalid = build_snapshot(event_name, severity, attrs, writer.identity, origin=origin, context=context)
    if invalid == "unknown_event":
        writer.metrics.invalid_total += 1
        attrs["detail"] = event_name
        snapshot, invalid = build_snapshot(
            "legacy.log", severity, attrs, writer.identity, origin="logger", context=context
        )
        if snapshot is not None:
            writer.enqueue(snapshot, severity)
        return
    if invalid is not None:
        writer.metrics.invalid_total += 1
        if event_name != "logger.event.invalid":
            invalid_event = build_invalid_event(writer.identity, "WARN", invalid, event_name)
            writer.enqueue(invalid_event, "WARN")
        return
    assert snapshot is not None
    writer.enqueue(snapshot, severity)


class _StdlibBridge(logging.Handler):
    """One root handler bridging stdlib logging (uvicorn/httpx/framework) onto the bounded writer."""

    def __init__(self, writer: Writer) -> None:
        super().__init__()
        self._writer = writer

    def emit(self, record: logging.LogRecord) -> None:  # noqa: D102 - logging contract
        writer = self._writer
        try:
            severity = STDLIB_NUMERIC_MAP.get(record.levelno)
            if severity is None:
                severity = "FATAL" if record.levelno > 50 else "DEBUG" if record.levelno < 10 else "INFO"
            if not severity_at_least(severity, writer.min_severity):
                return
            if writer.is_saturated(severity):
                writer.count_drop("capacity", severity)
                return
            try:
                message = record.getMessage()
            except Exception:
                message = "<unformattable log record>"
            context = {
                key: value
                for key, value in get_contextvars().items()
                if key in CONTEXT_FIELDS and isinstance(value, str)
            }
            attrs: Dict[str, Any] = {"logger_name": record.name}
            error = None
            if record.exc_info and record.exc_info[1] is not None:
                error = record.exc_info[1]
                attrs["error"] = error
            writer.metrics.attempted_total += 1
            snapshot, invalid = build_snapshot(
                "framework.log",
                severity,
                attrs,
                writer.identity,
                origin="framework",
                context=context,
                message_override=truncate_utf8(message, BUDGETS["max_error_message_bytes"]),
            )
            if invalid is not None:
                writer.metrics.invalid_total += 1
                return
            assert snapshot is not None
            writer.enqueue(snapshot, severity)
        except Exception:  # never let logging failures reach business code
            self.handleError(record)


def _install_root_bridge(writer: Writer, min_level: str) -> None:
    root = logging.getLogger()
    for handler in list(root.handlers):
        if isinstance(handler, _StdlibBridge):
            root.removeHandler(handler)  # idempotent under repeated setup
    root.addHandler(_StdlibBridge(writer))
    # stdlib numeric: TRACE/DEBUG->10, WARN->30, ERROR->40, FATAL->50 (CRITICAL)
    if min_level in ("TRACE", "DEBUG"):
        root.setLevel(logging.DEBUG)
    else:
        root.setLevel(max(10, min(STRUCTLOG_LEVEL_NUM[min_level], 50)))


def _install_excepthook(writer: Writer) -> None:
    previous = sys.excepthook

    def hook(exc_type, exc_value, exc_traceback) -> None:
        if issubclass(exc_type, KeyboardInterrupt):
            previous(exc_type, exc_value, exc_traceback)
            return
        try:
            _emit(writer, {"event": "service.crashed", "launcher": " ".join(sys.argv[:2]), "error": exc_value}, "ERROR", origin="application")
        except Exception:
            pass
        # The listener may be frozen during interpreter shutdown: drain what was queued,
        # then chain the previous hook so the crash still leaves a visible diagnostic.
        try:
            writer.stop()
        except Exception:
            pass
        previous(exc_type, exc_value, exc_traceback)

    sys.excepthook = hook


def get_logger(name: Optional[str] = None) -> Any:
    """structlog bound logger; auto-bootstraps from environment when setup_observability was not called."""
    if _STATE["writer"] is None:
        setup_observability()
    return structlog.get_logger(name)
