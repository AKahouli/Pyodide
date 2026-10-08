"""Writer: bounded snapshot queue + listener thread owning the stderr fd (plan §5.3).

Queue items are (estimated_bytes, snapshot_dict) tuples of construction-bounded scalars.
The listener renders JSON, enforces the final byte cap (deterministic degradation) and
writes to the raw fd; blocking output or sink failure never affects business threads.
"""
from __future__ import annotations

import json
import os
import queue
import sys
import threading
import time
from typing import Any, Dict, Optional, Tuple

from .contract import BUDGETS


class Metrics:
    __slots__ = (
        "attempted_total", "admitted_total", "written_total", "dropped_total", "invalid_total",
        "writer_restarts_total", "shutdown_dropped_total", "dropped_by_reason", "dropped_by_severity",
    )

    def __init__(self) -> None:
        self.attempted_total = 0
        self.admitted_total = 0
        self.written_total = 0
        self.dropped_total = 0
        self.invalid_total = 0
        self.writer_restarts_total = 0
        self.shutdown_dropped_total = 0
        self.dropped_by_reason: Dict[str, int] = {}
        self.dropped_by_severity: Dict[str, int] = {}

    def drop(self, events: int, reason: str, severity: Optional[str] = None) -> None:
        self.dropped_total += events
        self.dropped_by_reason[reason] = self.dropped_by_reason.get(reason, 0) + events
        if severity:
            self.dropped_by_severity[severity] = self.dropped_by_severity.get(severity, 0) + events

    def snapshot(self) -> Dict[str, Any]:
        return {name: getattr(self, name) for name in self.__slots__ if not name.startswith(("dropped_by",))} | {
            "dropped_by_reason": dict(self.dropped_by_reason),
            "dropped_by_severity": dict(self.dropped_by_severity),
        }


def estimate_bytes(snapshot: Dict[str, Any]) -> int:
    total = 384  # fixed envelope overhead
    for key, value in snapshot.items():
        if isinstance(value, str):
            total += len(key) + len(value.encode("utf-8", "replace"))
        elif isinstance(value, dict):
            total += estimate_bytes(value)
        elif isinstance(value, list):
            total += sum(len(str(item)) for item in value)
    return total


class Writer:
    """Bounded, non-waiting admission + one listener thread. Safe to share process-wide."""

    def __init__(
        self,
        *,
        identity: Any,
        max_events: int,
        error_reserve_events: int,
        shutdown_timeout_ms: int,
        stderr_fd: Optional[int] = None,
    ) -> None:
        self.identity = identity
        self.max_events = max_events
        self.regular_cap = max(1, max_events - error_reserve_events)
        self.shutdown_timeout_ms = shutdown_timeout_ms
        self.queue: "queue.Queue[Tuple[int, Dict[str, Any]]]" = queue.Queue(maxsize=max_events)
        self.fd = stderr_fd if stderr_fd is not None else 2
        self.metrics = Metrics()
        self.min_severity = "INFO"
        self._stopping = threading.Event()
        self._listener: Optional[threading.Thread] = None
        self._spawn()

    # -- caller side (business threads) -------------------------------------------------
    def is_saturated(self, severity: str) -> bool:
        size = self.queue.qsize()
        if severity in ("ERROR", "FATAL"):
            return size >= self.max_events
        return size >= self.regular_cap

    def enqueue(self, snapshot: Dict[str, Any], severity: str) -> None:
        item = (estimate_bytes(snapshot), snapshot)
        try:
            self.queue.put_nowait(item)
            self.metrics.admitted_total += 1
        except queue.Full:
            self.metrics.drop(1, "capacity", severity)

    def count_drop(self, reason: str, severity: str) -> None:
        self.metrics.drop(1, reason, severity)

    # -- listener side -------------------------------------------------------------------
    def _spawn(self) -> None:
        self._listener = threading.Thread(target=self._listen, name="yellowmind-log-writer", daemon=True)
        self._listener.start()

    def _listen(self) -> None:
        deadline: Optional[float] = None
        while True:
            if self._stopping.is_set():
                if deadline is None:
                    deadline = time.monotonic() + self.shutdown_timeout_ms / 1000
                if self.queue.empty() or time.monotonic() > deadline:
                    self._count_remaining_on_shutdown()
                    return
            try:
                est, snapshot = self.queue.get(timeout=0.2)
            except queue.Empty:
                continue
            self._render_and_write(snapshot)

    def _count_remaining_on_shutdown(self) -> None:
        remaining = 0
        try:
            while True:
                self.queue.get_nowait()
                remaining += 1
        except queue.Empty:
            pass
        if remaining:
            self.metrics.shutdown_dropped_total += remaining
            self.metrics.drop(remaining, "shutdown")

    def _render_and_write(self, snapshot: Dict[str, Any]) -> None:
        try:
            line = json.dumps(snapshot, ensure_ascii=False, separators=(",", ":"))
        except (TypeError, ValueError):
            self.metrics.invalid_total += 1
            self.metrics.drop(1, "invalid")
            return
        max_bytes = BUDGETS["max_event_bytes"]
        if len(line.encode("utf-8")) > max_bytes:
            line = self._degrade(snapshot, max_bytes)
            if line is None:
                self.metrics.invalid_total += 1
                self.metrics.drop(1, "oversized")
                return
        self._write(line.encode("utf-8") + b"\n")
        self.metrics.written_total += 1

    def _degrade(self, snapshot: Dict[str, Any], max_bytes: int) -> Optional[str]:
        for field in ("error", "attributes"):  # stack already inside error
            if field in snapshot:
                del snapshot[field]
                snapshot.setdefault("truncated_fields", [])
                if field not in snapshot["truncated_fields"]:
                    snapshot["truncated_fields"].append(field)
                line = json.dumps(snapshot, ensure_ascii=False, separators=(",", ":"))
                if len(line.encode("utf-8")) <= max_bytes:
                    return line
        return None

    def _write(self, data: bytes) -> None:
        deadline = time.monotonic() + 0.2
        while data:
            try:
                written = os.write(self.fd, data)
                data = data[written:]  # partial writes must not truncate JSON lines
                if not data:
                    return
            except BlockingIOError:
                if time.monotonic() > deadline:
                    self.metrics.drop(1, "blocked_output")
                    return
                time.sleep(0.005)
            except OSError:
                self.metrics.drop(1, "write_error")
                return

    # -- lifecycle -------------------------------------------------------------------------
    def stop(self) -> None:
        """Bounded drain: the listener renders pending work until the queue empties or the deadline passes."""
        self._stopping.set()
        if self._listener is not None:
            self._listener.join(timeout=self.shutdown_timeout_ms / 1000 + 0.5)

    def metrics_snapshot(self) -> Dict[str, Any]:
        snap = self.metrics.snapshot()
        snap["pending_events"] = self.queue.qsize()
        snap["writer_up"] = 1 if self._listener is not None and self._listener.is_alive() else 0
        return snap


def env_int(name: str, fallback: int, minimum: int, maximum: int) -> int:
    raw = os.environ.get(name, "")
    try:
        value = int(raw)
    except ValueError:
        value = fallback
    return max(min(value, maximum), minimum)
