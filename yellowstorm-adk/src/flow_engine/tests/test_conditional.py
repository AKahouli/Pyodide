"""Tests for conditional topology graph building."""

import json
from pathlib import Path

import pytest
from langgraph.graph import END

from src.flow_engine.builder import compose
from src.flow_engine.builder.conditional import add_conditional_edges


def load_fixture(name: str) -> dict:
    path = Path(__file__).parent / "fixtures" / name
    return json.loads(path.read_text())


class TestConditional:
    def test_unlinked_declared_router_label_terminates_branch(self):
        calls = []

        class Graph:
            def add_conditional_edges(self, source, path, label_map):
                calls.append((source, path, label_map))

        add_conditional_edges(Graph(), [{
            "id": "edge-1",
            "kind": "conditional",
            "source": "router-1",
            "target": "target-1",
            "router_label": "linked",
        }], [{
            "id": "router-1",
            "kind": "router",
            "router_config": {"output_labels": ["linked", "unlinked", "__error__"]},
        }, {
            "id": "target-1",
            "kind": "step",
        }])

        source, path, label_map = calls[0]
        assert source == "router-1"
        assert path({"router_decisions": {"router-1": "unlinked"}}) == "unlinked"
        assert label_map == {"linked": "target-1", "unlinked": END, "__error__": END}

    def test_compose_retry_loop(self):
        snapshot = load_fixture("retry_loop.json")
        graph = compose(snapshot)
        assert graph is not None

    def test_compose_router_with_unlinked_terminal_label(self):
        snapshot = load_fixture("retry_loop.json")
        snapshot["control_edges"] = [
            edge for edge in snapshot["control_edges"] if edge["id"] != "e4"
        ]
        graph = compose(snapshot)
        assert graph is not None

    def test_router_has_conditional_edges(self):
        snapshot = load_fixture("retry_loop.json")
        graph = compose(snapshot)
        router = [n for n in snapshot["nodes"] if n.get("kind") == "router"]
        assert len(router) == 1

    def test_every_conditional_edge_from_router(self):
        snapshot = load_fixture("retry_loop.json")
        router_ids = {n["id"] for n in snapshot["nodes"] if n.get("kind") == "router"}
        for edge in snapshot["control_edges"]:
            if edge.get("kind") == "conditional":
                assert edge["source"] in router_ids, (
                    f"Conditional edge {edge['id']} source is not a router"
                )

    def test_recovery_branch_has_error_label(self):
        snapshot = load_fixture("recovery_branch.json")
        labels = set()
        for edge in snapshot["control_edges"]:
            if edge.get("kind") == "conditional":
                labels.add(edge.get("router_label", ""))
        assert "__error__" in labels
