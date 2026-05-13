"""Wire sequential control edges onto a StateGraph.

Sequential edges are unconditional: when source completes, target runs.
"""

from __future__ import annotations

from typing import Any

from langgraph.graph import StateGraph
from structlog import get_logger

logger = get_logger(__name__)


def add_sequential_edges(
    graph: StateGraph,
    raw_edges: list[dict[str, Any]],
    raw_nodes: list[dict[str, Any]],
) -> None:
    node_ids = {n["id"] for n in raw_nodes}
    added = 0

    for edge in raw_edges:
        if edge.get("kind") != "sequential":
            continue
        source = edge.get("source", "")
        target = edge.get("target", "")
        if source not in node_ids or target not in node_ids:
            logger.warning("[sequential] Edge references unknown node", source=source, target=target)
            continue
        graph.add_edge(source, target)
        added += 1

    logger.info("[sequential] Added sequential edges", count=added)
