"""Human-approval node implementation.

Interrupts the graph via pending_approval state.  The gRPC servicer
detects the interrupt and sends an ApprovalRequested event.  The
backend calls ResumeApproval to continue.

Uses get_stream_writer() to emit NodeStarted events.
"""

from __future__ import annotations

from typing import Any, Optional

from structlog import get_logger
from langgraph.config import get_stream_writer

from src.flow_engine.state import ExecutionState

logger = get_logger(__name__)


async def run_human_approval(
    node_id: str,
    node_config: dict[str, Any],
    state: ExecutionState,
) -> dict[str, Any]:
    iteration = state["iterations"].get(node_id, 0)
    timeout_seconds = node_config.get("human_approval_config", {}).get("timeout_seconds", 300)
    prompt_template = node_config.get("human_approval_config", {}).get("prompt_template", "Approve?")
    label = str(node_config.get("label") or node_id)

    logger.info("[human_approval] Interrupting for approval", node_id=node_id, iteration=iteration)

    writer = get_stream_writer()
    writer({
        "type": "NodeStarted",
        "node_id": node_id,
        "iteration": iteration,
        "payload": {"label": label},
    })

    pending: Optional[dict[str, Any]] = {
        "node_id": node_id,
        "iteration": iteration,
        "prompt": prompt_template,
        "timeout_at": str(timeout_seconds),
    }
    return {
        "pending_approval": pending,
        "iterations": {node_id: iteration + 1},
    }
