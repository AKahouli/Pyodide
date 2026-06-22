"""Tests for the gated workflow (Part 3, canonical §5.5).

The gated flow is a deterministic three-step Sequential workflow:
prepare → request_approval → execute. The Manager LlmAgent has
no direct access to gated tools; only the Sequential workflow
binds the execute step's tool after the backend returns approval.
"""
from __future__ import annotations

import sys

sys.path.insert(0, ".")
from tests._adk_stub import install_adk_stubs  # noqa: E402

install_adk_stubs()

from app.agents.gated import (  # noqa: E402
    GatedFlow,
    _StubSequentialAgent,
    build_approval_workflow_agent,
)


def _binding(task_id: str = "t1") -> dict:
    return {"taskId": task_id, "scopedToolRefs": [], "withheldToolRefs": []}


def test_approval_required_for_external_send():
    flow = GatedFlow(_binding(), "external_send")
    assert flow.is_approval_required() is True


def test_approval_required_for_budget_overrun():
    flow = GatedFlow(_binding(), "budget_overrun")
    assert flow.is_approval_required() is True


def test_no_approval_for_internal_category():
    flow = GatedFlow(_binding(), "internal_analysis")
    assert flow.is_approval_required() is False


def test_workflow_steps_are_prepare_request_execute():
    flow = GatedFlow(_binding(), "external_send")
    steps = [s["step"] for s in flow.build_workflow()]
    assert steps == ["prepare", "request_approval", "execute"]


def test_build_approval_workflow_agent_returns_stub_when_adk_unavailable():
    flow = GatedFlow(_binding(), "external_send")
    agent = build_approval_workflow_agent(flow)
    assert isinstance(agent, _StubSequentialAgent)
    assert agent.name == "worky_gated_t1"
    assert agent.workflow is flow


def test_gated_flow_task_id_is_carried_in_each_step():
    flow = GatedFlow(_binding("task-xyz"), "external_send")
    workflow = flow.build_workflow()
    for step in workflow:
        assert step["task_id"] == "task-xyz"
        assert step["category"] == "external_send"
