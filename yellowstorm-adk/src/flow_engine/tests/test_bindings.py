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

    def test_resolve_node_inputs_filters_other_nodes(self):
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
        bindings = [
            {"target_node": "n2", "target_port": "q", "source_kind": "trigger", "trigger_path": "query"},
            {"target_node": "n1", "target_port": "q", "source_kind": "trigger", "trigger_path": "query"},
        ]
        result = resolve_node_inputs("n1", bindings, state)
        assert result == {"q": "hello"}

    def test_resolve_unknown_binding_raises_loudly(self):
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
        bindings = [{"id": "b1", "target_node": "n1", "source_kind": "invalid"}]
        with pytest.raises(ValueError, match="Unknown data source kind"):
            resolve_node_inputs("n1", bindings, state)

    def test_resolve_node_output_current_uses_latest_completed_iteration(self):
        state: ExecutionState = {
            "execution_id": "e1",
            "flow_id": "f1",
            "inputs": {},
            "task_outputs": {
                ("source", 0): {"output": "first"},
                ("source", 1): {"output": "second"},
            },
            "iterations": {"source": 2},
            "router_decisions": {},
            "errors": [],
            "pending_approval": None,
            "cancelled": False,
        }
        bindings = [{
            "target_node": "n1",
            "target_port": "value",
            "source_kind": "node-output",
            "source_node": "source",
            "source_port": "output",
            "iteration": "current",
        }]

        result = resolve_node_inputs("n1", bindings, state)
        assert result == {"value": "second"}

    def test_resolve_node_output_honors_source_port_path(self):
        state: ExecutionState = {
            "execution_id": "e1",
            "flow_id": "f1",
            "inputs": {},
            "task_outputs": {
                ("source", 0): {"output": {"text": "hello", "metadata": {"lang": "en"}}},
            },
            "iterations": {"source": 1},
            "router_decisions": {},
            "errors": [],
            "pending_approval": None,
            "cancelled": False,
        }
        bindings = [{
            "target_node": "n1",
            "target_port": "lang",
            "source_kind": "node-output",
            "source_node": "source",
            "source_port": "metadata.lang",
            "iteration": "current",
        }]

        result = resolve_node_inputs("n1", bindings, state)
        assert result == {"lang": "en"}

    def test_resolve_node_output_missing_source_port_returns_none(self):
        state: ExecutionState = {
            "execution_id": "e1",
            "flow_id": "f1",
            "inputs": {},
            "task_outputs": {
                ("source", 0): {"output": {"text": "hello"}},
            },
            "iterations": {"source": 1},
            "router_decisions": {},
            "errors": [],
            "pending_approval": None,
            "cancelled": False,
        }
        bindings = [{
            "target_node": "n1",
            "target_port": "missing",
            "source_kind": "node-output",
            "source_node": "source",
            "source_port": "metadata.lang",
            "iteration": "current",
        }]

        result = resolve_node_inputs("n1", bindings, state)
        assert result == {"missing": None}

    def test_resolve_node_output_reads_structured_port_outputs(self):
        state: ExecutionState = {
            "execution_id": "e1",
            "flow_id": "f1",
            "inputs": {},
            "task_outputs": {
                ("source", 0): {
                    "outputs": {
                        "summary": {"artifactKind": "text", "content": "hello"},
                    },
                },
            },
            "iterations": {"source": 1},
            "router_decisions": {},
            "errors": [],
            "pending_approval": None,
            "cancelled": False,
        }
        bindings = [{
            "target_node": "n1",
            "target_port": "value",
            "source_kind": "node-output",
            "source_node": "source",
            "source_port": "summary",
            "iteration": "current",
        }]

        result = resolve_node_inputs("n1", bindings, state)
        assert result == {"value": "hello"}

    def test_resolve_node_output_prefers_structured_outputs_when_display_text_is_present(self):
        state: ExecutionState = {
            "execution_id": "e1",
            "flow_id": "f1",
            "inputs": {},
            "task_outputs": {
                ("source", 0): {
                    "output": "Executive summary",
                    "display_text": "Executive summary",
                    "artifacts": [{
                        "port_id": "summary",
                        "artifact_kind": "text",
                        "content": "Executive summary",
                    }],
                    "outputs": {
                        "summary": {"content": "Executive summary"},
                    },
                },
            },
            "iterations": {"source": 1},
            "router_decisions": {},
            "errors": [],
            "pending_approval": None,
            "cancelled": False,
        }
        bindings = [{
            "target_node": "n1",
            "target_port": "value",
            "source_kind": "node-output",
            "source_node": "source",
            "source_port": "summary",
            "iteration": "current",
        }]

        result = resolve_node_inputs("n1", bindings, state)
        assert result == {"value": "Executive summary"}

    def test_resolve_node_output_reads_list_shaped_structured_outputs(self):
        state: ExecutionState = {
            "execution_id": "e1",
            "flow_id": "f1",
            "inputs": {},
            "task_outputs": {
                ("source", 0): {
                    "outputs": [
                        {
                            "output_port_id": "leaderSheet",
                            "artifact_kind": "document",
                            "content": {"filename": "leaders.xlsx"},
                        }
                    ],
                },
            },
            "iterations": {"source": 1},
            "router_decisions": {},
            "errors": [],
            "pending_approval": None,
            "cancelled": False,
        }
        bindings = [{
            "target_node": "n1",
            "target_port": "file",
            "source_kind": "node-output",
            "source_node": "source",
            "source_port": "leaderSheet",
            "iteration": "current",
        }]

        result = resolve_node_inputs("n1", bindings, state)
        assert result == {"file": {"filename": "leaders.xlsx"}}

    def test_resolve_node_output_reads_ports_list_from_json_string_output(self):
        state: ExecutionState = {
            "execution_id": "e1",
            "flow_id": "f1",
            "inputs": {},
            "task_outputs": {
                ("source", 0): {
                    "output": '{"ports":[{"id":"default","label":"data table","type":"data","value":[{"year":1994,"world_population_billion":5.68}]},{"id":"out-59d3d089","label":"summary","type":"text","value":"World population has grown."}]}'
                },
            },
            "iterations": {"source": 1},
            "router_decisions": {},
            "errors": [],
            "pending_approval": None,
            "cancelled": False,
        }
        bindings = [{
            "target_node": "n1",
            "target_port": "value",
            "source_kind": "node-output",
            "source_node": "source",
            "source_port": "out-59d3d089",
            "iteration": "current",
        }]

        result = resolve_node_inputs("n1", bindings, state)
        assert result == {"value": "World population has grown."}

    def test_resolve_node_output_reads_outputs_dict_from_json_string_output(self):
        state: ExecutionState = {
            "execution_id": "e1",
            "flow_id": "f1",
            "inputs": {},
            "task_outputs": {
                ("source", 0): {
                    "output": '{"outputs":{"out-59d3d089":{"artifactKind":"text","content":"World population has grown."}}}'
                },
            },
            "iterations": {"source": 1},
            "router_decisions": {},
            "errors": [],
            "pending_approval": None,
            "cancelled": False,
        }
        bindings = [{
            "target_node": "n1",
            "target_port": "value",
            "source_kind": "node-output",
            "source_node": "source",
            "source_port": "out-59d3d089",
            "iteration": "current",
        }]

        result = resolve_node_inputs("n1", bindings, state)
        assert result == {"value": "World population has grown."}

    def test_resolve_node_output_missing_json_string_port_does_not_fall_back_to_raw_output(self):
        state: ExecutionState = {
            "execution_id": "e1",
            "flow_id": "f1",
            "inputs": {},
            "task_outputs": {
                ("source", 0): {
                    "output": '{"ports":[{"id":"default","label":"data table","type":"data","value":[{"year":1994,"world_population_billion":5.68}]}]}'
                },
            },
            "iterations": {"source": 1},
            "router_decisions": {},
            "errors": [],
            "pending_approval": None,
            "cancelled": False,
        }
        bindings = [{
            "target_node": "n1",
            "target_port": "value",
            "source_kind": "node-output",
            "source_node": "source",
            "source_port": "out-59d3d089",
            "iteration": "current",
        }]

        result = resolve_node_inputs("n1", bindings, state)
        assert result == {"value": None}

    def test_resolve_node_output_default_missing_in_json_string_does_not_fall_back_to_raw_output(self):
        state: ExecutionState = {
            "execution_id": "e1",
            "flow_id": "f1",
            "inputs": {},
            "task_outputs": {
                ("source", 0): {
                    "output": '{"ports":[{"id":"out-59d3d089","label":"summary","type":"text","value":"World population has grown."}]}'
                },
            },
            "iterations": {"source": 1},
            "router_decisions": {},
            "errors": [],
            "pending_approval": None,
            "cancelled": False,
        }
        bindings = [{
            "target_node": "n1",
            "target_port": "value",
            "source_kind": "node-output",
            "source_node": "source",
            "source_port": "default",
            "iteration": "current",
        }]

        result = resolve_node_inputs("n1", bindings, state)
        assert result == {"value": None}

    def test_resolve_node_output_reads_structured_data_payload(self):
        state: ExecutionState = {
            "execution_id": "e1",
            "flow_id": "f1",
            "inputs": {},
            "task_outputs": {
                ("source", 0): {
                    "outputs": {
                        "metrics": {
                            "artifactKind": "data",
                            "data": {"count": 2, "items": ["a", "b"]},
                        },
                    },
                },
            },
            "iterations": {"source": 1},
            "router_decisions": {},
            "errors": [],
            "pending_approval": None,
            "cancelled": False,
        }
        bindings = [{
            "target_node": "n1",
            "target_port": "metrics",
            "source_kind": "node-output",
            "source_node": "source",
            "source_port": "metrics",
            "iteration": "current",
        }]

        result = resolve_node_inputs("n1", bindings, state)
        assert result == {"metrics": {"count": 2, "items": ["a", "b"]}}

    def test_resolve_node_output_reads_structured_ref_payload(self):
        state: ExecutionState = {
            "execution_id": "e1",
            "flow_id": "f1",
            "inputs": {},
            "task_outputs": {
                ("source", 0): {
                    "outputs": [
                        {
                            "output_port_id": "report",
                            "artifact_kind": "document",
                            "ref": {
                                "document_id": "doc-1",
                                "filename": "report.xlsx",
                            },
                        }
                    ],
                },
            },
            "iterations": {"source": 1},
            "router_decisions": {},
            "errors": [],
            "pending_approval": None,
            "cancelled": False,
        }
        bindings = [{
            "target_node": "n1",
            "target_port": "report",
            "source_kind": "node-output",
            "source_node": "source",
            "source_port": "report",
            "iteration": "current",
        }]

        result = resolve_node_inputs("n1", bindings, state)
        assert result == {"report": {"document_id": "doc-1", "filename": "report.xlsx"}}

    def test_resolve_node_output_default_falls_back_to_legacy_output_string(self):
        state: ExecutionState = {
            "execution_id": "e1",
            "flow_id": "f1",
            "inputs": {},
            "task_outputs": {
                ("source", 0): {"output": "legacy text"},
            },
            "iterations": {"source": 1},
            "router_decisions": {},
            "errors": [],
            "pending_approval": None,
            "cancelled": False,
        }
        bindings = [{
            "target_node": "n1",
            "target_port": "value",
            "source_kind": "node-output",
            "source_node": "source",
            "source_port": "default",
            "iteration": "current",
        }]

        result = resolve_node_inputs("n1", bindings, state)
        assert result == {"value": "legacy text"}

    def test_resolve_node_output_custom_port_id_falls_back_to_legacy_output_string(self):
        state: ExecutionState = {
            "execution_id": "e1",
            "flow_id": "f1",
            "inputs": {},
            "task_outputs": {
                ("source", 0): {"output": "legacy text"},
            },
            "iterations": {"source": 1},
            "router_decisions": {},
            "errors": [],
            "pending_approval": None,
            "cancelled": False,
        }
        bindings = [{
            "target_node": "n1",
            "target_port": "value",
            "source_kind": "node-output",
            "source_node": "source",
            "source_port": "out-59d3d089",
            "iteration": "current",
        }]

        result = resolve_node_inputs("n1", bindings, state)
        assert result == {"value": "legacy text"}

    def test_resolve_node_output_dotted_path_does_not_fall_back_to_legacy_output_string(self):
        state: ExecutionState = {
            "execution_id": "e1",
            "flow_id": "f1",
            "inputs": {},
            "task_outputs": {
                ("source", 0): {"output": "legacy text"},
            },
            "iterations": {"source": 1},
            "router_decisions": {},
            "errors": [],
            "pending_approval": None,
            "cancelled": False,
        }
        bindings = [{
            "target_node": "n1",
            "target_port": "value",
            "source_kind": "node-output",
            "source_node": "source",
            "source_port": "metadata.lang",
            "iteration": "current",
        }]

        result = resolve_node_inputs("n1", bindings, state)
        assert result == {"value": None}

    def test_resolve_node_output_missing_structured_port_does_not_fall_back_to_legacy_output_string(self):
        state: ExecutionState = {
            "execution_id": "e1",
            "flow_id": "f1",
            "inputs": {},
            "task_outputs": {
                ("source", 0): {
                    "output": "legacy text",
                    "outputs": {
                        "default": {"artifactKind": "text", "content": "structured text"},
                    },
                },
            },
            "iterations": {"source": 1},
            "router_decisions": {},
            "errors": [],
            "pending_approval": None,
            "cancelled": False,
        }
        bindings = [{
            "target_node": "n1",
            "target_port": "value",
            "source_kind": "node-output",
            "source_node": "source",
            "source_port": "out-59d3d089",
            "iteration": "current",
        }]

        result = resolve_node_inputs("n1", bindings, state)
        assert result == {"value": None}

    def test_resolve_iterator_results_port_reads_iterator_iterations(self):
        state: ExecutionState = {
            "execution_id": "e1",
            "flow_id": "f1",
            "inputs": {},
            "task_outputs": {
                ("iterator", 0): {
                    "iterator_iterations": [
                        {"index": 0, "status": "completed", "output": "a"},
                        {"index": 1, "status": "completed", "output": "b"},
                    ],
                    "count": 2,
                },
            },
            "iterations": {"iterator": 1},
            "router_decisions": {},
            "errors": [],
            "pending_approval": None,
            "cancelled": False,
        }
        bindings = [{
            "target_node": "n1",
            "target_port": "items",
            "source_kind": "node-output",
            "source_node": "iterator",
            "source_port": "results",
            "iteration": "current",
        }]

        result = resolve_node_inputs("n1", bindings, state)
        assert result == {
            "items": [
                {"index": 0, "status": "completed", "output": "a"},
                {"index": 1, "status": "completed", "output": "b"},
            ]
        }
