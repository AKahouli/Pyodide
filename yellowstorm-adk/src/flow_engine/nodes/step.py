"""Step node implementation.

A step node executes a single task (LLM call + tool invocations).
Output is stored into task_outputs[(node_id, iteration)].
"""

from __future__ import annotations

from typing import Any

from structlog import get_logger

from src.flow_engine.state import ExecutionState

logger = get_logger(__name__)


async def run_step(
    node_id: str,
    node_config: dict[str, Any],
    state: ExecutionState,
) -> dict[str, Any]:
    iteration = state["iterations"].get(node_id, 0)
    logger.info("[step] Running step node", node_id=node_id, iteration=iteration)

    resolved_input = state.get("inputs", {})
    result_payload = {
        "node_id": node_id,
        "iteration": iteration,
        "output": resolved_input,
    }
    return {
        "task_outputs": {(node_id, iteration): result_payload},
        "iterations": {node_id: iteration + 1},
    }
