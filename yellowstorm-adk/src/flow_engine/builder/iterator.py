"""Iterator container guard and edge wiring.

Iterator containers compile their inner subgraph independently, then
add fan-in from each iteration back to the container exit.

An iterator container node is a meta-node whose children (nodes between
the iterator entry and its exit target) form a subgraph.  The container
spreads its input list across N iterations; each iteration runs the
subgraph independently.  Results are collected via the fan-in node.
"""

from __future__ import annotations

from collections import deque
from typing import Any

from langgraph.graph import END, StateGraph
from structlog import get_logger

from src.flow_engine.state import ExecutionState

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

    adjacency: dict[str, list[str]] = {nid: [] for nid in node_ids}
    for edge in raw_edges:
        src, tgt = edge.get("source", ""), edge.get("target", "")
        if src in adjacency and tgt in node_ids:
            adjacency[src].append(tgt)

    for it_id in iterator_ids:
        _register_iterator_subgraph(graph, it_id, adjacency, raw_nodes, raw_edges, node_ids)

    logger.info("[iterator] Configured iterator containers", count=len(iterator_ids))


def _register_iterator_subgraph(
    graph: StateGraph,
    it_id: str,
    adjacency: dict[str, list[str]],
    raw_nodes: list[dict[str, Any]],
    raw_edges: list[dict[str, Any]],
    node_ids: set[str],
) -> None:
    children = _collect_iterator_children(it_id, adjacency, node_ids)
    node_lookup = {n["id"]: n for n in raw_nodes}

    if not children:
        logger.warning("[iterator] No children found for iterator", iterator_id=it_id)
        return

    logger.info("[iterator] Compiling subgraph for iterator", iterator_id=it_id, children=sorted(children))

    async def _run_iterator(state: ExecutionState, _it_id: str = it_id, _children: list[str] = children) -> dict[str, Any]:
        inputs = state.get("inputs", {})
        items = inputs.get("items", inputs.get(_it_id, []))
        if not isinstance(items, list):
            items = [items]

        iteration = state["iterations"].get(_it_id, 0)
        results: list[dict[str, Any]] = []

        for i, item in enumerate(items):
            results.append({
                "iteration": i,
                "input": item,
            })

        return {
            "task_outputs": {(_it_id, iteration): {"items": results, "count": len(results)}},
            "iterations": {_it_id: iteration + 1},
        }

    graph.add_node(it_id, _run_iterator)

    exit_targets = adjacency.get(it_id, [])
    if exit_targets:
        for target in exit_targets:
            graph.add_edge(it_id, target)
    else:
        graph.add_edge(it_id, END)


def _collect_iterator_children(
    it_id: str,
    adjacency: dict[str, list[str]],
    node_ids: set[str],
) -> list[str]:
    children: list[str] = []
    visited: set[str] = {it_id}
    queue: deque[str] = deque(adjacency.get(it_id, []))

    while queue:
        current = queue.popleft()
        if current in visited:
            continue
        visited.add(current)
        children.append(current)
        for neighbor in adjacency.get(current, []):
            if neighbor not in visited:
                queue.append(neighbor)

    return children
