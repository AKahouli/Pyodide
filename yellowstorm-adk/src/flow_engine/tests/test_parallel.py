"""Tests for parallel topology graph building."""

import json
from pathlib import Path

import pytest

from src.flow_engine.builder import compose


def load_fixture(name: str) -> dict:
    path = Path(__file__).parent / "fixtures" / name
    return json.loads(path.read_text())


class TestParallel:
    def test_compose_nested_parallel(self):
        snapshot = load_fixture("nested_parallel.json")
        graph = compose(snapshot)
        assert graph is not None

    def test_outgoing_edges_from_start(self):
        snapshot = load_fixture("nested_parallel.json")
        source_edges = [e for e in snapshot["control_edges"] if e["source"] == "node-1"]
        assert len(source_edges) == 3

    def test_convergence_on_merge_node(self):
        snapshot = load_fixture("nested_parallel.json")
        target_edges = [e for e in snapshot["control_edges"] if e["target"] == "node-5"]
        assert len(target_edges) == 3
