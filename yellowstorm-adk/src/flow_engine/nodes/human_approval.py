"""Human-approval node implementation.

Uses LangGraph's ``interrupt()`` to suspend the graph until a human
provides a decision.  The node writes ``pending_approval`` into state,
emits an ``ApprovalRequested`` event, then calls ``interrupt()`` which
pauses execution and checkpointed the state.

The backend detects the interrupt (via the ``pending_approval`` field
in the checkpoint / stream event) and exposes the approval prompt to
the user.  When the frontend calls ``ResumeApproval``, the backend
resumes the graph with ``Command(resume={'decision': 'approved', ...})``
and ``interrupt()`` returns that value.  The node then writes the
decision into state so downstream routers can route on it.

The ``interrupt_after`` compile option ensures the graph suspends
immediately after this node writes its state.
"""

from __future__ import annotations

from typing import Any, Optional

from langgraph.types import interrupt
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

    logger.info("[human_approval] Requesting approval", node_id=node_id, iteration=iteration)

    writer = get_stream_writer()
    writer({
        "type": "NodeStarted",
        "node_id": node_id,
        "iteration": iteration,
        "payload": {"label": label},
    })

    pending: dict[str, Any] = {
        "node_id": node_id,
        "iteration": iteration,
        "prompt": prompt_template,
        "timeout_at": str(timeout_seconds),
    }

    writer({
        "type": "ApprovalRequested",
        "node_id": node_id,
        "iteration": iteration,
        "payload": pending,
    })

    decision = interrupt(pending)

    logger.info("[human_approval] Received decision", node_id=node_id, decision=decision)

    writer({
        "type": "ApprovalResolved",
        "node_id": node_id,
        "iteration": iteration,
        "payload": {"decision": decision},
    })

    return {
        "pending_approval": {"node_id": node_id, "iteration": iteration, "prompt": prompt_template, "decision": decision, "timeout_at": str(timeout_seconds)},
        "iterations": {node_id: iteration + 1},
    }
