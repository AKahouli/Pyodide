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

    def test_human_approval_sets_pending_state(self, monkeypatch):
        import asyncio
        from src.flow_engine.nodes import human_approval as ha_module

        snapshot = load_fixture("human_approval.json")
        ha_node = next(n for n in snapshot["nodes"] if n.get("kind") == "human_approval")
        state = {
            "iterations": {ha_node["id"]: 0},
            "task_outputs": {},
            "router_decisions": {},
            "errors": [],
            "pending_approval": None,
            "cancelled": False,
        }

        # interrupt() requires a LangGraph runnable context; stub it so the node
        # can be exercised in isolation and capture the pending state it builds.
        captured: dict = {}

        def fake_interrupt(pending):
            captured["pending"] = pending
            return {"decision": "approved"}

        monkeypatch.setattr(ha_module, "interrupt", fake_interrupt)

        result = asyncio.run(
            run_human_approval(ha_node["id"], ha_node, state),
        )

        assert captured["pending"]["node_id"] == ha_node["id"]
        assert captured["pending"]["prompt"] == "Approve the result?"
        assert result["task_outputs"][(ha_node["id"], 0)] == {"decision": "approved"}
