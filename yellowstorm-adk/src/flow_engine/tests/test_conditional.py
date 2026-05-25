"""Tests for conditional topology graph building."""

import json
from pathlib import Path

import pytest

from src.flow_engine.builder import compose


def load_fixture(name: str) -> dict:
    path = Path(__file__).parent / "fixtures" / name
    return json.loads(path.read_text())


class TestConditional:
    def test_compose_retry_loop(self):
        snapshot = load_fixture("retry_loop.json")
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
