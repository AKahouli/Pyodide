import json
import logging
import os
import random
import time
import uuid
from contextvars import ContextVar
from datetime import datetime, timezone
from functools import wraps
from logging.handlers import QueueHandler, QueueListener, RotatingFileHandler
from pathlib import Path
from queue import Full, Queue
from typing import Any, Callable, Optional

from src.config.settings import get_settings


_TOOL_CALL_ID: ContextVar[Optional[str]] = ContextVar("tool_call_id", default=None)
_TOOL_NAME: ContextVar[Optional[str]] = ContextVar("tool_name", default=None)
_REQUEST_LOG_SELECTED: ContextVar[Optional[bool]] = ContextVar(
    "request_log_selected", default=None
)

_tool_logger: Optional[logging.Logger] = None
_postgres_logger: Optional[logging.Logger] = None
_listeners: list[QueueListener] = []

_OMITTED_BODY_KEYS = {
    "input", "output", "parameters", "statement", "error",
    "authorization", "api_key", "password", "query", "file_name", "workspace_id",
    "file_names", "workspace_ids", "document_id", "document_ids", "source",
    "section_id", "section_ids", "block_id", "block_ids", "image_id", "image_ids",
    "content",
    "image_base64",
    "image_bytes",
    "data",
}
_MAX_COLLECTION_ITEMS = 50
_MAX_DEPTH = 8


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _omitted_value(value: Any) -> dict[str, Any]:
    omitted = {"omitted": True}
    if isinstance(value, (str, bytes, bytearray, list, tuple, set, dict)):
        omitted["size"] = len(value)
    return omitted


def _safe_json_value(value: Any, *, depth: int = 0, key: str = "") -> Any:
    """Build a bounded JSON-safe preview without serializing large bodies."""
    if key.lower() in _OMITTED_BODY_KEYS:
        return _omitted_value(value)
    if depth >= _MAX_DEPTH:
        return {"omitted": True, "reason": "max_depth"}
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        max_chars = max(0, get_settings().REQUEST_LOG_MAX_CHARS)
        if max_chars and len(value) > max_chars:
            return {
                "truncated": True,
                "original_chars": len(value),
                "preview": value[:max_chars],
            }
        return value
    if isinstance(value, (bytes, bytearray)):
        return {"omitted": True, "bytes": len(value)}
    media_type = getattr(value, "type", None)
    if media_type in {"image", "audio"}:
        data = getattr(value, "data", None)
        return {
            "type": media_type,
            "data": _omitted_value(data),
        }
    model_fields = getattr(type(value), "model_fields", None)
    if isinstance(model_fields, dict):
        return {
            str(field): _safe_json_value(
                getattr(value, field, None), depth=depth + 1, key=str(field)
            )
            for field in list(model_fields)[:_MAX_COLLECTION_ITEMS]
        }
    if isinstance(value, dict):
        items = list(value.items())
        result = {
            str(item_key): _safe_json_value(
                item, depth=depth + 1, key=str(item_key)
            )
            for item_key, item in items[:_MAX_COLLECTION_ITEMS]
        }
        if len(items) > _MAX_COLLECTION_ITEMS:
            result["_omitted_items"] = len(items) - _MAX_COLLECTION_ITEMS
        return result
    if isinstance(value, (list, tuple, set)):
        items = list(value)
        result = [
            _safe_json_value(item, depth=depth + 1)
            for item in items[:_MAX_COLLECTION_ITEMS]
        ]
        if len(items) > _MAX_COLLECTION_ITEMS:
            result.append({"omitted_items": len(items) - _MAX_COLLECTION_ITEMS})
        return result
    return repr(value)


def _limit_payload(payload: Any) -> Any:
    payload = _safe_json_value(payload)
    max_chars = get_settings().REQUEST_LOG_MAX_CHARS
    if not max_chars or max_chars <= 0:
        return payload

    text = json.dumps(payload, ensure_ascii=False, default=repr)
    if len(text) <= max_chars:
        return payload
    return {
        "truncated": True,
        "max_chars": max_chars,
        "original_chars": len(text),
        "preview": text[:max_chars],
    }


class JsonLineFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = getattr(record, "payload", None)
        if payload is None:
            payload = {"message": record.getMessage()}
        return json.dumps(_safe_json_value(payload), ensure_ascii=False, default=repr)


class DroppingQueueHandler(QueueHandler):
    """Keep diagnostic logging from blocking request handling when saturated."""

    def enqueue(self, record: logging.LogRecord) -> None:
        try:
            self.queue.put_nowait(record)
        except Full:
            pass


class PrivateRotatingFileHandler(RotatingFileHandler):
    def _open(self):
        # _open also runs after rollover, when a new active file is created.
        descriptor = os.open(self.baseFilename, os.O_CREAT | os.O_APPEND | os.O_WRONLY, 0o600)
        os.chmod(self.baseFilename, 0o600)
        return os.fdopen(descriptor, self.mode, encoding=self.encoding, errors=self.errors)


def _get_file_logger(name: str, filename: str) -> logging.Logger:
    settings = get_settings()
    log_dir = Path(settings.REQUEST_LOG_DIR)
    log_dir.mkdir(parents=True, exist_ok=True, mode=0o700)

    logger = logging.getLogger(name)
    logger.setLevel(logging.INFO)
    logger.propagate = False

    target = str((log_dir / filename).resolve())
    if logger.handlers:
        return logger

    queue: Queue = Queue(maxsize=settings.REQUEST_LOG_QUEUE_SIZE)
    queue_handler = DroppingQueueHandler(queue)
    file_handler = PrivateRotatingFileHandler(
        target,
        maxBytes=settings.REQUEST_LOG_MAX_BYTES,
        backupCount=settings.REQUEST_LOG_BACKUP_COUNT,
        encoding="utf-8",
    )
    file_handler.setFormatter(JsonLineFormatter())
    listener = QueueListener(queue, file_handler, respect_handler_level=True)
    listener.start()
    _listeners.append(listener)
    logger.addHandler(queue_handler)
    return logger


def get_tool_file_logger() -> logging.Logger:
    global _tool_logger
    if _tool_logger is None:
        _tool_logger = _get_file_logger("mcp_tool_file_log", "tool_calls.jsonl")
    return _tool_logger


def get_postgres_file_logger() -> logging.Logger:
    global _postgres_logger
    if _postgres_logger is None:
        _postgres_logger = _get_file_logger("postgresql_file_log", "postgresql_requests.jsonl")
    return _postgres_logger


def request_logging_enabled() -> bool:
    return bool(get_settings().REQUEST_LOG_ENABLED)


def request_logging_selected() -> bool:
    if not request_logging_enabled():
        return False
    selected = _REQUEST_LOG_SELECTED.get()
    if selected is not None:
        return selected
    return random.random() < get_settings().REQUEST_LOG_SAMPLE_RATE


def log_json_line(
    logger: logging.Logger,
    payload: dict[str, Any],
    *,
    selected: Optional[bool] = None,
) -> None:
    if selected is False or (selected is None and not request_logging_selected()):
        return
    try:
        logger.info("", extra={"payload": _limit_payload(payload)})
    except Exception:
        logger.exception("Failed to write request diagnostic log")


def log_tool_call(func: Callable[..., Any]) -> Callable[..., Any]:
    @wraps(func)
    async def wrapper(*args: Any, **kwargs: Any) -> Any:
        if not request_logging_enabled():
            return await func(*args, **kwargs)

        selected_token = _REQUEST_LOG_SELECTED.set(
            random.random() < get_settings().REQUEST_LOG_SAMPLE_RATE
        )
        if not _REQUEST_LOG_SELECTED.get():
            try:
                return await func(*args, **kwargs)
            finally:
                _REQUEST_LOG_SELECTED.reset(selected_token)

        call_id = uuid.uuid4().hex
        tool_name = func.__name__
        started_at = _utc_now()
        start = time.perf_counter()
        call_token = _TOOL_CALL_ID.set(call_id)
        name_token = _TOOL_NAME.set(tool_name)

        logger = get_tool_file_logger()
        log_json_line(logger, {
            "event": "tool_call_submitted",
            "tool_call_id": call_id,
            "tool_name": tool_name,
            "submitted_at": started_at,
            "input": {"args": args, "kwargs": kwargs},
        })

        try:
            result = await func(*args, **kwargs)
            duration_ms = round((time.perf_counter() - start) * 1000, 3)
            log_json_line(logger, {
                "event": "tool_call_returned",
                "tool_call_id": call_id,
                "tool_name": tool_name,
                "submitted_at": started_at,
                "returned_at": _utc_now(),
                "duration_ms": duration_ms,
                "status": "success",
                "output": result,
            })
            return result
        except Exception as exc:
            duration_ms = round((time.perf_counter() - start) * 1000, 3)
            log_json_line(logger, {
                "event": "tool_call_returned",
                "tool_call_id": call_id,
                "tool_name": tool_name,
                "submitted_at": started_at,
                "returned_at": _utc_now(),
                "duration_ms": duration_ms,
                "status": "error",
                "error_type": type(exc).__name__,
                "error": str(exc),
            })
            raise
        finally:
            _TOOL_CALL_ID.reset(call_token)
            _TOOL_NAME.reset(name_token)
            _REQUEST_LOG_SELECTED.reset(selected_token)

    return wrapper


def current_tool_call_context() -> dict[str, Optional[str]]:
    return {
        "tool_call_id": _TOOL_CALL_ID.get(),
        "tool_name": _TOOL_NAME.get(),
    }
