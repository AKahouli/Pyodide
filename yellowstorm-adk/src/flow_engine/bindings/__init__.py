"""Data-binding source types used by the resolver."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional


@dataclass
class NodeOutputSource:
    kind: str = "node-output"
    source_node: str = ""
    source_port: str = ""
    iteration: str = "current"


@dataclass
class TriggerSource:
    kind: str = "trigger"
    trigger_path: str = ""


@dataclass
class StateSource:
    kind: str = "state"
    state_path: str = ""


@dataclass
class ConstantSource:
    kind: str = "constant"
    constant_value: Any = None


@dataclass
class ExpressionSource:
    kind: str = "expression"
    expression: str = ""


DataSource = NodeOutputSource | TriggerSource | StateSource | ConstantSource | ExpressionSource


def parse_data_source(raw: dict[str, Any]) -> DataSource:
    kind = raw.get("source_kind", "")
    if kind == "node-output":
        return NodeOutputSource(
            source_node=raw.get("source_node", ""),
            source_port=raw.get("source_port", ""),
            iteration=raw.get("iteration", "current"),
        )
    if kind == "trigger":
        return TriggerSource(trigger_path=raw.get("trigger_path", ""))
    if kind == "state":
        return StateSource(state_path=raw.get("state_path", ""))
    if kind == "constant":
        return ConstantSource(constant_value=raw.get("constant_value"))
    if kind == "expression":
        return ExpressionSource(expression=raw.get("expression", ""))
    raise ValueError(f"Unknown data source kind: {kind}")
