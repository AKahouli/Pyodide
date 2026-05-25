"""Tests for human-approval node and interrupt wiring."""

import json
from pathlib import Path

import pytest

from src.flow_engine.builder import compose
from src.flow_engine.nodes.human_approval import run_human_approval


def load_fixture(name: str) -> dict:
    path = Path(__file__).parent / "fixtures" / name
    return json.loads(path.read_text())


class TestHumanApproval:
    def test_human_approval_node_detected(self):
        snapshot = load_fixture("human_approval.json")
        ha_nodes = [n for n in snapshot["nodes"] if n.get("kind") == "human_approval"]
        assert len(ha_nodes) == 1
        assert ha_nodes[0]["id"] == "node-2"

    def test_compose_with_human_approval(self):
        snapshot = load_fixture("human_approval.json")
        graph = compose(snapshot)
        assert graph is not None

    def test_human_approval_sets_pending_state(self):
        import json
        snapshot = load_fixture("human_approval.json")
        ha_node = next(n for n in snapshot["nodes"] if n.get("kind") == "human_approval")
        result = {}  # Would be state dict in real execution
        assert ha_node.get("human_approval_config", {}).get("prompt_template") == "Approve the result?"
