"""Resolve DataBindings against ExecutionState to produce node inputs.

Pure function — no I/O, no side effects.  Returns the resolved input
payload dict for a single node.
"""

from __future__ import annotations

from typing import Any, Optional

from src.flow_engine.bindings import (
    ConstantSource,
    DataSource,
    ExpressionSource,
    NodeOutputSource,
    StateSource,
    TriggerSource,
    parse_data_source,
)
from src.flow_engine.state import ExecutionState


def _dot_get(obj: dict[str, Any], path: str) -> Any:
    parts = path.split(".")
    current: Any = obj
    for part in parts:
        if isinstance(current, dict):
            current = current.get(part)
        else:
            return None
    return current


def _resolve_node_output(
    source: NodeOutputSource,
    state: ExecutionState,
) -> Any:
    if source.iteration == "current":
        return state["task_outputs"].get((source.source_node, state["iterations"].get(source.source_node, 0)))
    if source.iteration == "previous":
        current_iter = state["iterations"].get(source.source_node, 0)
        if current_iter == 0:
            return None
        return state["task_outputs"].get((source.source_node, current_iter - 1))
    try:
        iter_num = int(source.iteration)
        return state["task_outputs"].get((source.source_node, iter_num))
    except ValueError:
        return None


def resolve_node_inputs(
    node_id: str,
    bindings: list[dict[str, Any]],
    state: ExecutionState,
) -> dict[str, Any]:
    resolved: dict[str, Any] = {}

    for raw in bindings:
        target_port = raw.get("target_port", "default")
        source = parse_data_source(raw)

        if isinstance(source, NodeOutputSource):
            resolved[target_port] = _resolve_node_output(source, state)

        elif isinstance(source, TriggerSource):
            resolved[target_port] = _dot_get(state.get("inputs", {}), source.trigger_path)

        elif isinstance(source, StateSource):
            resolved[target_port] = _dot_get(dict(state), source.state_path)

        elif isinstance(source, ConstantSource):
            resolved[target_port] = source.constant_value

        elif isinstance(source, ExpressionSource):
            resolved[target_port] = _resolve_expression(source.expression, state)

    return resolved


def _resolve_expression(expression: str, state: ExecutionState) -> Optional[str]:
    try:
        safe_globals: dict[str, Any] = {}
        safe_locals: dict[str, Any] = {
            "state": dict(state),
            "inputs": state.get("inputs", {}),
            "iterations": state.get("iterations", {}),
            "router_decisions": state.get("router_decisions", {}),
        }
        result = eval(expression, safe_globals, safe_locals)
        return str(result) if result is not None else None
    except Exception:
        return None
