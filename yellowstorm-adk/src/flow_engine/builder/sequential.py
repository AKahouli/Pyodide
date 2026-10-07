"""Wire sequential control edges onto a StateGraph.

Sequential edges are unconditional: when source completes, target runs.
"""

from __future__ import annotations

from typing import Any

from langgraph.graph import StateGraph
from structlog import get_logger

logger = get_logger(__name__)


def _edge_key(edge: dict[str, Any]) -> tuple:
    """Identity for mirror suppression: edge id when present, else the port tuple."""
    edge_id = str(edge.get("id") or "")
    if edge_id:
        return ("id", edge_id)
    return (
        "pair",
        edge.get("source", ""),
        edge.get("source_output_port_id", "") or "default",
        edge.get("target", ""),
        edge.get("target_input_port_id", "") or "default",
    )


def suppressed_mirror_edges(
    raw_edges: list[dict[str, Any]],
    data_bindings: list[dict[str, Any]],
) -> set[tuple]:
    """Find sequential edges that are data mirrors, not control.

    The canvas persists every node-output connection twice: as a data binding
    (the intended data path) and as a sequential control edge. When the edge
    exactly matches a binding (source node/port + target node/port, absent
    ports normalized to ``default``) and its target also has a router
    conditional inbound, the mirrored edge would start the target regardless
    of the router decision, so it must not be wired as control. Edges without
    a binding match (e.g. an alternate route A→T, or step→router) remain
    genuine control. Suppression is per edge id, so a genuine control edge
    between the same nodes on different ports still fires.
    """
    if not data_bindings:
        return set()
    binding_pairs = {
        (
            b.get("source_node", "") or "",
            b.get("source_port", "") or "default",
            b.get("target_node", "") or "",
            b.get("target_port", "") or "default",
        )
        for b in data_bindings
        if b.get("source_kind") == "node-output"
    }
    if not binding_pairs:
        return set()
    conditional_targets = {e.get("target") for e in raw_edges if e.get("kind") == "conditional"}
    if not conditional_targets:
        return set()
    adjacency: dict[str, set[str]] = {}
    for edge in raw_edges:
        adjacency.setdefault(edge.get("source", ""), set()).add(edge.get("target", ""))
    conditional_sources: dict[str, set[str]] = {}
    for edge in raw_edges:
        if edge.get("kind") == "conditional":
            conditional_sources.setdefault(edge.get("target", ""), set()).add(edge.get("source", ""))

    def _reachable(start: str, goals: set[str]) -> bool:
        if start in goals:
            return True
        visited = {start}
        pending = [start]
        while pending:
            for nxt in adjacency.get(pending.pop(), ()):
                if nxt in goals:
                    return True
                if nxt not in visited:
                    visited.add(nxt)
                    pending.append(nxt)
        return False

    suppressed: set[tuple[str, str]] = set()
    for edge in raw_edges:
        if edge.get("kind") != "sequential":
            continue
        source, target = edge.get("source", ""), edge.get("target", "")
        if target not in conditional_targets:
            continue
        # Loop-back exception: if a gating router is reachable from the target
        # (e.g. a retry loop r→s2 with s2→r forward), the mirrored edge is the
        # forward entry and stays control; suppressing it would deadlock entry.
        if _reachable(target, conditional_sources.get(target, set())):
            continue
        pair = (
            source,
            edge.get("source_output_port_id", "") or "default",
            target,
            edge.get("target_input_port_id", "") or "default",
        )
        if pair in binding_pairs:
            suppressed.add(_edge_key(edge))
    return suppressed


def add_sequential_edges(
    graph: StateGraph,
    raw_edges: list[dict[str, Any]],
    raw_nodes: list[dict[str, Any]],
    skip_ids: set[str] | None = None,
    suppressed: set[tuple] | None = None,
) -> None:
    skip_ids = skip_ids or set()
    suppressed = suppressed or set()
    node_ids = {n["id"] for n in raw_nodes if n["id"] not in skip_ids}
    edges_by_target: dict[str, list[str]] = {}
    seen_edges: set[tuple[str, str]] = set()

    for edge in raw_edges:
        if edge.get("kind") != "sequential":
            continue
        source = edge.get("source", "")
        target = edge.get("target", "")
        if _edge_key(edge) in suppressed:
            continue
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
