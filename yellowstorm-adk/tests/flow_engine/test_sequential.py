"""Tests for sequential topology graph building."""

import json
from pathlib import Path

import pytest

from src.flow_engine.builder import compose


def load_fixture(name: str) -> dict:
    path = Path(__file__).parent / "fixtures" / name
    return json.loads(path.read_text())


class TestSequential:
    def test_compose_linear_graph(self):
        snapshot = load_fixture("linear.json")
        graph = compose(snapshot)
        assert graph is not None

    def test_graph_has_all_nodes(self):
        snapshot = load_fixture("linear.json")
        graph = compose(snapshot)
        node_ids = {n["id"] for n in snapshot["nodes"]}
        for nid in node_ids:
            assert nid in graph.nodes, f"Missing node: {nid}"

    def test_graph_has_all_sequential_edges(self):
        snapshot = load_fixture("linear.json")
        graph = compose(snapshot)
        for edge in snapshot["control_edges"]:
            if edge.get("kind") == "sequential":
                assert edge["source"] in graph.nodes
                assert edge["target"] in graph.nodes

    def test_compose_with_empty_nodes(self):
        snapshot = {
            "nodes": [],
            "control_edges": [],
            "data_bindings": [],
            "settings": {"recursion_limit": 25, "max_parallelism": 5},
        }
        with pytest.raises(ValueError, match="entrypoint"):
            compose(snapshot)

    def test_compose_with_single_node(self):
        snapshot = {
            "nodes": [{"id": "n1", "kind": "step", "label": "Only"}],
            "control_edges": [],
            "data_bindings": [],
            "settings": {"recursion_limit": 25, "max_parallelism": 5},
        }
        graph = compose(snapshot)
        assert "n1" in graph.nodes
