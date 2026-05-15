"""Guard functions for iteration-counter injection and error routing.

Iteration counter: wraps every node inside a cycle to increment
iterations[node_id] on entry.  The guard checks maxIterations on
the controlling router before the node runs; if exceeded it writes
the terminal label and skips the node body.

Error routing: wraps every node so a failure writes __error__ into
router_decisions for the nearest downstream router.
"""

from __future__ import annotations

from collections import deque
from typing import Any, Callable, Awaitable

from langgraph.graph import StateGraph
from structlog import get_logger

from src.flow_engine.state import ExecutionState

logger = get_logger(__name__)


def inject_iteration_counter(
    graph: StateGraph,
    raw_edges: list[dict[str, Any]],
    raw_nodes: list[dict[str, Any]],
) -> StateGraph:
    node_ids = {n["id"] for n in raw_nodes}
    router_map = {n["id"]: n for n in raw_nodes if n.get("kind") == "router"}
    if not router_map:
        return graph

    cycle_nodes = _find_cycle_nodes(raw_edges, node_ids, router_map)
    if not cycle_nodes:
        return graph

    for node_id in cycle_nodes:
        _wrap_node_with_iteration_tracking(graph, node_id, router_map.get(node_id))

    logger.info("[guards] Injected iteration counters", cycle_nodes=list(cycle_nodes))
    return graph


def _find_cycle_nodes(
    raw_edges: list[dict[str, Any]],
    node_ids: set[str],
    router_map: dict[str, dict[str, Any]],
) -> set[str]:
    adjacency: dict[str, list[str]] = {nid: [] for nid in node_ids}
    for edge in raw_edges:
        src, tgt = edge.get("source", ""), edge.get("target", "")
        if src in adjacency and tgt in node_ids:
            adjacency[src].append(tgt)

    entry_nodes = _find_entrypoints(raw_edges, node_ids)
    visited: set[str] = set()
    on_stack: set[str] = set()
    cycle_nodes: set[str] = set()

    def _dfs(node: str) -> None:
        visited.add(node)
        on_stack.add(node)
        for neighbor in adjacency.get(node, []):
            if neighbor not in visited:
                _dfs(neighbor)
            elif neighbor in on_stack:
                cycle_nodes.add(node)
                cycle_nodes.add(neighbor)
        on_stack.discard(node)

    for entry in sorted(entry_nodes):
        if entry not in visited:
            _dfs(entry)

    result: set[str] = set()
    for nid in cycle_nodes:
        result.add(nid)
        result.update(_nodes_in_same_cycle(nid, adjacency, cycle_nodes))

    result &= {rid for rid in router_map} | _cycle_member_nodes(result, adjacency, router_map)
    return result


def _nodes_in_same_cycle(
    node: str,
    adjacency: dict[str, list[str]],
    cycle_ids: set[str],
) -> set[str]:
    result: set[str] = set()
    for nid, neighbors in adjacency.items():
        if node in neighbors and nid in cycle_ids:
            result.add(nid)
    return result


def _cycle_member_nodes(
    cycle_ids: set[str],
    adjacency: dict[str, list[str]],
    router_map: dict[str, dict[str, Any]],
) -> set[str]:
    member_nodes: set[str] = set()
    for router_id in router_map:
        if router_id not in cycle_ids:
            continue
        visited: set[str] = set()
        queue: deque[str] = deque([router_id])
        while queue:
            current = queue.popleft()
            if current in visited:
                continue
            visited.add(current)
            for neighbor in adjacency.get(current, []):
                if neighbor not in visited and neighbor not in router_map:
                    queue.append(neighbor)
                if neighbor in cycle_ids:
                    member_nodes.add(current)
    return member_nodes


def _find_entrypoints(
    raw_edges: list[dict[str, Any]],
    node_ids: set[str],
) -> set[str]:
    targets = {e["target"] for e in raw_edges if e.get("target") in node_ids}
    return node_ids - targets


def _wrap_node_with_iteration_tracking(
    graph: StateGraph,
    node_id: str,
    router_config: dict[str, Any] | None,
) -> None:
    original_nodes = getattr(graph, "nodes", {})
    if node_id not in original_nodes:
        return

    original_fn = original_nodes[node_id]
    max_iterations = (router_config or {}).get("router_config", {}).get("max_iterations", None)
    output_labels = (router_config or {}).get("router_config", {}).get("output_labels", ["continue"])

    async def _wrapped(state: ExecutionState, _fn=original_fn, _nid=node_id, _max=max_iterations, _labels=output_labels) -> dict[str, Any]:
        iteration = state["iterations"].get(_nid, 0)
        if _max is not None and iteration >= _max:
            logger.info("[guards] Max iterations reached — writing terminal label", node_id=_nid, iteration=iteration, max=_max)
            terminal_label = _labels[-1] if len(_labels) > 1 else _labels[0]
            return {
                "router_decisions": {_nid: terminal_label},
            }
        result = await _fn(state)
        return result

    graph.add_node(node_id, _wrapped)


def inject_error_routing(
    graph: StateGraph,
    raw_edges: list[dict[str, Any]],
    raw_nodes: list[dict[str, Any]],
) -> StateGraph:
    router_map = _nearest_downstream_router(raw_edges, raw_nodes)
    if not router_map:
        logger.info("[guards] No error-routing targets — no routers in graph")
        return graph

    for node_id, router_id in router_map.items():
        _wrap_node_with_error_routing(graph, node_id, router_id)

    logger.info("[guards] Error routing configured", wrapped_nodes=len(router_map))
    return graph


def _nearest_downstream_router(
    raw_edges: list[dict[str, Any]],
    raw_nodes: list[dict[str, Any]],
) -> dict[str, str]:
    node_ids = {n["id"] for n in raw_nodes}
    router_ids = {n["id"] for n in raw_nodes if n.get("kind") == "router"}

    adjacency: dict[str, list[str]] = {nid: [] for nid in node_ids}
    for edge in raw_edges:
        src = edge.get("source", "")
        tgt = edge.get("target", "")
        if src in adjacency and tgt in node_ids:
            adjacency[src].append(tgt)

    result: dict[str, str] = {}

    for node_id in node_ids:
        if node_id in router_ids:
            continue
        nearest = _bfs_find_router(node_id, adjacency, router_ids)
        if nearest:
            result[node_id] = nearest

    return result


def _bfs_find_router(
    start: str,
    adjacency: dict[str, list[str]],
    router_ids: set[str],
) -> str | None:
    visited: set[str] = set()
    queue: deque[str] = deque([start])
    visited.add(start)

    while queue:
        current = queue.popleft()
        if current != start and current in router_ids:
            return current
        for neighbor in adjacency.get(current, []):
            if neighbor not in visited:
                visited.add(neighbor)
                queue.append(neighbor)

    return None


def _wrap_node_with_error_routing(
    graph: StateGraph,
    node_id: str,
    router_id: str,
) -> None:
    original_nodes = getattr(graph, "nodes", {})
    if node_id not in original_nodes:
        logger.warning("[guards] Cannot wrap non-existent node", node_id=node_id)
        return

    original_fn = original_nodes[node_id]

    async def _wrapped(state: ExecutionState, _fn=original_fn, _nid=node_id, _rid=router_id) -> dict[str, Any]:
        try:
            return await _fn(state)
        except Exception as exc:
            iteration = state["iterations"].get(_nid, 0)
            logger.error("[guards] Node failed — routing to __error__", node_id=_nid, router_id=_rid, error=str(exc))
            return {
                "router_decisions": {_rid: "__error__"},
                "errors": [{"node_id": _nid, "iteration": iteration, "message": str(exc), "code": "NODE_FAILED"}],
            }

    graph.add_node(node_id, _wrapped)
