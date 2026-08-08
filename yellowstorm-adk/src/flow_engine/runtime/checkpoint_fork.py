"""Exact LangGraph checkpoint forks for RunFromCheckpoint."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, replace
from typing import Any

from langgraph.checkpoint.base import copy_checkpoint
from structlog import get_logger

from src.flow_engine.runtime.checkpointer import checkpoint_operation_lock

logger = get_logger(__name__)

FORK_MODE = "yellowstorm_exact_replay"
DEFAULT_MAX_SCAN_DEPTH = 10_000


class ReplayCheckpointNotFoundError(RuntimeError):
    """The source history has no exact checkpoint for the replay target."""


class ReplayForkConflictError(RuntimeError):
    """The target thread already belongs to another or advanced replay."""


@dataclass(frozen=True)
class ReplayTarget:
    source_execution_id: str
    target_execution_id: str
    target_node_id: str
    target_iteration: int


@dataclass(frozen=True)
class ForkResult:
    config: dict[str, Any]
    source_checkpoint_id: str
    target_checkpoint_id: str
    reused: bool = False


async def find_replay_checkpoint(
    graph: Any,
    target: ReplayTarget,
    *,
    max_scan_depth: int = DEFAULT_MAX_SCAN_DEPTH,
) -> Any:
    """Find the exact state immediately before the requested node iteration."""
    source_config = {"configurable": {"thread_id": target.source_execution_id}}
    current_state = await graph.aget_state(source_config)
    depth = 0

    logger.info(
        "replay_checkpoint_scan_started",
        source_execution_id=target.source_execution_id,
        target_node_id=target.target_node_id,
        target_iteration=target.target_iteration,
    )
    while current_state is not None and depth < max_scan_depth:
        current_next = set(getattr(current_state, "next", ()) or ())
        current_values = getattr(current_state, "values", {}) or {}
        iterations = current_values.get("iterations", {}) if isinstance(current_values, dict) else {}
        if (
            target.target_node_id in current_next
            and int(iterations.get(target.target_node_id, 0) or 0) == target.target_iteration
        ):
            logger.info(
                "replay_checkpoint_found",
                source_execution_id=target.source_execution_id,
                target_node_id=target.target_node_id,
                target_iteration=target.target_iteration,
                scan_depth=depth,
            )
            return current_state

        parent_config = getattr(current_state, "parent_config", None)
        if not parent_config:
            break
        current_state = await graph.aget_state(parent_config)
        depth += 1

    logger.warning(
        "replay_checkpoint_not_found",
        source_execution_id=target.source_execution_id,
        target_node_id=target.target_node_id,
        target_iteration=target.target_iteration,
        scan_depth=depth,
    )
    raise ReplayCheckpointNotFoundError(
        f"No exact checkpoint exists before {target.target_node_id} "
        f"iteration {target.target_iteration}"
    )


class CheckpointForkService:
    """Fork exact saver-owned checkpoints without mutating source history."""

    def __init__(self) -> None:
        self._locks: dict[str, asyncio.Lock] = {}
        self._locks_guard = asyncio.Lock()

    async def prepare(
        self,
        graph: Any,
        checkpointer: Any,
        target: ReplayTarget,
        state_update: dict[str, Any],
    ) -> ForkResult:
        """Own fork creation and normalization until the target advances."""
        async with checkpoint_operation_lock(f"replay:{target.target_execution_id}"):
            result = await self.fork(graph, checkpointer, target)
            try:
                normalized_config = await graph.aupdate_state(
                    result.config,
                    state_update,
                )
            except BaseException:
                if not result.reused:
                    await checkpointer.adelete_thread(target.target_execution_id)
                raise
            return replace(result, config=normalized_config)

    async def fork(
        self,
        graph: Any,
        checkpointer: Any,
        target: ReplayTarget,
    ) -> ForkResult:
        lock = await self._target_lock(target.target_execution_id)
        try:
            async with lock:
                state = await find_replay_checkpoint(graph, target)
                return await self._fork_state(checkpointer, target, state)
        finally:
            async with self._locks_guard:
                if not lock.locked():
                    self._locks.pop(target.target_execution_id, None)

    async def _target_lock(self, target_execution_id: str) -> asyncio.Lock:
        async with self._locks_guard:
            return self._locks.setdefault(target_execution_id, asyncio.Lock())

    async def _fork_state(
        self,
        checkpointer: Any,
        target: ReplayTarget,
        replay_state: Any,
    ) -> ForkResult:
        source_config = getattr(replay_state, "config", None)
        if not source_config:
            raise ReplayCheckpointNotFoundError("Replay checkpoint has no saver config")

        source_tuple = await checkpointer.aget_tuple(source_config)
        if source_tuple is None:
            raise ReplayCheckpointNotFoundError("Replay checkpoint is unavailable")

        source_configurable = source_tuple.config.get("configurable", {})
        source_checkpoint_id = str(source_configurable.get("checkpoint_id", ""))
        checkpoint_ns = str(source_configurable.get("checkpoint_ns", ""))
        target_config = {
            "configurable": {
                "thread_id": target.target_execution_id,
                "checkpoint_ns": checkpoint_ns,
            }
        }
        lineage = {
            "fork_mode": FORK_MODE,
            "source_execution_id": target.source_execution_id,
            "source_checkpoint_id": source_checkpoint_id,
            "target_execution_id": target.target_execution_id,
            "target_node_id": target.target_node_id,
            "target_iteration": target.target_iteration,
        }

        existing = [item async for item in checkpointer.alist(target_config, limit=2)]
        if existing:
            metadata = existing[0].metadata or {}
            if not all(metadata.get(key) == value for key, value in lineage.items()):
                raise ReplayForkConflictError(
                    f"Replay target {target.target_execution_id} already has different lineage"
                )
            if len(existing) > 1:
                raise ReplayForkConflictError(
                    f"Replay target {target.target_execution_id} has already started"
                )
            existing_config = existing[0].config
            return ForkResult(
                config=existing_config,
                source_checkpoint_id=source_checkpoint_id,
                target_checkpoint_id=str(
                    existing_config.get("configurable", {}).get("checkpoint_id", "")
                ),
                reused=True,
            )

        created = False
        try:
            logger.info("replay_fork_started", **lineage)
            copied_checkpoint = copy_checkpoint(source_tuple.checkpoint)
            next_config = await checkpointer.aput(
                target_config,
                copied_checkpoint,
                {
                    "source": "fork",
                    "step": source_tuple.metadata.get("step", -1),
                    "parents": {},
                    **lineage,
                },
                dict(copied_checkpoint.get("channel_versions", {})),
            )
            created = True

            writes_by_task_id: dict[str, list[tuple[str, Any]]] = {}
            for task_id, channel, value in source_tuple.pending_writes or []:
                writes_by_task_id.setdefault(task_id, []).append((channel, value))
            for task_id, writes in writes_by_task_id.items():
                await checkpointer.aput_writes(next_config, writes, task_id)

            target_checkpoint_id = str(
                next_config.get("configurable", {}).get("checkpoint_id", "")
            )
            logger.info(
                "replay_fork_completed",
                **lineage,
                target_checkpoint_id=target_checkpoint_id,
                pending_write_count=sum(len(writes) for writes in writes_by_task_id.values()),
            )
            return ForkResult(
                config=next_config,
                source_checkpoint_id=source_checkpoint_id,
                target_checkpoint_id=target_checkpoint_id,
            )
        except BaseException:
            logger.exception("replay_fork_failed", **lineage)
            if created:
                await checkpointer.adelete_thread(target.target_execution_id)
            raise
