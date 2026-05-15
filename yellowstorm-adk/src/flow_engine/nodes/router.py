"""Router node implementation.

A router is a step node whose output is constrained to one of its
declared output labels.  The label is written into router_decisions[nodeId].
Max-iterations enforcement is handled by guards before the router runs.

Uses get_stream_writer() to emit NodeStarted and RouterDecision events.
"""

from __future__ import annotations

from typing import Any

from structlog import get_logger
from langgraph.config import get_stream_writer

from src.flow_engine.state import ExecutionState

logger = get_logger(__name__)


async def run_router(
    node_id: str,
    node_config: dict[str, Any],
    state: ExecutionState,
) -> dict[str, Any]:
    iteration = state["iterations"].get(node_id, 0)
    output_labels = node_config.get("router_config", {}).get("output_labels", ["continue"])
    logger.info("[router] Running router node", node_id=node_id, iteration=iteration)

    writer = get_stream_writer()
    label = str(node_config.get("label") or node_id)
    writer({
        "type": "NodeStarted",
        "node_id": node_id,
        "iteration": iteration,
        "payload": {"label": label},
    })

    chosen_label = output_labels[0] if output_labels else "continue"
    return {
        "router_decisions": {node_id: chosen_label},
        "iterations": {node_id: iteration + 1},
    }
