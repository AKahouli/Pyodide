"""Tests for conditional topology graph building."""

import json
from pathlib import Path

import pytest
from langgraph.graph import END

from src.flow_engine import builder as builder_module
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

    def test_compose_pure_cycle_starts_at_loop_head(self):
        # Every node has an incoming edge (router feedback loop with no
        # outside entry). The loop head — no incoming *sequential* edge —
        # becomes the START target instead of raising "must have an entrypoint".
        snapshot = {
            "nodes": [
                {"id": "a", "kind": "step", "label": "Assemble"},
                {"id": "b", "kind": "human_approval", "label": "Validate"},
                {
                    "id": "c",
                    "kind": "router",
                    "label": "Decide",
                    "router_config": {"output_labels": ["approve", "feedback"]},
                },
            ],
            "control_edges": [
                {"id": "e1", "kind": "sequential", "source": "a", "target": "b"},
                {"id": "e2", "kind": "sequential", "source": "b", "target": "c"},
                {"id": "e3", "kind": "conditional", "source": "c", "target": "a", "router_label": "feedback"},
            ],
            "data_bindings": [],
            "settings": {"recursion_limit": 25, "max_parallelism": 5},
        }
        graph = compose(snapshot)
        assert {"a", "b", "c"} <= set(graph.nodes)
        starts = [e for e in graph.get_graph().edges if e.source == "__start__"]
        assert [e.target for e in starts] == ["a"]


def _mixed_join_snapshot(*, with_binding: bool) -> dict:
    """User-reported topology: router gates s4, s1 also feeds s4 data."""
    edges = [
        {"id": "e1", "kind": "sequential", "source": "s1", "target": "router"},
        {
            "id": "e2", "kind": "sequential", "source": "s1", "target": "s4",
            "source_output_port_id": "out-2", "target_input_port_id": "in-2",
        },
        {"id": "e3", "kind": "conditional", "source": "router", "target": "s3", "router_label": "message"},
        {"id": "e4", "kind": "conditional", "source": "router", "target": "s4", "router_label": "salute"},
    ]
    bindings = [{
        "id": "db-1", "source_kind": "node-output", "source_node": "s1", "source_port": "out-2",
        "target_node": "s4", "target_port": "in-2", "iteration": "current",
    }] if with_binding else []
    return {
        "nodes": [
            {"id": "s1", "kind": "step"},
            {"id": "router", "kind": "router", "router_config": {"output_labels": ["message", "salute"]}},
            {"id": "s3", "kind": "step"},
            {"id": "s4", "kind": "step"},
        ],
        "control_edges": edges,
        "data_bindings": bindings,
        "settings": {"recursion_limit": 25, "max_parallelism": 5},
    }


class TestMixedJoinGating:
    @pytest.fixture(autouse=True)
    def _stub_nodes(self, monkeypatch):
        started = []

        async def step(node_id, node, state, node_inputs=None):
            started.append(node_id)
            return {"task_outputs": {(node_id, 0): {"output": node_id}}}

        async def router(node_id, node, state, node_inputs=None):
            started.append(node_id)
            decision = state.get("inputs", {}).get("decision", "message")
            return {"router_decisions": {node_id: decision}}

        monkeypatch.setitem(builder_module.NODE_KIND_DISPATCH, "step", step)
        monkeypatch.setitem(builder_module.NODE_KIND_DISPATCH, "router", router)
        monkeypatch.setitem(builder_module.NODE_KIND_DISPATCH, "human_approval", step)
        yield started

    @pytest.mark.asyncio
    @pytest.mark.parametrize("decision,expected", [
        ("message", {"s1", "router", "s3"}),
        ("salute", {"s1", "router", "s4"}),
    ])
    async def test_binding_mirror_is_gated_by_router(self, _stub_nodes, decision, expected):
        # Data arriving from s1 must not start s4; only the selected branch does.
        graph = compose(_mixed_join_snapshot(with_binding=True))
        await graph.ainvoke({"inputs": {"decision": decision}, "task_outputs": {}, "iterations": {}, "router_decisions": {}, "errors": []})
        assert set(_stub_nodes) == expected

    @pytest.mark.asyncio
    async def test_genuine_control_edge_without_binding_reaches_target(self, _stub_nodes):
        # No binding on s1→s4: the edge is genuine control, so s4 runs via the
        # direct route even when the router selects the other branch.
        graph = compose(_mixed_join_snapshot(with_binding=False))
        await graph.ainvoke({"inputs": {"decision": "message"}, "task_outputs": {}, "iterations": {}, "router_decisions": {}, "errors": []})
        assert "s4" in _stub_nodes

    @pytest.mark.asyncio
    async def test_retry_loop_binding_mirror_keeps_first_entry(self, _stub_nodes):        # Loop-back topology: router downstream of s2 sends it back. The
        # mirrored s1→s2 edge stays control so the first entry still happens.
        snapshot = {
            "nodes": [
                {"id": "s1", "kind": "step"},
                {"id": "s2", "kind": "step"},
                {"id": "r", "kind": "router", "router_config": {"output_labels": ["retry", "done"]}},
                {"id": "s4", "kind": "step"},
            ],
            "control_edges": [
                {"id": "e1", "kind": "sequential", "source": "s1", "target": "s2",
                 "source_output_port_id": "out-1", "target_input_port_id": "in-1"},
                {"id": "e2", "kind": "sequential", "source": "s2", "target": "r",
                 "source_output_port_id": "out-2", "target_input_port_id": "in-2"},
                {"id": "e3", "kind": "conditional", "source": "r", "target": "s2", "router_label": "retry"},
                {"id": "e4", "kind": "conditional", "source": "r", "target": "s4", "router_label": "done"},
            ],
            "data_bindings": [
                {"id": "db-1", "source_kind": "node-output", "source_node": "s1", "source_port": "out-1",
                 "target_node": "s2", "target_port": "in-1"},
                {"id": "db-2", "source_kind": "node-output", "source_node": "s2", "source_port": "out-2",
                 "target_node": "r", "target_port": "in-2"},
            ],
            "settings": {"recursion_limit": 25, "max_parallelism": 5},
        }
        graph = compose(snapshot)
        await graph.ainvoke({"inputs": {"decision": "done"}, "task_outputs": {}, "iterations": {}, "router_decisions": {}, "errors": []})
        assert set(_stub_nodes) == {"s1", "s2", "r", "s4"}

    @pytest.mark.asyncio
    async def test_genuine_parallel_edge_on_other_ports_still_fires(self, _stub_nodes):
        # Same node pair, two edges: one mirrored (suppressed), one genuine
        # control on different ports. The genuine edge must still trigger s4.
        snapshot = _mixed_join_snapshot(with_binding=True)
        snapshot["control_edges"].append({
            "id": "e5", "kind": "sequential", "source": "s1", "target": "s4",
            "source_output_port_id": "out-3", "target_input_port_id": "in-3",
        })
        graph = compose(snapshot)
        await graph.ainvoke({"inputs": {"decision": "message"}, "task_outputs": {}, "iterations": {}, "router_decisions": {}, "errors": []})
        assert "s4" in _stub_nodes

    @pytest.mark.asyncio
    async def test_legacy_absent_ports_match_default_binding_ports(self, _stub_nodes):
        # Legacy snapshot: edge carries no port ids, binding uses 'default'.
        # Normalization must still recognize the mirror and gate s4.
        snapshot = _mixed_join_snapshot(with_binding=True)
        mirror = snapshot["control_edges"][1]
        mirror.pop("source_output_port_id")
        mirror.pop("target_input_port_id")
        snapshot["data_bindings"][0]["source_port"] = "default"
        snapshot["data_bindings"][0]["target_port"] = "default"
        graph = compose(snapshot)
        await graph.ainvoke({"inputs": {"decision": "message"}, "task_outputs": {}, "iterations": {}, "router_decisions": {}, "errors": []})
        assert "s4" not in _stub_nodes
