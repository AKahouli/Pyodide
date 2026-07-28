"""Wire conditional control edges onto a StateGraph.

Conditional edges are keyed on a router label: the dispatcher reads
router_decisions[node_id] and selects the target.
"""

from __future__ import annotations

from typing import Any

from langgraph.graph import END, StateGraph
from structlog import get_logger

from src.flow_engine.state import ExecutionState

logger = get_logger(__name__)


def add_conditional_edges(
    graph: StateGraph,
    raw_edges: list[dict[str, Any]],
    raw_nodes: list[dict[str, Any]],
    skip_ids: set[str] | None = None,
) -> None:
    skip_ids = skip_ids or set()
    node_ids = {n["id"] for n in raw_nodes if n["id"] not in skip_ids}
    grouped: dict[str, list[dict[str, Any]]] = {}

    for edge in raw_edges:
        if edge.get("kind") != "conditional":
            continue
        source = edge.get("source", "")
        target = edge.get("target", "")
        router_label = edge.get("router_label", "")

        if source in skip_ids or target in skip_ids:
            continue
        if source not in node_ids or target not in node_ids:
            logger.warning("[conditional] Edge references unknown node", source=source, target=target)
            continue
        grouped.setdefault(source, []).append(edge)

    for source, edges in grouped.items():
        if source in skip_ids:
            continue
        label_map: dict[str, str] = {}
        for e in edges:
            label = e.get("router_label", "continue")
            label_map[label] = e.get("target", "")

        router_node = next((node for node in raw_nodes if node.get("id") == source), None)
        declared_labels = (router_node or {}).get("router_config", {}).get("output_labels", [])
        for label in declared_labels:
            label_map.setdefault(label, END)

        def _router_path(state: ExecutionState, _source: str = source) -> str:
            return state.get("router_decisions", {}).get(_source, "continue")

        graph.add_conditional_edges(source, _router_path, label_map)
        logger.info("[conditional] Wired conditional edges", source=source, labels=list(label_map.keys()))
