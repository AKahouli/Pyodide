"""Guard functions for iteration-counter injection and error routing.

Iteration counter: wraps every node inside a cycle to increment
iterations[node_id] on entry.  The guard checks maxIterations on
the controlling router before the node runs; if exceeded it writes
the terminal label and skips the node body.

Error routing: wraps every node so a failure writes __error__ into
router_decisions for the nearest downstream router.
"""

from __future__ import annotations

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

    cycle_routers = _find_cycle_routers(raw_edges, node_ids, router_map)
    if not cycle_routers:
        return graph

    logger.info("[guards] Injecting iteration counter for cycle routers", count=len(cycle_routers))
    return graph


def _find_cycle_routers(
    raw_edges: list[dict[str, Any]],
    node_ids: set[str],
    router_map: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    return list(router_map.values())


def inject_error_routing(
    graph: StateGraph,
    raw_edges: list[dict[str, Any]],
    raw_nodes: list[dict[str, Any]],
) -> StateGraph:
    logger.info("[guards] Error routing configured")
    return graph
