"""Iterator container — compiles children into a body subgraph.

An iterator container node is a meta-node whose direct downstream nodes
(children) form a body subgraph.  The container resolves a collection
list from ``IteratorConfig.collection_path`` in state, then runs the
body subgraph once per item.  Results are aggregated into
``IteratorIterationResult`` entries and stored as the iterator's output.

Children are removed from the main graph by the builder; the iterator
node replaces them.  Exit targets (nodes reachable from children) are
wired directly from the iterator in the main graph.
"""

from __future__ import annotations

import json
from collections import deque
from typing import Any, Callable, Coroutine

from langgraph.config import get_stream_writer
from langgraph.graph import END, START, StateGraph
from structlog import get_logger

from src.flow_engine.bindings.resolver import resolve_node_inputs
from src.flow_engine.builder.conditional import add_conditional_edges
from src.flow_engine.builder.guards import wrap_node_for_error_routing, wrap_node_for_iteration
from src.flow_engine.nodes.step import run_step
from src.flow_engine.nodes.router import run_router
from src.flow_engine.nodes.human_approval import run_human_approval
from src.flow_engine.state import ExecutionState

logger = get_logger(__name__)

NODE_KIND_DISPATCH: dict[str, Callable[..., Coroutine[Any, Any, dict[str, Any]]]] = {
    "step": run_step,
    "router": run_router,
    "human_approval": run_human_approval,
}


def is_iterator_container(node: dict[str, Any]) -> bool:
    return node.get("kind") == "iterator"


def _get_parent_iterator_id(node: dict[str, Any]) -> str:
    metadata = node.get("metadata")
    if not isinstance(metadata, dict):
        return ""
    container_config = metadata.get("containerConfig") or metadata.get("container_config")
    if not isinstance(container_config, dict):
        return ""
    parent_id = container_config.get("parentIteratorId") or container_config.get("parent_iterator_id")
    return str(parent_id).strip() if parent_id else ""


def _build_parent_map(raw_nodes: list[dict[str, Any]]) -> dict[str, str]:
    result: dict[str, str] = {}
    for node in raw_nodes:
        parent_id = _get_parent_iterator_id(node)
        if parent_id:
            result[node["id"]] = parent_id
    return result


def compute_iterator_children(
    it_id: str,
    adjacency: dict[str, list[str]],
    node_ids: set[str],
    raw_nodes: list[dict[str, Any]] | None = None,
) -> tuple[list[str], list[str]]:
    """Return ``(children, exit_targets)`` for an iterator node.

    Body nodes are identified via ``metadata.containerConfig.parentIteratorId``
    when available (the canonical source from the frontend).  When no node
    declares a parent iterator ID, falls back to BFS reachability.

    For a linear chain ``iter -> A -> B -> X`` where A and B have
    ``parentIteratorId == iter``, the body is ``[A, B]`` and the exit
    target is ``[X]``.  The body subgraph runs per iteration; the main
    graph wires ``iter -> X`` directly.
    """
    parent_map: dict[str, str] = {}
    if raw_nodes is not None:
        parent_map = _build_parent_map(raw_nodes)

    if parent_map:
        children = sorted(nid for nid, pid in parent_map.items() if pid == it_id)
        child_set = set(children)
        exit_targets: list[str] = []
        for child_id in children:
            for downstream in adjacency.get(child_id, []):
                if downstream not in child_set and downstream in node_ids and downstream != it_id:
                    if downstream not in exit_targets:
                        exit_targets.append(downstream)
        return children, exit_targets

    direct_targets = adjacency.get(it_id, [])

    all_reachable: list[str] = []
    visited: set[str] = {it_id}
    queue: deque[str] = deque(direct_targets)
    while queue:
        current = queue.popleft()
        if current in visited or current not in node_ids:
            continue
        visited.add(current)
        all_reachable.append(current)
        for neighbor in adjacency.get(current, []):
            if neighbor not in visited:
                queue.append(neighbor)

    reachable_set = set(all_reachable)

    exit_targets = []
    for node in all_reachable:
        downstream = adjacency.get(node, [])
        exits_downstream = [d for d in downstream if d not in reachable_set]
        if exits_downstream:
            for d in exits_downstream:
                if d not in exit_targets and d in node_ids:
                    exit_targets.append(d)

    for t in direct_targets:
        if t in node_ids and not adjacency.get(t, []):
            if t not in exit_targets:
                exit_targets.append(t)
            if t in all_reachable:
                all_reachable.remove(t)

    exit_set = set(exit_targets)
    children = [c for c in all_reachable if c not in exit_set]

    return children, exit_targets


def _build_body_subgraph(
    children: list[str],
    raw_nodes: list[dict[str, Any]],
    raw_edges: list[dict[str, Any]],
    data_bindings: list[dict[str, Any]],
    nearest_routers: dict[str, str],
    cycle_nodes: set[str],
    router_configs: dict[str, dict[str, Any]],
) -> Any:
    node_lookup = {n["id"]: n for n in raw_nodes}
    child_set = set(children)

    subgraph = StateGraph(ExecutionState)

    for child_id in children:
        child_node = node_lookup[child_id]
        kind = child_node.get("kind", "step")
        fn = NODE_KIND_DISPATCH.get(kind, run_step)

        async def _base(
            state: ExecutionState,
            config=None,
            *,
            _node_id: str = child_id,
            _node: dict[str, Any] = child_node,
            _fn: Callable[..., Coroutine[Any, Any, dict[str, Any]]] = fn,
        ) -> dict[str, Any]:
            node_inputs = {
                **state.get("inputs", {}),
                **resolve_node_inputs(_node_id, data_bindings, state),
            }
            return await _fn(_node_id, _node, state, node_inputs=node_inputs)

        wrapped: Callable[..., Coroutine[Any, Any, dict[str, Any]]] = _base

        error_router = nearest_routers.get(child_id)
        if error_router is not None:
            wrapped = wrap_node_for_error_routing(wrapped, child_id, error_router)

        if child_id in cycle_nodes:
            router_cfg = router_configs.get(child_id)
            wrapped = wrap_node_for_iteration(wrapped, child_id, router_cfg)

        subgraph.add_node(child_id, wrapped)

    # Edges among children
    child_edges = [
        e for e in raw_edges
        if e.get("source") in child_set and e.get("target") in child_set
    ]

    incoming_from_children = {e["target"] for e in child_edges}
    entry_ids = [c for c in children if c not in incoming_from_children]
    exit_ids = [c for c in children if c not in {e["source"] for e in child_edges}]

    for edge in child_edges:
        if edge.get("kind") != "conditional":
            subgraph.add_edge(edge["source"], edge["target"])
    add_conditional_edges(
        subgraph,
        child_edges,
        [node_lookup[child_id] for child_id in children],
    )

    if len(entry_ids) == 1:
        subgraph.add_edge(START, entry_ids[0])
    else:
        for eid in entry_ids:
            subgraph.add_edge(START, eid)

    if len(exit_ids) == 1:
        subgraph.add_edge(exit_ids[0], END)
    else:
        for eid in exit_ids:
            subgraph.add_edge(eid, END)

    compiled = subgraph.compile()
    logger.info(
        "[iterator] Built body subgraph",
        children=len(children),
        edges=len(child_edges),
        entry_ids=entry_ids,
        exit_ids=exit_ids,
    )
    return compiled


def _child_event_payload(child_result: dict[str, Any], index: int) -> dict[str, Any]:
    """Build the streaming payload for one child result of an iteration turn.

    Keys with empty/None values are omitted — google.protobuf.Struct rejects None.
    """
    payload: dict[str, Any] = {
        "iterationIndex": index,
        "taskId": str(child_result.get("taskId") or ""),
        "taskTitle": str(child_result.get("taskTitle") or ""),
        "status": str(child_result.get("status") or "completed"),
    }
    output = child_result.get("output")
    error = child_result.get("error")
    if output:
        payload["output"] = str(output)
    if error:
        payload["error"] = str(error)
    if child_result.get("components"):
        payload["components"] = child_result["components"]
    if child_result.get("artifacts"):
        payload["artifacts"] = child_result["artifacts"]
    return payload


def _coerce_to_list(value: Any) -> list[Any]:
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except (TypeError, ValueError):
            return []
        if isinstance(parsed, list):
            return parsed
        if isinstance(parsed, dict):
            return _coerce_to_list(parsed)
        return [parsed] if parsed is not None else []
    if isinstance(value, dict):
        for v in value.values():
            if isinstance(v, list):
                return v
        return [value]
    if value is not None:
        return [value]
    return []


def _resolve_items(
    state: ExecutionState,
    collection_path: str,
    max_items: int,
) -> list[Any]:
    if not collection_path:
        return []

    parts = collection_path.strip().split(".")
    current: Any = state
    for part in parts:
        if isinstance(current, dict):
            current = current.get(part)
        else:
            return []

    items = _coerce_to_list(current)
    if max_items > 0 and len(items) > max_items:
        items = items[:max_items]
    return items


def _resolve_items_from_bindings(
    node_id: str,
    data_bindings: list[dict[str, Any]],
    state: ExecutionState,
    max_items: int,
    raw_edges: list[dict[str, Any]] | None = None,
) -> list[Any]:
    all_bindings = list(data_bindings)
    if raw_edges:
        existing = {
            (b.get("source_node", ""), b.get("source_port", ""), b.get("target_node", ""), b.get("target_port", ""))
            for b in all_bindings
            if b.get("source_kind") == "node-output"
        }
        for edge in raw_edges:
            if edge.get("kind") == "conditional":
                continue
            src = edge.get("source", "")
            tgt = edge.get("target", "")
            src_port = edge.get("source_output_port_id") or edge.get("sourceOutputPortId") or ""
            tgt_port = edge.get("target_input_port_id") or edge.get("targetInputPortId") or ""
            if src_port and tgt_port and tgt == node_id:
                key = (src, src_port, tgt, tgt_port)
                if key not in existing:
                    synth = {
                        "id": f"edge-{src}-{src_port}-{tgt}-{tgt_port}",
                        "source_kind": "node-output",
                        "source_node": src,
                        "source_port": src_port,
                        "target_node": tgt,
                        "target_port": tgt_port,
                        "iteration": "current",
                    }
                    all_bindings.append(synth)
                    logger.info(
                        "[iterator] Synthesized binding from control edge",
                        node_id=node_id,
                        source=src,
                        source_port=src_port,
                        target_port=tgt_port,
                    )
    resolved = resolve_node_inputs(node_id, all_bindings, state)
    logger.info(
        "[iterator] Resolved node inputs",
        node_id=node_id,
        resolved_ports=list(resolved.keys()),
        binding_count=len(all_bindings),
    )
    for value in resolved.values():
        items = _coerce_to_list(value)
        if items:
            if max_items > 0 and len(items) > max_items:
                items = items[:max_items]
            return items
    return []


def add_iterator_edges(
    graph: StateGraph,
    raw_edges: list[dict[str, Any]],
    raw_nodes: list[dict[str, Any]],
    data_bindings: list[dict[str, Any]] | None = None,
    nearest_routers: dict[str, str] | None = None,
    cycle_nodes: set[str] | None = None,
    router_configs: dict[str, dict[str, Any]] | None = None,
    exit_targets: dict[str, list[str]] | None = None,
) -> None:
    iterator_ids = {n["id"] for n in raw_nodes if is_iterator_container(n)}
    if not iterator_ids:
        return

    data_bindings = data_bindings or []
    nearest_routers = nearest_routers or {}
    cycle_nodes = cycle_nodes or set()
    router_configs = router_configs or {}
    exit_targets = exit_targets or {}

    node_ids = {n["id"] for n in raw_nodes}
    adjacency: dict[str, list[str]] = {nid: [] for nid in node_ids}
    for edge in raw_edges:
        src, tgt = edge.get("source", ""), edge.get("target", "")
        if src in adjacency and tgt in node_ids:
            adjacency[src].append(tgt)

    for it_id in iterator_ids:
        _register_iterator_subgraph(
            graph,
            it_id,
            adjacency,
            raw_nodes,
            raw_edges,
            data_bindings,
            nearest_routers,
            cycle_nodes,
            router_configs,
            exit_targets.get(it_id, []),
        )

    logger.info("[iterator] Configured iterator containers", count=len(iterator_ids))


def _register_iterator_subgraph(
    graph: StateGraph,
    it_id: str,
    adjacency: dict[str, list[str]],
    raw_nodes: list[dict[str, Any]],
    raw_edges: list[dict[str, Any]],
    data_bindings: list[dict[str, Any]],
    nearest_routers: dict[str, str],
    cycle_nodes: set[str],
    router_configs: dict[str, dict[str, Any]],
    exit_targets: list[str],
) -> None:
    children, _ = compute_iterator_children(it_id, adjacency, {n["id"] for n in raw_nodes}, raw_nodes=raw_nodes)
    node_lookup = {n["id"]: n for n in raw_nodes}
    it_node = node_lookup.get(it_id, {})
    it_config = it_node.get("iterator_config", {})
    collection_path = str(it_config.get("collection_path", "") or "")
    max_items = int(it_config.get("max_items", 0) or 0)

    # Build the compiled body subgraph
    body_subgraph = None
    if children:
        body_subgraph = _build_body_subgraph(
            children, raw_nodes, raw_edges, data_bindings,
            nearest_routers, cycle_nodes, router_configs,
        )
        logger.info("[iterator] Compiling subgraph for iterator", iterator_id=it_id, children=sorted(children))
    else:
        logger.info("[iterator] No children for iterator — items processed inline", iterator_id=it_id)

    async def _run_iterator(state: ExecutionState, _it_id: str = it_id) -> dict[str, Any]:
        try:
            writer = get_stream_writer()
        except RuntimeError:
            writer = lambda _: None

        items = _resolve_items_from_bindings(_it_id, data_bindings, state, max_items, raw_edges=raw_edges)
        if not items:
            items = _resolve_items(state, collection_path, max_items)
        logger.info(
            "[iterator] Resolved items for iterator",
            iterator_id=_it_id,
            item_count=len(items),
            collection_path=collection_path,
            binding_count=len([b for b in data_bindings if b.get("target_node") == _it_id]),
            task_output_keys=list(state.get("task_outputs", {}).keys()),
        )
        iteration = state["iterations"].get(_it_id, 0)
        child_results: list[dict[str, Any]] = []

        # Surface the iterator itself as a running step so the UI shows a live badge.
        writer({
            "type": "NodeStarted",
            "node_id": _it_id,
            "iteration": iteration,
            "payload": {"label": str(node_lookup.get(_it_id, {}).get("label") or _it_id)},
        })

        for index, item in enumerate(items):
            if state.get("cancelled", False):
                logger.info("[iterator] Cancellation detected — stopping after %d items", index)
                break
            if body_subgraph is not None:
                child_state: ExecutionState = {
                    "execution_id": state.get("execution_id", ""),
                    "flow_id": state.get("flow_id", ""),
                    "inputs": {**state.get("inputs", {}), "_item": item, "_index": index},
                    "task_outputs": {},
                    "iterations": {},
                    "router_decisions": {},
                    "errors": [],
                    "pending_approval": None,
                    "cancelled": state.get("cancelled", False),
                }
                # Announce this turn's children so their results stream per iteration
                # instead of appearing only when the whole iterator completes.
                for child_id in children:
                    writer({
                        "type": "IteratorChildStepStarted",
                        "node_id": _it_id,
                        "iteration": iteration,
                        "payload": {
                            "iterationIndex": index,
                            "taskId": child_id,
                            "taskTitle": str(node_lookup.get(child_id, {}).get("label") or child_id),
                            "status": "running",
                        },
                    })
                try:
                    result_state = await body_subgraph.ainvoke(child_state)
                    child_task_outputs = result_state.get("task_outputs", {})
                    iteration_child_results = []
                    for child_id in children:
                        child_iteration = result_state.get("iterations", {}).get(child_id, 1) - 1
                        child_output = child_task_outputs.get((child_id, max(0, child_iteration)))
                        if not isinstance(child_output, dict):
                            continue
                        iteration_child_results.append({
                            "taskId": child_id,
                            "taskTitle": str(node_lookup.get(child_id, {}).get("label") or child_id),
                            "status": str(child_output.get("status") or "completed"),
                            "output": child_output.get("display_text") or child_output.get("displayText") or child_output.get("output"),
                            "components": child_output.get("components") or [],
                            "reasoningChain": child_output.get("reasoning_trace") or child_output.get("reasoningChain") or [],
                            "artifacts": child_output.get("artifacts") or [],
                        })
                    child_results.append({
                        "index": index,
                        "status": "completed",
                        "itemPreview": str(item)[:240],
                        "output": str(child_task_outputs),
                        "childResults": iteration_child_results,
                    })
                    for child_result in iteration_child_results:
                        writer({
                            "type": "IteratorChildStepCompleted",
                            "node_id": _it_id,
                            "iteration": iteration,
                            "payload": _child_event_payload(child_result, index),
                        })
                except Exception as exc:
                    logger.error("[iterator] Child subgraph failed", iterator_id=_it_id, index=index, error=str(exc))
                    for child_id in children:
                        writer({
                            "type": "IteratorChildStepCompleted",
                            "node_id": _it_id,
                            "iteration": iteration,
                            "payload": {
                                "iterationIndex": index,
                                "taskId": child_id,
                                "taskTitle": str(node_lookup.get(child_id, {}).get("label") or child_id),
                                "status": "failed",
                                "error": str(exc),
                            },
                        })
                    child_results.append({
                        "index": index,
                        "status": "failed",
                        "itemPreview": str(item)[:240],
                        "error": str(exc),
                    })
            else:
                child_results.append({
                    "index": index,
                    "status": "completed",
                    "itemPreview": str(item)[:240],
                    "output": str(item),
                })

        result_payload: dict[str, Any] = {
            "iterator_iterations": child_results,
            "count": len(child_results),
        }

        logger.info(
            "[iterator] Iterator finished",
            iterator_id=_it_id,
            result_count=len(child_results),
            result_preview=str(result_payload)[:500],
        )

        return {
            "task_outputs": {(_it_id, iteration): result_payload},
            "iterations": {_it_id: iteration + 1},
        }

    graph.add_node(it_id, _run_iterator)

    if exit_targets:
        for target in exit_targets:
            graph.add_edge(it_id, target)
    else:
        graph.add_edge(it_id, END)
