"""Human-approval node implementation.

Uses LangGraph's ``interrupt()`` as the sole suspension primitive until a
human provides a decision.

The backend detects the interrupt (via the ``pending_approval`` field
in the checkpoint / stream event) and exposes the approval prompt to
the user.  When the frontend calls ``ResumeApproval``, the backend
resumes the graph with ``Command(resume={'decision': 'approved', ...})``
and ``interrupt()`` returns that value.  The node then writes the
decision into state so downstream routers can route on it.

"""

from __future__ import annotations

from typing import Any, Optional

from langgraph.types import interrupt
from structlog import get_logger
from langgraph.config import get_stream_writer

from src.flow_engine.state import ExecutionState

logger = get_logger(__name__)

APPROVAL_DECISIONS = {"approved", "rejected"}


def normalize_approval_resume(value: Any) -> dict[str, Any]:
    """Return the canonical approval value stored in runtime state."""
    if isinstance(value, str):
        decision = value
        payload: dict[str, Any] = {}
    elif isinstance(value, dict):
        decision = value.get("decision")
        raw_payload = value.get("payload", {})
        payload = raw_payload if isinstance(raw_payload, dict) else {}
    else:
        raise ValueError("Approval resume must be an approval decision")

    aliases = {"approve": "approved", "reject": "rejected"}
    normalized = aliases.get(str(decision).strip().lower(), str(decision).strip().lower())
    if normalized not in APPROVAL_DECISIONS:
        raise ValueError("Approval decision must be approved or rejected")
    return {"decision": normalized, "payload": payload}


async def run_human_approval(
    node_id: str,
    node_config: dict[str, Any],
    state: ExecutionState,
    node_inputs: dict[str, Any] | None = None,
) -> dict[str, Any]:
    iteration = state["iterations"].get(node_id, 0)
    timeout_seconds = node_config.get("human_approval_config", {}).get("timeout_seconds", 0)
    prompt_template = node_config.get("human_approval_config", {}).get("prompt_template", "Approve?")
    label = str(node_config.get("label") or node_id)

    logger.info("[human_approval] Requesting approval", node_id=node_id, iteration=iteration)

    try:
        writer = get_stream_writer()
    except RuntimeError:
        writer = lambda _: None
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

    decision = normalize_approval_resume(interrupt(pending))

    logger.info("[human_approval] Received decision", node_id=node_id, decision=decision)

    writer({
        "type": "ApprovalResolved",
        "node_id": node_id,
        "iteration": iteration,
        "payload": decision,
    })

    return {
        "pending_approval": None,
        "task_outputs": {(node_id, iteration): decision},
        "iterations": {node_id: iteration + 1},
    }
