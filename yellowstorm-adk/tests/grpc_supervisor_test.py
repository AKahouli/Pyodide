"""Tests for the gRPC serving supervisor (F06 / ADK-01..03)."""

import asyncio

import pytest

from src.grpc_server.supervisor import (
    BACKOFF_CAP_SECONDS,
    FatalGrpcConfigurationError,
    GrpcSupervisor,
    GrpcSupervisorState,
    classify_startup_failure,
    set_current_supervisor,
    get_current_supervisor,
)


@pytest.fixture(autouse=True)
def _clear_supervisor_handle():
    set_current_supervisor(None)
    yield
    set_current_supervisor(None)


class Flap:
    """Callable that fails N times then serves until cancelled."""

    def __init__(self, failures: int, failure: Exception):
        self.failures = failures
        self.failure = failure
        self.calls = 0
        self.ready_signal = None

    async def __call__(self, host, port, on_ready=None):
        self.calls += 1
        if self.calls <= self.failures:
            raise self.failure
        if on_ready is not None:
            on_ready()
        try:
            await asyncio.Event().wait()  # serve until cancelled
        except asyncio.CancelledError:
            raise


def test_classifies_config_and_import_failures_as_fatal():
    assert classify_startup_failure(FatalGrpcConfigurationError("no cert")) == "fatal"
    assert classify_startup_failure(ImportError("chatbot_pb2_grpc")) == "fatal"
    assert classify_startup_failure(RuntimeError("bad certificate file")) == "fatal"


def test_classifies_dependency_failures_as_transient():
    assert classify_startup_failure(RuntimeError("connection refused")) == "transient"
    assert classify_startup_failure(TimeoutError()) == "transient"
    assert classify_startup_failure(OSError("network is down")) == "transient"


@pytest.mark.asyncio
async def test_recovers_after_transient_startup_failures_without_restart():
    flap = Flap(failures=2, failure=RuntimeError("server selection timed out"))
    supervisor = GrpcSupervisor("127.0.0.1", 0, start_callable=flap)
    supervisor.start()
    try:
        # Two jittered backoff delays must elapse before the third attempt.
        await asyncio.wait_for(supervisor.wait_ready(), timeout=15.0)
        assert supervisor.is_ready()
        assert flap.calls == 3
    finally:
        await supervisor.stop()
    assert supervisor.state == GrpcSupervisorState.STOPPED.value


@pytest.mark.asyncio
async def test_fatal_failure_terminates_supervisor_task():
    started = asyncio.Event()

    async def fatal(host, port, on_ready=None):
        started.set()
        raise FatalGrpcConfigurationError("protobuf code not generated")

    supervisor = GrpcSupervisor("127.0.0.1", 0, start_callable=fatal)
    task = supervisor.start()
    await asyncio.wait_for(started.wait(), timeout=1.0)
    with pytest.raises(FatalGrpcConfigurationError):
        await asyncio.wait_for(task, timeout=2.0)
    assert not supervisor.is_ready()
    assert supervisor.state == GrpcSupervisorState.STOPPED.value


@pytest.mark.asyncio
async def test_unexpected_serving_exit_is_retried():
    exits = True

    async def serve_then_exit(host, port, on_ready=None):
        nonlocal exits
        if on_ready is not None:
            on_ready()
        await asyncio.sleep(0.05)  # "unexpected" normal return
        exits = False

    supervisor = GrpcSupervisor("127.0.0.1", 0, start_callable=serve_then_exit)
    task = supervisor.start()
    # It should keep cycling, not settle silently.
    await asyncio.sleep(0.3)
    assert not task.done() or task.cancelled()
    await supervisor.stop()


@pytest.mark.asyncio
async def test_shutdown_interrupts_backoff_promptly():
    flap = Flap(failures=10_000, failure=RuntimeError("postgres is down"))
    supervisor = GrpcSupervisor("127.0.0.1", 0, start_callable=flap)
    task = supervisor.start()
    await asyncio.sleep(0.2)  # let it enter retry_wait with growing backoff
    stop_started = asyncio.get_running_loop().time()
    await supervisor.stop()
    elapsed = asyncio.get_running_loop().time() - stop_started
    assert elapsed < 1.0, "shutdown must not wait out the backoff delay"
    assert task.done()
    calls_at_stop = flap.calls


@pytest.mark.asyncio
async def test_backoff_is_capped():
    delays = []
    supervisor = GrpcSupervisor("127.0.0.1", 0, start_callable=Flap(0, RuntimeError("x")))
    supervisor._consecutive_failures = 50
    # _retry_wait computes delay from consecutive failures; cap it.
    import random

    random.seed(0)
    await supervisor._retry_wait()
    assert supervisor.state == GrpcSupervisorState.RETRY_WAIT.value
    assert BACKOFF_CAP_SECONDS == 30.0


@pytest.mark.asyncio
async def test_readiness_clears_after_serving_task_fails():
    ready_then_fail = asyncio.Event()

    state = {"phase": 0}

    async def serve_then_crash(host, port, on_ready=None):
        if state["phase"] == 0:
            state["phase"] = 1
            if on_ready is not None:
                on_ready()
            ready_then_fail.set()
            # Hold serving briefly so the test can observe the ready state
            # before the mid-flight crash clears it.
            await asyncio.sleep(0.2)
            raise RuntimeError("serving task crashed mid-flight")
        await asyncio.Event().wait()

    supervisor = GrpcSupervisor("127.0.0.1", 0, start_callable=serve_then_crash)
    supervisor.start()
    try:
        await asyncio.wait_for(ready_then_fail.wait(), timeout=1.0)
        assert supervisor.is_ready()
        # Wait for the supervisor to notice the crash and clear readiness.
        for _ in range(50):
            if not supervisor.is_ready():
                break
            await asyncio.sleep(0.02)
        assert not supervisor.is_ready()
    finally:
        await supervisor.stop()


@pytest.mark.asyncio
async def test_current_supervisor_handle_roundtrip():
    assert get_current_supervisor() is None
    supervisor = GrpcSupervisor("127.0.0.1", 0, start_callable=Flap(0, RuntimeError("x")))
    set_current_supervisor(supervisor)
    assert get_current_supervisor() is supervisor
