"""Iterator container guard and edge wiring.

Iterator containers compile their inner subgraph independently, then
add fan-in from each iteration back to the container exit.
Phase 2 implements the guard skeleton; full iterator execution is gated
behind a stub that always returns the terminal path.
"""

from __future__ import annotations

from typing import Any

from langgraph.graph import StateGraph
from structlog import get_logger

logger = get_logger(__name__)


def is_iterator_container(node: dict[str, Any]) -> bool:
    return node.get("kind") == "iterator"


def add_iterator_edges(
    graph: StateGraph,
    raw_edges: list[dict[str, Any]],
    raw_nodes: list[dict[str, Any]],
) -> None:
    node_ids = {n["id"] for n in raw_nodes}
    iterator_ids = {n["id"] for n in raw_nodes if is_iterator_container(n)}
    if not iterator_ids:
        return

    logger.info("[iterator] Detected iterator containers", count=len(iterator_ids))
