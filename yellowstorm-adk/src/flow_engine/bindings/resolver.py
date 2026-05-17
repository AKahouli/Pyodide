"""Resolve DataBindings against ExecutionState to produce node inputs.

Pure function — no I/O, no side effects.  Returns the resolved input
payload dict for a single node.
"""

from __future__ import annotations

import logging
import re
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

logger = logging.getLogger(__name__)


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
    next_iteration = state["iterations"].get(source.source_node, 0)

    if source.iteration == "current":
        return _extract_port_value(
            state["task_outputs"].get((source.source_node, max(0, next_iteration - 1))),
            source.source_port,
        )
    if source.iteration == "previous":
        if next_iteration <= 1:
            return None
        return _extract_port_value(
            state["task_outputs"].get((source.source_node, next_iteration - 2)),
            source.source_port,
        )
    try:
        iter_num = int(source.iteration)
        return _extract_port_value(
            state["task_outputs"].get((source.source_node, iter_num)),
            source.source_port,
        )
    except ValueError:
        return None


def _extract_port_value(value: Any, source_port: str) -> Any:
    if not source_port or value is None:
        return value

    if isinstance(value, dict):
        direct = _dot_get(value, source_port)
        if direct is not None:
            return direct

        output = value.get("output")
        if isinstance(output, dict):
            nested = _dot_get(output, source_port)
            if nested is not None:
                return nested

    logger.warning("[bindings] Missing source_port path source_port=%s", source_port)
    return None


def resolve_node_inputs(
    node_id: str,
    bindings: list[dict[str, Any]],
    state: ExecutionState,
) -> dict[str, Any]:
    resolved: dict[str, Any] = {}

    for raw in bindings:
        if raw.get("target_node") not in (None, "", node_id):
            continue

        target_port = raw.get("target_port", "default")
        try:
            source = parse_data_source(raw)
        except ValueError as exc:
            logger.warning(
                "[bindings] Invalid binding rejected node_id=%s binding_id=%s source_kind=%s error=%s",
                node_id,
                raw.get("id"),
                raw.get("source_kind"),
                str(exc),
            )
            raise

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


_TEMPLATE_VAR_RE = re.compile(r"\{\{\s*([\w.]+)\s*\}\}")


def _resolve_expression(expression: str, state: ExecutionState) -> Optional[str]:
    context: dict[str, Any] = {
        "inputs": state.get("inputs", {}),
        "iterations": state.get("iterations", {}),
        "router_decisions": state.get("router_decisions", {}),
        "task_outputs": _flatten_task_outputs(state.get("task_outputs", {})),
        "execution_id": state.get("execution_id", ""),
        "flow_id": state.get("flow_id", ""),
    }

    def _replacer(match: re.Match[str]) -> str:
        path = match.group(1)
        parts = path.split(".")
        current: Any = context
        for part in parts:
            if isinstance(current, dict):
                current = current.get(part)
            else:
                current = None
                break
        return str(current) if current is not None else ""

    try:
        result = _TEMPLATE_VAR_RE.sub(_replacer, expression)
        return result if result else None
    except Exception as exc:
        logger.warning("[bindings] Expression resolution failed expression=%s error=%s", expression, str(exc))
        return None


def _flatten_task_outputs(task_outputs: dict[tuple[str, int], Any]) -> dict[str, Any]:
    flat: dict[str, Any] = {}
    for (node_id, iteration), value in task_outputs.items():
        entry = flat.setdefault(node_id, {})
        if isinstance(entry, dict):
            entry[str(iteration)] = value
    return flat
