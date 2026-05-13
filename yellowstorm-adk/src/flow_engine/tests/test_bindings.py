"""Tests for data binding resolution."""

import pytest

from src.flow_engine.bindings import (
    ConstantSource,
    NodeOutputSource,
    TriggerSource,
    parse_data_source,
)
from src.flow_engine.bindings.resolver import resolve_node_inputs
from src.flow_engine.state import ExecutionState


class TestBindings:
    def test_parse_node_output_source(self):
        raw = {"source_kind": "node-output", "source_node": "n1", "source_port": "out"}
        source = parse_data_source(raw)
        assert isinstance(source, NodeOutputSource)
        assert source.source_node == "n1"

    def test_parse_trigger_source(self):
        raw = {"source_kind": "trigger", "trigger_path": "input.query"}
        source = parse_data_source(raw)
        assert isinstance(source, TriggerSource)
        assert source.trigger_path == "input.query"

    def test_parse_constant_source(self):
        raw = {"source_kind": "constant", "constant_value": 42}
        source = parse_data_source(raw)
        assert isinstance(source, ConstantSource)
        assert source.constant_value == 42

    def test_parse_unknown_source_raises(self):
        with pytest.raises(ValueError, match="Unknown data source kind"):
            parse_data_source({"source_kind": "invalid"})

    def test_resolve_trigger_binding(self):
        state: ExecutionState = {
            "execution_id": "e1",
            "flow_id": "f1",
            "inputs": {"query": "hello"},
            "task_outputs": {},
            "iterations": {},
            "router_decisions": {},
            "errors": [],
            "pending_approval": None,
            "cancelled": False,
        }
        bindings = [{"target_port": "q", "source_kind": "trigger", "trigger_path": "query"}]
        result = resolve_node_inputs("n1", bindings, state)
        assert result.get("q") == "hello"

    def test_resolve_constant_binding(self):
        state: ExecutionState = {
            "execution_id": "e1",
            "flow_id": "f1",
            "inputs": {},
            "task_outputs": {},
            "iterations": {},
            "router_decisions": {},
            "errors": [],
            "pending_approval": None,
            "cancelled": False,
        }
        bindings = [{"target_port": "val", "source_kind": "constant", "constant_value": 99}]
        result = resolve_node_inputs("n1", bindings, state)
        assert result.get("val") == 99

    def test_resolve_empty_bindings(self):
        state: ExecutionState = {
            "execution_id": "e1",
            "flow_id": "f1",
            "inputs": {},
            "task_outputs": {},
            "iterations": {},
            "router_decisions": {},
            "errors": [],
            "pending_approval": None,
            "cancelled": False,
        }
        result = resolve_node_inputs("n1", [], state)
        assert result == {}
