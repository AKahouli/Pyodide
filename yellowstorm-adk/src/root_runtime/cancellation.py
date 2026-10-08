"""Native abort wiring and the work-group Stop barrier (WP03, plan §11.3).

Process-local registry of active root-work runs keyed by conversation. The
backend Stop-all (WP08) bumps the conversation epoch and notifies replicas;
this side records the barrier epoch, refuses late-admitted scopes from the old
epoch and flips registered asyncio abort events so running invocations unwind
through ADK's native abort support.
"""
from __future__ import annotations

import asyncio
import threading
from dataclasses import dataclass, field
from typing import Dict, Optional

from src.logger.logging import get_logger
from src.root_runtime.contracts import ExecutionScopeV1

logger = get_logger("root_runtime.cancellation")


class RootWorkCancelled(Exception):
    """Raised when a scope's epoch is behind the conversation's Stop barrier."""


@dataclass
class RootRunHandle:
    scope: ExecutionScopeV1
    abort_event: asyncio.Event = field(default_factory=asyncio.Event)


class RootWorkCancellationRegistry:
    """Active root-work runs + the latest observed Stop barrier per conversation."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._runs: Dict[str, Dict[str, RootRunHandle]] = {}
        self._barrier_epochs: Dict[str, int] = {}

    def register(self, conversation_id: str, scope: ExecutionScopeV1) -> RootRunHandle:
        handle = RootRunHandle(scope=scope)
        with self._lock:
            if scope.is_set and scope.conversation_epoch < self._barrier_epochs.get(conversation_id, 0):
                raise RootWorkCancelled(f"execution {scope.execution_id} is behind the Stop barrier")
            self._runs.setdefault(conversation_id, {})[scope.execution_id] = handle
        return handle

    def unregister(self, conversation_id: str, execution_id: str) -> None:
        with self._lock:
            runs = self._runs.get(conversation_id)
            if runs:
                runs.pop(execution_id, None)
                if not runs:
                    self._runs.pop(conversation_id, None)

    def current_barrier_epoch(self, conversation_id: str) -> int:
        with self._lock:
            return self._barrier_epochs.get(conversation_id, 0)

    def cancel_all(self, conversation_id: str, barrier_epoch: int) -> int:
        """Apply the Stop barrier: record the epoch and abort active runs.

        Returns the number of active runs aborted. Late registrations whose
        scope was admitted before this epoch still get aborted by a subsequent
        cancel_all; scopes admitted after the barrier check against it at
        admission time.
        """
        with self._lock:
            previous = self._barrier_epochs.get(conversation_id, 0)
            if barrier_epoch > previous:
                self._barrier_epochs[conversation_id] = barrier_epoch
            handles = list(self._runs.get(conversation_id, {}).values())
        aborted = 0
        for handle in handles:
            # Runs admitted before the barrier are aborted; runs admitted after
            # it carry the new epoch and are left alone.
            if handle.scope.conversation_epoch < barrier_epoch and not handle.abort_event.is_set():
                handle.abort_event.set()
                aborted += 1
        if aborted or barrier_epoch > previous:
            logger.info(
                f"[root_runtime] Stop barrier applied - conversation_id: {conversation_id}, "
                f"barrier_epoch: {barrier_epoch}, aborted_runs: {aborted}"
            )
        return aborted

    def active_executions(self, conversation_id: str):
        with self._lock:
            return list(self._runs.get(conversation_id, {}).keys())


def check_admission_barrier(
    scope: ExecutionScopeV1,
    conversation_id: str,
    registry: RootWorkCancellationRegistry,
) -> None:
    """Reject a scope admitted before an already-applied Stop barrier (§11.3).

    The barrier applies before model invocation too — callers must run this
    after compilation and before dispatching any child work.
    """
    if scope.is_set and scope.conversation_epoch < registry.current_barrier_epoch(conversation_id):
        raise RootWorkCancelled(
            f"execution {scope.execution_id} admitted at epoch {scope.conversation_epoch} "
            f"is behind the Stop barrier (epoch {registry.current_barrier_epoch(conversation_id)})"
        )


_registry: Optional[RootWorkCancellationRegistry] = None


def get_root_cancellation_registry() -> RootWorkCancellationRegistry:
    global _registry
    if _registry is None:
        _registry = RootWorkCancellationRegistry()
    return _registry
