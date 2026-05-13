"""Graph builder — composes a FlowSnapshot into a CompiledStateGraph.

Entry point: ``compose(snapshot, checkpointer)``.
Each topology file owns its wiring; the builder orchestrates in order.
"""

from __future__ import annotations

from typing import Any, Optional

from langgraph.graph import START, StateGraph
from structlog import get_logger

from src.flow_engine.builder.sequential import add_sequential_edges
from src.flow_engine.builder.conditional import add_conditional_edges
from src.flow_engine.builder.guards import inject_iteration_counter, inject_error_routing
from src.flow_engine.builder.human_approval import configure_human_approval
from src.flow_engine.nodes.step import run_step
from src.flow_engine.nodes.router import run_router
from src.flow_engine.nodes.human_approval import run_human_approval
from src.flow_engine.state import ExecutionState

logger = get_logger(__name__)

NODE_KIND_DISPATCH = {
    "step": run_step,
    "router": run_router,
    "human_approval": run_human_approval,
}


def compose(
    snapshot: dict[str, Any],
    checkpointer: Any = None,
) -> StateGraph:
    raw_nodes = snapshot.get("nodes", [])
    raw_edges = snapshot.get("control_edges", [])
    settings = snapshot.get("settings", {})

    graph = StateGraph(ExecutionState)

    _register_nodes(graph, raw_nodes)
    _add_start_edges(graph, raw_edges, raw_nodes)
    add_sequential_edges(graph, raw_edges, raw_nodes)
    add_conditional_edges(graph, raw_edges, raw_nodes)

    graph = inject_iteration_counter(graph, raw_edges, raw_nodes)
    graph = inject_error_routing(graph, raw_edges, raw_nodes)
    graph = configure_human_approval(graph, raw_nodes)

    recursion_limit = settings.get("recursion_limit", 25)
    compiled = graph.compile(
        checkpointer=checkpointer,
        interrupt_before=_collect_interrupt_before(raw_nodes),
        interrupt_after=[],
    )
    return compiled


def _register_nodes(graph: StateGraph, raw_nodes: list[dict[str, Any]]) -> None:
    for node in raw_nodes:
        node_id = node.get("id", "")
        kind = node.get("kind", "step")
        fn = NODE_KIND_DISPATCH.get(kind, run_step)

        async def _wrapped(state: ExecutionState, _node_id: str = node_id, _node: dict[str, Any] = node, _fn=fn) -> dict[str, Any]:
            return await _fn(_node_id, _node, state)

        graph.add_node(node_id, _wrapped)


def _add_start_edges(graph: StateGraph, raw_edges: list[dict[str, Any]], raw_nodes: list[dict[str, Any]]) -> None:
    node_ids = {n["id"] for n in raw_nodes}
    if not node_ids:
        return

    targets = {e["target"] for e in raw_edges if e.get("target") in node_ids}
    entrypoints = node_ids - targets
    for ep in sorted(entrypoints):
        graph.add_edge(START, ep)
    if entrypoints:
        logger.info("[builder] Added START edges to entrypoints", count=len(entrypoints))


def _collect_interrupt_before(raw_nodes: list[dict[str, Any]]) -> list[str]:
    return [n["id"] for n in raw_nodes if n.get("kind") == "human_approval"]
