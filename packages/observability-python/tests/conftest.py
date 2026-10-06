import os
import sys
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from yellowmind_observability import (  # noqa: E402
    get_logger,
    reset_for_tests,
    setup_observability,
)
from yellowmind_observability.bootstrap import get_writer  # noqa: E402


@pytest.fixture()
def sink():
    """A pipe standing in for stderr; returns (read_fd, writer)."""
    read_fd, write_fd = os.pipe()
    writer = setup_observability(
        service_name="test-service",
        service_version="test",
        environment="local",
        min_level="TRACE",
        stderr_fd=write_fd,
    )
    yield read_fd, writer
    reset_for_tests()
    os.close(read_fd)
    os.close(write_fd)


def read_events(read_fd: int, count: int, timeout: float = 3.0) -> list[dict]:
    """Read `count` newline-delimited JSON events from the pipe (with deadline)."""
    os.set_blocking(read_fd, False)
    events: list[dict] = []
    buffer = b""
    deadline = time.monotonic() + timeout
    while len(events) < count and time.monotonic() < deadline:
        try:
            chunk = os.read(read_fd, 65536)
            if not chunk:
                break
            buffer += chunk
            while b"\n" in buffer:
                line, buffer = buffer.split(b"\n", 1)
                if line.strip():
                    events.append(json_parse(line))
        except BlockingIOError:
            time.sleep(0.01)
    return events


def json_parse(line: bytes) -> dict:
    import json

    return json.loads(line.decode("utf-8"))
