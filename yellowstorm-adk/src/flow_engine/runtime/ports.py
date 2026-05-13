"""Port resolution — maps input/output port IDs to state fields."""

from __future__ import annotations

from typing import Any


def resolve_input_port(
    node_config: dict[str, Any],
    port_id: str,
    state: dict[str, Any],
) -> Any:
    ports = node_config.get("input", {}).get("ports", [])
    for port in ports:
        if port.get("id") == port_id:
            return state.get("inputs", {}).get(port_id)
    return None


def resolve_output_port(
    node_config: dict[str, Any],
    port_id: str,
    output_payload: dict[str, Any],
) -> Any:
    ports = node_config.get("output", {}).get("ports", [])
    for port in ports:
        if port.get("id") == port_id:
            return output_payload
    return None
