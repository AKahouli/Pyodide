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
    skip_ids: set[str] | None = None,
) -> None:
    skip_ids = skip_ids or set()
    node_ids = {n["id"] for n in raw_nodes if n["id"] not in skip_ids}
    edges_by_target: dict[str, list[str]] = {}
    seen_edges: set[tuple[str, str]] = set()

    for edge in raw_edges:
        if edge.get("kind") != "sequential":
            continue
        source = edge.get("source", "")
        target = edge.get("target", "")
        if source in skip_ids or target in skip_ids:
            continue
        if source not in node_ids or target not in node_ids:
            logger.warning("[sequential] Edge references unknown node", source=source, target=target)
            continue
        edge_key = (source, target)
        if edge_key in seen_edges:
            continue
        seen_edges.add(edge_key)
        edges_by_target.setdefault(target, []).append(source)

    added = 0
    fan_in_count = 0
    for target, sources in edges_by_target.items():
        if len(sources) == 1:
            graph.add_edge(sources[0], target)
        else:
            graph.add_edge(sources, target)
            fan_in_count += 1
        added += len(sources)

    logger.info("[sequential] Added sequential edges", count=added, fan_in_count=fan_in_count)
