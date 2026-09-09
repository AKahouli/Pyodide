"""Supervision for the in-process gRPC serving task.

A transient database/network failure during gRPC startup previously left the
HTTP process alive with gRPC permanently dead (F06). This supervisor owns the
serving task for the whole process lifetime: transient startup failures are
retried indefinitely with capped exponential backoff, fatal configuration
failures surface immediately, and readiness reflects the actual serving state
instead of "a task was created".
"""

import asyncio
import random
import time
from enum import Enum
from typing import Any, Awaitable, Callable, Optional

from structlog import get_logger

logger = get_logger(__name__)

BACKOFF_BASE_SECONDS = 1.0
BACKOFF_CAP_SECONDS = 30.0
# Backoff only resets after the server has served stably for this long, so a
# flapping port bind does not hide a persistent dependency failure.
STABLE_SERVING_SECONDS = 60.0


class FatalGrpcConfigurationError(RuntimeError):
    """Unrecoverable configuration/protocol failure: retrying cannot help."""


class GrpcSupervisorState(str, Enum):
    STARTING = "starting"
    INITIALIZING = "initializing"
    SERVING = "serving"
    RETRY_WAIT = "retry_wait"
    STOPPED = "stopped"


def classify_startup_failure(exc: BaseException) -> str:
    """Classify a serving-task failure as 'fatal' or 'transient'.

    Fatal: missing generated protobuf code, TLS material problems, and other
    explicit configuration errors. Everything else — database, network, and
    dependency failures in particular — is transient by default so a
    temporary outage is retried while the process stays healthy.
    """
    if isinstance(exc, FatalGrpcConfigurationError):
        return "fatal"
    if isinstance(exc, (ImportError, ModuleNotFoundError)):
        return "fatal"

    message = str(exc).lower()
    fatal_markers = (
        "certificate",
        "private key",
        "tls handshake file",
        "protobuf code not generated",
        "no such file",
        "permission denied",
    )
    if any(marker in message for marker in fatal_markers):
        return "fatal"
    return "transient"


class GrpcSupervisor:
    """Single cancellable owner of the gRPC serving task."""

    def __init__(
        self,
        host: str,
        port: int,
        start_callable: Optional[Callable[..., Awaitable[Any]]] = None,
    ) -> None:
        self._host = host
        self._port = port
        self._start_callable = start_callable
        self._task: Optional[asyncio.Task[None]] = None
        self._serving_task: Optional[asyncio.Task[Any]] = None
        self._state = GrpcSupervisorState.STARTING
        self._ready = asyncio.Event()
        self._shutdown_requested = False
        self._wake = asyncio.Event()
        self._consecutive_failures = 0
        self._serving_since: Optional[float] = None

    # -- introspection for health/readiness --------------------------------

    @property
    def state(self) -> str:
        return self._state.value

    def is_ready(self) -> bool:
        return self._state == GrpcSupervisorState.SERVING

    async def wait_ready(self, timeout: Optional[float] = None) -> None:
        await asyncio.wait_for(self._ready.wait(), timeout=timeout)

    # -- lifecycle ----------------------------------------------------------

    def start(self) -> asyncio.Task[None]:
        if self._task is not None and not self._task.done():
            raise RuntimeError("gRPC supervisor already started")
        self._task = asyncio.create_task(self.run(), name="grpc-supervisor")
        return self._task

    async def stop(self) -> None:
        """Request shutdown; interrupts backoff or initialization promptly."""
        self._shutdown_requested = True
        self._wake.set()
        if self._serving_task is not None and not self._serving_task.done():
            self._serving_task.cancel()
        if self._task is not None and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        self._state = GrpcSupervisorState.STOPPED

    # -- supervision loop ---------------------------------------------------

    async def run(self) -> None:
        logger.info("[gRPC supervisor] started (host=%s port=%s)", self._host, self._port)
        while not self._shutdown_requested:
            await self._run_once()
            if self._shutdown_requested:
                break
            await self._retry_wait()
        self._state = GrpcSupervisorState.STOPPED
        logger.info("[gRPC supervisor] stopped")

    async def _run_once(self) -> None:
        """One initialization → serving → (failure | shutdown) cycle."""
        self._state = GrpcSupervisorState.INITIALIZING
        self._ready.clear()
        self._serving_since = None

        start_coro = self._start_callable(
            self._host, self._port, on_ready=self._mark_ready
        )
        self._serving_task = asyncio.create_task(start_coro, name="grpc-serving")
        try:
            await self._serving_task
        except asyncio.CancelledError:
            # Supervisor cancellation: ensure the serving task is fully
            # awaited so no listener or pool outlives the cycle.
            raise
        except Exception as exc:
            await self._handle_failure(exc)
            return
        else:
            # The serving coroutine only returns normally on its own — an
            # unexpected exit is treated as a failure unless shutdown began.
            if not self._shutdown_requested:
                logger.error(
                    "[gRPC supervisor] serving task exited unexpectedly; treating as failure"
                )
                self._note_failure()
        finally:
            self._serving_task = None

    async def _handle_failure(self, exc: BaseException) -> None:
        classification = classify_startup_failure(exc)
        if classification == "fatal":
            self._state = GrpcSupervisorState.STOPPED
            logger.error(
                "[gRPC supervisor] fatal configuration failure; not retrying: %s: %s",
                type(exc).__name__,
                exc,
            )
            raise exc

        self._note_failure()
        logger.warning(
            "[gRPC supervisor] transient serving failure (%s: %s); will retry",
            type(exc).__name__,
            exc,
        )
        await self._cleanup_failed_cycle()

    def _note_failure(self) -> None:
        if (
            self._serving_since is not None
            and time.monotonic() - self._serving_since >= STABLE_SERVING_SECONDS
        ):
            # Stable serving interval completed: the flapping episode ended,
            # so restart the backoff progression.
            self._consecutive_failures = 0
        self._consecutive_failures += 1
        self._ready.clear()
        self._serving_since = None

    async def _cleanup_failed_cycle(self) -> None:
        # start_grpc_server performs its own bounded teardown in a finally
        # block; the serving task has already fully completed here, so no
        # listener/pool from this cycle survives. Just make sure the task is
        # reaped before starting another one.
        if self._serving_task is not None and not self._serving_task.done():
            try:
                await self._serving_task
            except BaseException:
                pass

    async def _retry_wait(self) -> None:
        if self._shutdown_requested:
            return
        delay = min(
            BACKOFF_BASE_SECONDS * (2 ** max(self._consecutive_failures - 1, 0)),
            BACKOFF_CAP_SECONDS,
        )
        delay *= 0.5 + random.random()  # jitter
        self._state = GrpcSupervisorState.RETRY_WAIT
        logger.info(
            "[gRPC supervisor] retrying in %.1fs (consecutive_failures=%d)",
            delay,
            self._consecutive_failures,
        )
        self._wake.clear()
        try:
            await asyncio.wait_for(self._wake.wait(), timeout=delay)
        except asyncio.TimeoutError:
            pass

    def _mark_ready(self) -> None:
        self._state = GrpcSupervisorState.SERVING
        self._serving_since = time.monotonic()
        self._ready.set()
        logger.info("[gRPC supervisor] gRPC is SERVING")


# Module-level handle so health/readiness routes can introspect the current
# supervisor without app-state plumbing.
_current_supervisor: Optional[GrpcSupervisor] = None


def set_current_supervisor(supervisor: Optional[GrpcSupervisor]) -> None:
    global _current_supervisor
    _current_supervisor = supervisor


def get_current_supervisor() -> Optional[GrpcSupervisor]:
    return _current_supervisor
