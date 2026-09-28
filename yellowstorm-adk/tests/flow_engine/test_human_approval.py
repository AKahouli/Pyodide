"""Tests for human-approval node and interrupt wiring."""

import json
from pathlib import Path

import pytest
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command

from src.flow_engine.builder import compose
from src.flow_engine.nodes.human_approval import (
    normalize_approval_resume,
    run_human_approval,
)
from src.flow_engine.runtime.events import emit_events


def load_fixture(name: str) -> dict:
    path = Path(__file__).parent / "fixtures" / name
    return json.loads(path.read_text())


class TestHumanApproval:
    @pytest.mark.asyncio
    async def test_approval_request_exposes_prompt_at_grpc_payload_root(self):
        async def stream():
            yield {"_mode": "custom", "_data": {
                "type": "ApprovalRequested", "node_id": "approval-1", "iteration": 0,
                "payload": {"node_id": "approval-1", "prompt": "Approve?"},
            }}

        events = [event async for event in emit_events("exec-1", stream())]
        assert events[0].payload.fields["prompt"].string_value == "Approve?"
        assert events[0].payload.fields["node_id"].string_value == "approval-1"

    def test_human_approval_node_detected(self):
        snapshot = load_fixture("human_approval.json")
        ha_nodes = [n for n in snapshot["nodes"] if n.get("kind") == "human_approval"]
        assert len(ha_nodes) == 1
        assert ha_nodes[0]["id"] == "node-2"

    def test_compose_with_human_approval(self):
        snapshot = load_fixture("human_approval.json")
        graph = compose(snapshot)
        assert graph is not None
        assert graph.interrupt_after_nodes == []

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
        assert result["task_outputs"][(ha_node["id"], 0)] == {
            "decision": "approved",
            "payload": {},
        }

    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            ("approved", {"decision": "approved", "payload": {}}),
            ({"decision": "reject"}, {"decision": "rejected", "payload": {}}),
            (
                {"decision": "approved", "payload": {"reason": "safe"}},
                {"decision": "approved", "payload": {"reason": "safe"}},
            ),
        ],
    )
    def test_normalize_approval_resume(self, value, expected):
        assert normalize_approval_resume(value) == expected

    def test_normalize_approval_resume_rejects_unknown_decision(self):
        with pytest.raises(ValueError, match="approved or rejected"):
            normalize_approval_resume({"decision": "skip"})

    @pytest.mark.asyncio
    async def test_one_resume_runs_downstream_without_second_continuation(self, monkeypatch):
        from src.flow_engine import builder as builder_module

        calls: list[str] = []

        async def fake_step(node_id, node_config, state, node_inputs=None):
            del node_config, node_inputs
            iteration = state["iterations"].get(node_id, 0)
            calls.append(node_id)
            return {
                "task_outputs": {(node_id, iteration): {"output": node_id}},
                "iterations": {node_id: iteration + 1},
            }

        monkeypatch.setitem(builder_module.NODE_KIND_DISPATCH, "step", fake_step)
        graph = compose(load_fixture("human_approval.json"), InMemorySaver())
        config = {"configurable": {"thread_id": "single-approval-resume"}}
        initial_state = {
            "execution_id": "single-approval-resume",
            "flow_id": "flow-approval",
            "inputs": {},
            "task_outputs": {},
            "iterations": {},
            "router_decisions": {},
            "errors": [],
            "pending_approval": None,
            "cancelled": False,
        }

        suspended = await graph.ainvoke(initial_state, config)
        assert len(suspended["__interrupt__"]) == 1
        assert calls == ["node-1"]

        completed = await graph.ainvoke(
            Command(resume={"decision": "approved", "payload": {}}),
            config,
        )
        assert calls == ["node-1", "node-3"]
        assert completed["task_outputs"][("node-2", 0)]["decision"] == "approved"
        assert (await graph.aget_state(config)).next == ()
