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
from src.flow_engine.builder.iterator import add_iterator_edges, compute_iterator_children
from src.flow_engine.builder.guards import build_nearest_router_map, build_cycle_node_set, wrap_node_for_iteration, wrap_node_for_error_routing
from src.flow_engine.bindings.resolver import resolve_node_inputs
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


def _build_adjacency(
    raw_edges: list[dict[str, Any]],
    node_ids: set[str],
) -> dict[str, list[str]]:
    adjacency: dict[str, list[str]] = {nid: [] for nid in node_ids}
    for edge in raw_edges:
        src, tgt = edge.get("source", ""), edge.get("target", "")
        if src in adjacency and tgt in node_ids:
            adjacency[src].append(tgt)
    return adjacency


def compose(
    snapshot: dict[str, Any],
    checkpointer: Any = None,
) -> StateGraph:
    raw_nodes = snapshot.get("nodes", [])
    raw_edges = snapshot.get("control_edges", [])
    data_bindings = snapshot.get("data_bindings", [])

    graph = StateGraph(ExecutionState)

    node_ids = {n["id"] for n in raw_nodes}
    adjacency = _build_adjacency(raw_edges, node_ids)
    iterator_ids = {n["id"] for n in raw_nodes if n.get("kind") == "iterator"}

    # Compute children for each iterator — these are removed from main graph
    # and compiled into per-iterator body subgraphs.
    iterator_children: set[str] = set()
    iterator_exit_targets: dict[str, list[str]] = {}
    for it_id in iterator_ids:
        children, exits = compute_iterator_children(it_id, adjacency, node_ids, raw_nodes=raw_nodes)
        iterator_children.update(children)
        iterator_exit_targets[it_id] = exits

    nearest_routers = build_nearest_router_map(raw_edges, raw_nodes)
    cycle_nodes = build_cycle_node_set(raw_edges, raw_nodes)
    router_configs = {n["id"]: n for n in raw_nodes if n.get("kind") == "router"}

    # Skip both iterator children (body subgraph) and iterator nodes (registered in add_iterator_edges)
    all_skip = iterator_children | iterator_ids

    _register_nodes(graph, raw_nodes, data_bindings, nearest_routers, cycle_nodes, router_configs, skip_ids=all_skip)

    # Collect all known exit targets so _add_start_edges doesn't treat them as entrypoints
    all_exit_targets: set[str] = set()
    for exits in iterator_exit_targets.values():
        all_exit_targets.update(exits)

    _add_start_edges(graph, raw_edges, raw_nodes, skip_ids=iterator_children, known_targets=all_exit_targets)
    add_sequential_edges(graph, raw_edges, raw_nodes, skip_ids=iterator_children)
    add_conditional_edges(graph, raw_edges, raw_nodes, skip_ids=iterator_children)

    add_iterator_edges(
        graph,
        raw_edges,
        raw_nodes,
        data_bindings=data_bindings,
        nearest_routers=nearest_routers,
        cycle_nodes=cycle_nodes,
        router_configs=router_configs,
        exit_targets=iterator_exit_targets,
    )
    graph = configure_human_approval(graph, raw_nodes)

    compiled = graph.compile(
        checkpointer=checkpointer,
        interrupt_before=[],
        interrupt_after=_collect_interrupt_after(raw_nodes),
    )
    return compiled


def _register_nodes(
    graph: StateGraph,
    raw_nodes: list[dict[str, Any]],
    data_bindings: list[dict[str, Any]],
    nearest_routers: dict[str, str],
    cycle_nodes: set[str],
    router_configs: dict[str, dict[str, Any]],
    skip_ids: set[str] | None = None,
) -> None:
    skip_ids = skip_ids or set()
    for node in raw_nodes:
        node_id = node.get("id", "")
        if node_id in skip_ids:
            continue
        kind = node.get("kind", "step")
        fn = NODE_KIND_DISPATCH.get(kind, run_step)

        async def _base(state: ExecutionState, config=None, *, _node_id: str = node_id, _node: dict[str, Any] = node, _fn=fn) -> dict[str, Any]:
            node_inputs = resolve_node_inputs(_node_id, data_bindings, state)
            return await _fn(_node_id, _node, state, node_inputs=node_inputs)

        wrapped = _base

        error_router = nearest_routers.get(node_id)
        if error_router is not None:
            wrapped = wrap_node_for_error_routing(wrapped, node_id, error_router)

        if node_id in cycle_nodes:
            router_cfg = router_configs.get(node_id)
            wrapped = wrap_node_for_iteration(wrapped, node_id, router_cfg)

        graph.add_node(node_id, wrapped)


def _add_start_edges(
    graph: StateGraph,
    raw_edges: list[dict[str, Any]],
    raw_nodes: list[dict[str, Any]],
    skip_ids: set[str] | None = None,
    known_targets: set[str] | None = None,
) -> None:
    skip_ids = skip_ids or set()
    known_targets = known_targets or set()
    node_ids = {n["id"] for n in raw_nodes if n["id"] not in skip_ids}
    if not node_ids:
        return

    targets = {e["target"] for e in raw_edges if e.get("target") in node_ids and e.get("source", "") not in skip_ids}
    targets.update(known_targets)
    entrypoints = node_ids - targets
    for ep in sorted(entrypoints):
        graph.add_edge(START, ep)
    if entrypoints:
        logger.info("[builder] Added START edges to entrypoints", count=len(entrypoints))


def _collect_interrupt_after(raw_nodes: list[dict[str, Any]]) -> list[str]:
    return [
        str(node["id"])
        for node in raw_nodes
        if node.get("kind") == "human_approval" and node.get("id")
    ]
