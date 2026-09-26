"""Tests for error routing topology."""

import json
from pathlib import Path

import pytest

from src.flow_engine.builder import NODE_KIND_DISPATCH, compose
from src.flow_engine.builder.guards import build_nearest_router_map


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

    def test_only_direct_router_predecessors_receive_error_routing(self):
        snapshot = load_fixture("recovery_branch.json")

        assert build_nearest_router_map(snapshot["control_edges"], snapshot["nodes"]) == {
            "node-2": "node-3",
        }

    def test_router_must_be_the_exclusive_successor_for_error_routing(self):
        snapshot = load_fixture("recovery_branch.json")
        snapshot["control_edges"].append({
            "id": "fan-out",
            "kind": "sequential",
            "source": "node-2",
            "target": "node-5",
        })

        assert "node-2" not in build_nearest_router_map(snapshot["control_edges"], snapshot["nodes"])

    @pytest.mark.asyncio
    async def test_failed_fan_out_node_stops_all_successors(self, monkeypatch):
        snapshot = load_fixture("recovery_branch.json")
        snapshot["control_edges"].append({
            "id": "fan-out",
            "kind": "sequential",
            "source": "node-2",
            "target": "node-5",
        })
        calls = []

        async def step(node_id, _node, _state, node_inputs=None):
            calls.append(node_id)
            if node_id == "node-2":
                raise RuntimeError("fan-out failed")
            return {"task_outputs": {(node_id, 0): "ok"}}

        monkeypatch.setitem(NODE_KIND_DISPATCH, "step", step)

        with pytest.raises(RuntimeError, match="fan-out failed"):
            await compose(snapshot).ainvoke(_initial_state())

        assert calls == ["node-1", "node-2"]

    @pytest.mark.asyncio
    async def test_failure_before_router_stops_normal_successors(self, monkeypatch):
        snapshot = load_fixture("recovery_branch.json")
        calls = []

        async def step(node_id, _node, _state, node_inputs=None):
            calls.append(node_id)
            if node_id == "node-1":
                raise RuntimeError("failed before router")
            return {"task_outputs": {(node_id, 0): "ok"}}

        monkeypatch.setitem(NODE_KIND_DISPATCH, "step", step)
        graph = compose(snapshot)

        with pytest.raises(RuntimeError, match="failed before router"):
            await graph.ainvoke(_initial_state())

        assert calls == ["node-1"]

    @pytest.mark.asyncio
    async def test_direct_router_failure_takes_recovery_not_normal_branch(self, monkeypatch):
        snapshot = load_fixture("recovery_branch.json")
        snapshot["control_edges"] = [edge for edge in snapshot["control_edges"] if edge["id"] != "e5"]
        calls = []

        async def step(node_id, _node, _state, node_inputs=None):
            calls.append(node_id)
            if node_id == "node-2":
                raise RuntimeError("risky step failed")
            return {"task_outputs": {(node_id, 0): "ok"}}

        monkeypatch.setitem(NODE_KIND_DISPATCH, "step", step)
        result = await compose(snapshot).ainvoke(_initial_state())

        assert calls == ["node-1", "node-2", "node-4"]
        assert result["router_decisions"]["node-3"] == "__error__"


def _initial_state() -> dict:
    return {
        "execution_id": "exec-1",
        "flow_id": "flow-1",
        "inputs": {},
        "task_outputs": {},
        "iterations": {},
        "router_decisions": {},
        "errors": [],
        "cancelled": False,
    }
