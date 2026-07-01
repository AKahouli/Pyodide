from __future__ import annotations

from typing import Any

from src.flow_engine.bindings.resolver import _extract_port_value
from src.flow_engine.state import ExecutionState


class RouterConditionSourceUnavailableError(RuntimeError):
    """Raised when a deterministic router source node has no completed output yet."""


def _dot_get(value: Any, path: str | None) -> Any:
    if not path:
        return value

    path = path.removeprefix("$.").removeprefix("$")
    if not path:
        return value

    current = value
    for part in path.split("."):
        if isinstance(current, dict):
            current = current.get(part)
            continue
        return None
    return current


def _coerce_number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _read_source_value(state: ExecutionState, source_node: str, source_port: str, path: str | None) -> Any:
    next_iteration = state["iterations"].get(source_node, 0)
    payload = state["task_outputs"].get((source_node, max(0, next_iteration - 1)))
    value = _extract_port_value(payload, source_port)
    return _dot_get(value, path)


def _read_self_input_value(
    state: ExecutionState,
    node_inputs: dict[str, Any],
    source_port: str,
    path: str | None,
) -> Any:
    if source_port in node_inputs:
        value = node_inputs[source_port]
    elif "_item" in state.get("inputs", {}):
        value = state["inputs"]["_item"]
    else:
        value = None
    return _dot_get(value, path)


def _has_source_output(state: ExecutionState, source_node: str) -> bool:
    next_iteration = state["iterations"].get(source_node, 0)
    return (source_node, max(0, next_iteration - 1)) in state["task_outputs"]


def _matches(operator: str, actual: Any, expected: Any) -> bool:
    actual_number = _coerce_number(actual)
    expected_number = _coerce_number(expected)

    if operator == "equals":
        if actual_number is not None and expected_number is not None:
            return actual_number == expected_number
        return actual == expected
    if operator == "not_equals":
        if actual_number is not None and expected_number is not None:
            return actual_number != expected_number
        return actual != expected
    if operator == "exists":
        return actual is not None
    if operator == "contains":
        if isinstance(actual, str):
            return str(expected) in actual
        if isinstance(actual, dict):
            return expected in actual or expected in actual.values()
        if isinstance(actual, (list, tuple, set)):
            return expected in actual
        return False

    if actual_number is None or expected_number is None:
        return False

    if operator == "gt":
        return actual_number > expected_number
    if operator == "gte":
        return actual_number >= expected_number
    if operator == "lt":
        return actual_number < expected_number
    if operator == "lte":
        return actual_number <= expected_number

    return False


def choose_deterministic_label(
    node_config: dict[str, Any],
    state: ExecutionState,
    node_id: str | None = None,
    node_inputs: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    router_config = node_config.get("router_config", {}) or {}
    conditions = router_config.get("conditions") or []
    if not conditions:
        return None

    output_labels = router_config.get("output_labels", ["continue"])
    default_label = router_config.get("default_label") or output_labels[0]

    for index, condition in enumerate(conditions):
        source_node = condition.get("source_node") or condition.get("sourceNode")
        source_port = condition.get("source_port") or condition.get("sourcePort")
        operator = condition.get("operator")

        if not source_node or not source_port or not operator:
            continue

        if node_id and source_node == node_id:
            actual = _read_self_input_value(
                state,
                node_inputs or {},
                source_port,
                condition.get("path"),
            )
            if _matches(operator, actual, condition.get("value")):
                return {
                    "label": condition.get("label", default_label),
                    "matched_condition_index": index,
                    "used_default": False,
                    "mode": "deterministic",
                }
            continue

        if not _has_source_output(state, source_node):
            raise RouterConditionSourceUnavailableError(
                f"Deterministic router source {source_node} has no completed output yet",
            )

        actual = _read_source_value(
            state,
            source_node,
            source_port,
            condition.get("path"),
        )
        if _matches(operator, actual, condition.get("value")):
            return {
                "label": condition.get("label", default_label),
                "matched_condition_index": index,
                "used_default": False,
                "mode": "deterministic",
            }

    return {
        "label": default_label,
        "matched_condition_index": None,
        "used_default": True,
        "mode": "deterministic",
    }
