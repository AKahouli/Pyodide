"""Resolve DataBindings against ExecutionState to produce node inputs.

Pure function — no I/O, no side effects.  Returns the resolved input
payload dict for a single node.
"""

from __future__ import annotations

import json
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


def _extract_artifact_payload(output_item: dict[str, Any]) -> Any:
    if "value" in output_item:
        return output_item.get("value")
    if "content" in output_item:
        return output_item.get("content")
    if "data" in output_item:
        return output_item.get("data")
    if "ref" in output_item:
        return output_item.get("ref")
    return output_item


def _extract_port_payload_from_collection(outputs: Any, source_port: str) -> Any:
    if isinstance(outputs, dict):
        direct_output = outputs.get(source_port)
        if isinstance(direct_output, dict):
            return _extract_artifact_payload(direct_output)
        return None

    if isinstance(outputs, list):
        for output_item in outputs:
            if not isinstance(output_item, dict):
                continue
            output_port_id = output_item.get("output_port_id") or output_item.get(
                "outputPortId"
            ) or output_item.get("port_id") or output_item.get("portId") or output_item.get("id")
            if output_port_id == source_port:
                return _extract_artifact_payload(output_item)

    return None


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
        if source_port == "results" and isinstance(value.get("iterator_iterations"), list):
            return value.get("iterator_iterations")

        outputs = value.get("outputs")
        has_structured_outputs = outputs is not None or value.get("ports") is not None
        structured_match = _extract_port_payload_from_collection(outputs, source_port)
        if structured_match is not None:
            return structured_match

        structured_match = _extract_port_payload_from_collection(value.get("ports"), source_port)
        if structured_match is not None:
            return structured_match

        direct = _dot_get(value, source_port)
        if direct is not None:
            return direct

        output = value.get("output")
        if isinstance(output, dict):
            has_structured_outputs = has_structured_outputs or output.get("outputs") is not None or output.get("ports") is not None
            nested = _dot_get(output, source_port)
            if nested is not None:
                return nested
            structured_match = _extract_port_payload_from_collection(output.get("outputs"), source_port)
            if structured_match is not None:
                return structured_match
            structured_match = _extract_port_payload_from_collection(output.get("ports"), source_port)
            if structured_match is not None:
                return structured_match

        if isinstance(output, str):
            try:
                parsed_output = json.loads(output)
            except (TypeError, ValueError):
                parsed_output = None

            if isinstance(parsed_output, dict):
                has_structured_outputs = has_structured_outputs or parsed_output.get("outputs") is not None or parsed_output.get("ports") is not None
                structured_match = _extract_port_payload_from_collection(parsed_output.get("outputs"), source_port)
                if structured_match is not None:
                    return structured_match
                structured_match = _extract_port_payload_from_collection(parsed_output.get("ports"), source_port)
                if structured_match is not None:
                    return structured_match

        if output is not None:
            if source_port == "output":
                return output

            if source_port == "default" and not has_structured_outputs:
                return output

            # Legacy/plain step nodes still emit a single unstructured output payload.
            # Allow generated custom output port ids to read that payload when no
            # structured per-port outputs exist, but keep dotted paths and arbitrary
            # names resolving loudly to None.
            if isinstance(output, str) and not has_structured_outputs and re.fullmatch(r"out-[A-Za-z0-9-]+", source_port):
                return output

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
