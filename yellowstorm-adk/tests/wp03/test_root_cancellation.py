"""WP03 cancellation groundwork: registry, barrier epochs, native abort."""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import pytest

from src.root_runtime.cancellation import (
    RootWorkCancelled,
    RootWorkCancellationRegistry,
    check_admission_barrier,
)
from src.root_runtime.contracts import ExecutionRole, ExecutionScopeV1


def _scope(execution_id: str, epoch: int, role: ExecutionRole = ExecutionRole.ROOT) -> ExecutionScopeV1:
    return ExecutionScopeV1(role=role, execution_id=execution_id, conversation_epoch=epoch)


def test_cancel_all_aborts_only_pre_barrier_runs():
    registry = RootWorkCancellationRegistry()
    old_run = registry.register("conv_1", _scope("exec_old", epoch=1))
    new_run = registry.register("conv_1", _scope("exec_new", epoch=5))

    aborted = registry.cancel_all("conv_1", barrier_epoch=3)

    assert aborted == 1
    assert old_run.abort_event.is_set()
    assert not new_run.abort_event.is_set()
    assert registry.current_barrier_epoch("conv_1") == 3


def test_barrier_epoch_is_monotonic():
    registry = RootWorkCancellationRegistry()
    registry.cancel_all("conv_1", barrier_epoch=4)
    registry.cancel_all("conv_1", barrier_epoch=2)
    assert registry.current_barrier_epoch("conv_1") == 4


def test_check_admission_barrier_rejects_stale_scope():
    registry = RootWorkCancellationRegistry()
    registry.cancel_all("conv_1", barrier_epoch=7)
    with pytest.raises(RootWorkCancelled):
        check_admission_barrier(_scope("exec_stale", epoch=6), "conv_1", registry)
    # A scope admitted at the new epoch passes; an unset (legacy) scope passes.
    check_admission_barrier(_scope("exec_fresh", epoch=7), "conv_1", registry)
    check_admission_barrier(ExecutionScopeV1(), "conv_1", registry)


def test_unregister_removes_active_run():
    registry = RootWorkCancellationRegistry()
    handle = registry.register("conv_1", _scope("exec_1", epoch=0))
    assert registry.active_executions("conv_1") == ["exec_1"]
    registry.unregister("conv_1", "exec_1")
    assert registry.active_executions("conv_1") == []
    # Aborting after unregister is a no-op for the gone run.
    assert registry.cancel_all("conv_1", barrier_epoch=1) == 0
    assert not handle.abort_event.is_set()


def test_abort_event_wakes_waiter_asyncio():
    async def scenario():
        registry = RootWorkCancellationRegistry()
        handle = registry.register("conv_1", _scope("exec_1", epoch=0))
        waiter = asyncio.create_task(handle.abort_event.wait())
        await asyncio.sleep(0)
        registry.cancel_all("conv_1", barrier_epoch=1)
        await asyncio.wait_for(waiter, timeout=1)
        return True

    assert asyncio.run(scenario()) is True
