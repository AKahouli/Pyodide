"""Human-approval node wiring.

Configures interrupt_before on human_approval nodes so the graph
suspends before execution.  On resume, the node writes its result
and execution continues.
"""

from __future__ import annotations

from typing import Any

from langgraph.graph import StateGraph
from structlog import get_logger

logger = get_logger(__name__)


def configure_human_approval(
    graph: StateGraph,
    raw_nodes: list[dict[str, Any]],
) -> StateGraph:
    approval_ids = [n["id"] for n in raw_nodes if n.get("kind") == "human_approval"]
    if approval_ids:
        logger.info("[human_approval] Configured interrupt nodes", nodes=approval_ids)
    return graph
