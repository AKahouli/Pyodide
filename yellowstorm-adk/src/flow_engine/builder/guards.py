"""Guard functions for iteration-counter injection and error routing.

Every function that wraps a node takes an ``(fn, node_id, ...)`` and
returns a new coroutine function.  The builder in ``__init__.py`` calls
these during initial node registration so no post-hoc graph mutation
is needed.

Iteration counter: wraps nodes inside a cycle to:
  1. Check ``iterations[node_id] >= max_iterations`` before running.
     If exceeded, write the terminal router label and skip the node body.
  2. Increment ``iterations[node_id]`` on successful completion.

Error routing: wraps every non-router node that has a downstream router
so that a failure writes ``__error__`` into the nearest router's
``router_decisions``.
"""

from __future__ import annotations

from collections import deque
from typing import Any, Callable, Awaitable

from structlog import get_logger

from src.flow_engine.state import ExecutionState

logger = get_logger(__name__)


def build_nearest_router_map(
    raw_edges: list[dict[str, Any]],
    raw_nodes: list[dict[str, Any]],
) -> dict[str, str]:
    """Return ``{node_id: nearest_downstream_router_id}`` for every non-router node."""
    node_ids = {n["id"] for n in raw_nodes}
    router_ids = {n["id"] for n in raw_nodes if n.get("kind") == "router"}

    adjacency: dict[str, list[str]] = {nid: [] for nid in node_ids}
    for edge in raw_edges:
        src, tgt = edge.get("source", ""), edge.get("target", "")
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


def build_cycle_node_set(
    raw_edges: list[dict[str, Any]],
    raw_nodes: list[dict[str, Any]],
) -> set[str]:
    """Return the set of node ids that participate in a router-controlled cycle."""
    node_ids = {n["id"] for n in raw_nodes}
    router_ids = {n["id"] for n in raw_nodes if n.get("kind") == "router"}
    if not router_ids:
        return set()

    adjacency: dict[str, list[str]] = {nid: [] for nid in node_ids}
    for edge in raw_edges:
        src, tgt = edge.get("source", ""), edge.get("target", "")
        if src in adjacency and tgt in node_ids:
            adjacency[src].append(tgt)

    entry_nodes = _entrypoints(raw_edges, node_ids)
    visited: set[str] = set()
    on_stack: set[str] = set()
    cycle_seeds: set[str] = set()

    def _dfs(node: str) -> None:
        visited.add(node)
        on_stack.add(node)
        for neighbor in adjacency.get(node, []):
            if neighbor not in visited:
                _dfs(neighbor)
            elif neighbor in on_stack:
                cycle_seeds.add(node)
                cycle_seeds.add(neighbor)
        on_stack.discard(node)

    for entry in sorted(entry_nodes):
        if entry not in visited:
            _dfs(entry)

    result: set[str] = set(cycle_seeds)

    for router_id in router_ids:
        if router_id not in cycle_seeds:
            continue
        queue: deque[str] = deque([router_id])
        bfs_visited: set[str] = {router_id}
        while queue:
            current = queue.popleft()
            if current in router_ids and current != router_id:
                continue
            result.add(current)
            for neighbor in adjacency.get(current, []):
                if neighbor not in bfs_visited:
                    bfs_visited.add(neighbor)
                    queue.append(neighbor)

    return result


def wrap_node_for_iteration(
    fn: Callable[..., Awaitable[dict[str, Any]]],
    node_id: str,
    router_config: dict[str, Any] | None,
) -> Callable[..., Awaitable[dict[str, Any]]]:
    max_iterations = None
    output_labels: list[str] = ["continue"]
    if router_config:
        rc = router_config.get("router_config", {})
        max_iterations = rc.get("max_iterations")
        output_labels = rc.get("output_labels", ["continue"])

    async def _wrapped(state: ExecutionState, _fn=fn, _nid=node_id, _max=max_iterations, _labels=output_labels) -> dict[str, Any]:
        iteration = state["iterations"].get(_nid, 0)
        if _max is not None and iteration >= _max:
            terminal_label = _labels[-1] if len(_labels) > 1 else _labels[0]
            logger.info("[guards] Max iterations reached — writing terminal label", node_id=_nid, iteration=iteration, max=_max, terminal=terminal_label)
            return {"router_decisions": {_nid: terminal_label}}
        return await _fn(state)

    return _wrapped


def wrap_node_for_error_routing(
    fn: Callable[..., Awaitable[dict[str, Any]]],
    node_id: str,
    router_id: str,
) -> Callable[..., Awaitable[dict[str, Any]]]:
    async def _wrapped(state: ExecutionState, _fn=fn, _nid=node_id, _rid=router_id) -> dict[str, Any]:
        try:
            return await _fn(state)
        except Exception as exc:
            iteration = state["iterations"].get(_nid, 0)
            logger.error("[guards] Node failed — routing to __error__", node_id=_nid, router_id=_rid, error=str(exc))
            return {
                "router_decisions": {_rid: "__error__"},
                "errors": [{"node_id": _nid, "iteration": iteration, "message": str(exc), "code": "NODE_FAILED"}],
            }

    return _wrapped


def _bfs_find_router(
    start: str,
    adjacency: dict[str, list[str]],
    router_ids: set[str],
) -> str | None:
    visited: set[str] = {start}
    queue: deque[str] = deque([start])

    while queue:
        current = queue.popleft()
        if current != start and current in router_ids:
            return current
        for neighbor in adjacency.get(current, []):
            if neighbor not in visited:
                visited.add(neighbor)
                queue.append(neighbor)

    return None


def _entrypoints(
    raw_edges: list[dict[str, Any]],
    node_ids: set[str],
) -> set[str]:
    targets = {e["target"] for e in raw_edges if e.get("target") in node_ids}
    return node_ids - targets
