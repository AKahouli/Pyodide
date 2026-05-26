"""Tests for error routing topology."""

import json
from pathlib import Path

import pytest

from src.flow_engine.builder import compose


def load_fixture(name: str) -> dict:
    path = Path(__file__).parent / "fixtures" / name
    return json.loads(path.read_text())


class TestErrorRouting:
    def test_error_label_present(self):
        snapshot = load_fixture("recovery_branch.json")
        labels = set()
        for edge in snapshot["control_edges"]:
            if edge.get("kind") == "conditional":
                labels.add(edge.get("router_label", ""))
        assert "__error__" in labels

    def test_error_routes_to_recovery(self):
        snapshot = load_fixture("recovery_branch.json")
        error_targets = [
            e["target"]
            for e in snapshot["control_edges"]
            if e.get("kind") == "conditional" and e.get("router_label") == "__error__"
        ]
        assert len(error_targets) == 1
        rec_node = next(n for n in snapshot["nodes"] if n["id"] == error_targets[0])
        assert rec_node["label"] == "Recovery"

    def test_compose_recovery_branch(self):
        snapshot = load_fixture("recovery_branch.json")
        graph = compose(snapshot)
        assert graph is not None
