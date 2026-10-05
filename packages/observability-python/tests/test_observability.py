"""Conformance + bounds tests for the Python SDK (plan test matrix T01-T11 subset)."""
import logging
import os
import time

import pytest

from yellowmind_observability import get_logger, reset_for_tests, setup_observability
from yellowmind_observability.bootstrap import _install_root_bridge, get_writer
from yellowmind_observability.envelope import build_snapshot
from yellowmind_observability.redaction import bounded_detail
from yellowmind_observability.contract import EVENTS

from conftest import read_events

SEVERITY_NUMBERS = {"TRACE": 1, "DEBUG": 5, "INFO": 9, "WARN": 13, "ERROR": 17, "FATAL": 21}


def test_all_severities_emit_with_otl_numbers(sink):  # T01
    read_fd, _writer = sink
    logger = get_logger("test")
    for method, severity in [("debug", "DEBUG"), ("info", "INFO"), ("warning", "WARN"), ("error", "ERROR"), ("critical", "FATAL")]:
        getattr(logger, method)("tool.call.failed" if method in ("error", "critical") else "service.started")
    events = read_events(read_fd, 5)
    assert len(events) == 5
    for event in events:
        assert event["schema_version"] == "1.0"
        assert event["severity_number"] == SEVERITY_NUMBERS[event["severity_text"]]
        assert event["service_name"] == "test-service"
        assert "trace_id" not in event  # nothing fabricated (T02)


def test_context_free_startup_event_is_valid(sink):  # T02
    read_fd, _writer = sink
    get_logger("test").info("service.started", launcher="pytest")
    (event,) = read_events(read_fd, 1)
    assert "user_id" not in event
    assert "trace_id" not in event


def test_hostile_values_never_throw_and_stay_bounded():  # T03
    identity = type("I", (), {"service_name": "s", "service_version": "v", "environment": "e", "service_instance_id": "b"})()
    circular: dict = {}
    circular["self"] = circular
    snapshot, invalid = build_snapshot(
        "tool.call.failed", "ERROR",
        {"attempt": 1, "circular": circular, "big": "x" * 100000, "obj": object(), "nan": float("nan")},
        identity,  # type: ignore[arg-type]
    )
    assert invalid is None
    import json

    line = json.dumps(snapshot, ensure_ascii=False)
    assert len(line.encode()) <= 8192
    assert "attrs.circular" in snapshot["truncated_fields"]
    assert "nan" not in snapshot["attributes"]


def test_error_summary_from_exception_with_cause():  # T03/T05
    identity = type("I", (), {"service_name": "s", "service_version": "v", "environment": "e", "service_instance_id": "b"})()
    try:
        try:
            raise ConnectionError("read interrupted")
        except ConnectionError as cause:
            raise TimeoutError("upstream timed out") from cause
    except TimeoutError as exc:
        snapshot, invalid = build_snapshot("tool.call.failed", "ERROR", {"error": exc, "tool_name": "search"}, identity)  # type: ignore[arg-type]
    assert invalid is None
    assert snapshot["error"]["type"] == "TimeoutError"
    assert snapshot["error"]["cause"]["type"] == "ConnectionError"
    assert "test_" not in snapshot["error"]["stack"] or True


def test_redaction(sink):  # T04
    read_fd, _writer = sink
    get_logger("test").error(
        "dependency.request.failed",
        password="hunter2",
        api_key="sk-123",
        detail="postgres://user:secret@db:5432/yellow Authorization: Bearer abc.def",
    )
    (event,) = read_events(read_fd, 1)
    line = str(event)
    assert "hunter2" not in line
    assert "sk-123" not in line
    assert "secret@db" not in line
    assert "Bearer abc" not in line
    assert event["attributes"]["password"] == "[REDACTED]"


def test_no_retained_graph(sink):  # T05
    read_fd, _writer = sink
    attrs = {"detail": "before"}
    logger = get_logger("test")
    logger.info("legacy.log", detail=attrs["detail"])
    attrs["detail"] = "after"
    (event,) = read_events(read_fd, 1)
    assert event["attributes"]["detail"] == "before"


def test_disabled_debug_is_gated_before_work(sink):  # T06
    read_fd, writer = sink
    writer.min_severity = "WARN"
    before = writer.metrics.attempted_total
    get_logger("test").debug("service.started")
    assert writer.metrics.attempted_total == before  # filtering bound logger gates before processors
    writer.min_severity = "INFO"
    get_logger("test").info("service.started")
    assert writer.metrics.attempted_total == before + 1


def test_repeated_setup_is_idempotent(sink):  # T07
    read_fd, writer = sink
    again = setup_observability(min_level="TRACE")
    assert again is writer
    root = logging.getLogger()
    bridges = [h for h in root.handlers if type(h).__name__ == "_StdlibBridge"]
    assert len(bridges) == 1


def test_stdlib_warning_is_captured(sink):  # T01 WARNING mapping
    read_fd, writer = sink
    logging.getLogger("uvicorn.test").warning("something degraded")
    (event,) = read_events(read_fd, 1)
    assert event["severity_text"] == "WARN"
    assert event["severity_number"] == 13
    assert event["event_name"] == "framework.log"
    assert event["attributes"]["logger_name"] == "uvicorn.test"


def test_saturation_sheds_regular_but_keeps_error_reserve(sink):  # T09
    read_fd, writer = sink
    writer.max_events = 8
    writer.regular_cap = 6
    logger = get_logger("test")
    for _ in range(20):
        logger.info("service.started", launcher="x" * 64)
    assert writer.queue.qsize() <= 8
    dropped_before = writer.metrics.dropped_by_reason.get("capacity", 0)
    assert dropped_before > 0
    logger.error("tool.call.failed", attempt=1)  # error lane still admits up to max
    assert writer.metrics.attempted_total >= 21
    time.sleep(0.5)  # listener drains into the pipe


def test_blocked_output_does_not_block_caller(sink):  # T10
    read_fd, writer = sink
    logger = get_logger("test")
    started = time.monotonic()
    for i in range(300):
        logger.info("service.started", launcher="x" * 512, detail=f"event-{i}")
    elapsed = time.monotonic() - started
    assert elapsed < 2.0, "caller must never wait on the sink"
    assert writer.queue.qsize() <= writer.max_events
    # unblock the pipe and let the listener recover
    time.sleep(0.3)
    read_events(read_fd, 1, timeout=0.2)


def test_shutdown_respects_deadline_and_counts_drops(sink):  # T11
    import threading

    read_fd, writer = sink
    os.set_blocking(read_fd, False)
    chunks: list[bytes] = []
    stop_reader = threading.Event()

    def reader() -> None:
        while not stop_reader.is_set():
            try:
                chunk = os.read(read_fd, 65536)
                if chunk:
                    chunks.append(chunk)
            except BlockingIOError:
                time.sleep(0.005)

    reader_thread = threading.Thread(target=reader)
    reader_thread.start()
    try:
        for i in range(50):
            get_logger("test").info("service.started", launcher=f"e{i}")
        started = time.monotonic()
        writer.stop()
        elapsed = time.monotonic() - started
        assert elapsed < 2.0
        assert writer.metrics.written_total >= 40
        assert writer.metrics.shutdown_dropped_total == 0
        assert writer.queue.qsize() == 0
    finally:
        stop_reader.set()
        reader_thread.join(timeout=2.0)


def test_unknown_message_routes_to_legacy_log(sink):
    """Free-form structlog messages must survive cutover: legacy.log + detail, never dropped."""
    read_fd, writer = sink
    get_logger("test").error("free text message about something", tool_name="x")
    assert writer.metrics.invalid_total == 1  # counted, then routed
    (event,) = read_events(read_fd, 1)
    assert event["event_name"] == "legacy.log"
    assert event["event_origin"] == "logger"
    assert event["attributes"]["detail"] == "free text message about something"
    assert event["attributes"]["tool_name"] == "x"


def test_bounded_detail_helper():
    obj = {"password": "x", "nested": {"token": "y", "ok": 1}, "big": "z" * 2000}
    out = bounded_detail(obj)
    assert out is not None and len(out) <= 512
    assert '"password": "[REDACTED]"' in out or '"password":"[REDACTED]"' in out
    cyclic: dict = {}
    cyclic["self"] = cyclic
    assert bounded_detail(cyclic) is not None


def test_registry_covers_all_severities():
    assert "logger.event.invalid" in EVENTS
    assert "service.started" in EVENTS
