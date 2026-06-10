import json

import pytest

from src.flow_engine.nodes import step_tools


def test_tool_hitl_approval_allows_approved_risky_action(monkeypatch) -> None:
    events: list[dict] = []
    monkeypatch.setattr(step_tools, "interrupt", lambda _payload: {"action": "approve"})

    result = step_tools._resolve_tool_hitl_approval(
        tool_name="gmail_send_email",
        tool_arguments={"to": "customer@example.com"},
        context=step_tools.ToolHitlApprovalContext(
            hitl_policy={"mode": "auto", "approvalEnabled": True},
                hitl_blockers=[{
                    "id": "external-send",
                    "kind": "external_send",
                    "createdBy": "user",
                    "appliesToConnectorActions": ["send_email"],
                }],
            node_id="step-1",
            label="Notify customer",
            iteration=0,
            writer=events.append,
        ),
    )

    assert result is None
    assert events[0]["type"] == "NodeSuspended"
    assert events[0]["payload"]["feedback_scope_default"] == "step_only"


def test_tool_hitl_approval_returns_skip_result_for_skipped_action(monkeypatch) -> None:
    monkeypatch.setattr(step_tools, "interrupt", lambda _payload: {"action": "skip"})

    result = step_tools._resolve_tool_hitl_approval(
        tool_name="workspace_delete_document",
        tool_arguments={"document_id": "doc-1"},
        context=step_tools.ToolHitlApprovalContext(
            hitl_policy={"mode": "auto", "approvalsEnabled": True},
                hitl_blockers=[{
                    "id": "destructive",
                    "kind": "destructive_action",
                    "createdBy": "user",
                    "matcherConfig": {"verbs": ["delete"]},
                }],
            node_id="step-1",
            label="Clean workspace",
            iteration=0,
            writer=lambda _event: None,
        ),
    )

    assert json.loads(result or "{}") == {
        "status": "skipped_by_human",
        "tool": "workspace_delete_document",
    }


def test_tool_hitl_approval_rejects_risky_action(monkeypatch) -> None:
    monkeypatch.setattr(
        step_tools,
        "interrupt",
        lambda _payload: {"action": "reject", "message": "Do not send externally."},
    )

    with pytest.raises(PermissionError, match="Do not send externally"):
        step_tools._resolve_tool_hitl_approval(
            tool_name="external_webhook_post",
            tool_arguments={"url": "https://example.test/hook"},
            context=step_tools.ToolHitlApprovalContext(
                hitl_policy={"mode": "auto", "approvalEnabled": True},
                hitl_blockers=[{
                    "id": "webhook",
                    "kind": "external_send",
                    "createdBy": "user",
                    "matcherConfig": {"verbs": ["webhook"]},
                }],
                node_id="step-1",
                label="Call webhook",
                iteration=0,
                writer=lambda _event: None,
            ),
        )


def test_tool_hitl_approval_ignores_non_matching_action(monkeypatch) -> None:
    def fail_interrupt(_payload):
        raise AssertionError("interrupt should not be called")

    monkeypatch.setattr(step_tools, "interrupt", fail_interrupt)

    result = step_tools._resolve_tool_hitl_approval(
        tool_name="workspace_search",
        tool_arguments={"query": "leads"},
        context=step_tools.ToolHitlApprovalContext(
            hitl_policy={"mode": "auto", "approvalEnabled": True},
                hitl_blockers=[{
                    "id": "destructive",
                    "kind": "destructive_action",
                    "createdBy": "user",
                    "matcherConfig": {"verbs": ["delete"]},
                }],
            node_id="step-1",
            label="Search",
            iteration=0,
            writer=lambda _event: None,
        ),
    )

    assert result is None


def test_tool_hitl_approval_ignores_system_blockers(monkeypatch) -> None:
    def fail_interrupt(_payload):
        raise AssertionError("interrupt should not be called")

    monkeypatch.setattr(step_tools, "interrupt", fail_interrupt)

    result = step_tools._resolve_tool_hitl_approval(
        tool_name="workspace_delete_document",
        tool_arguments={"document_id": "doc-1"},
        context=step_tools.ToolHitlApprovalContext(
            hitl_policy={"mode": "auto", "approvalEnabled": True},
            hitl_blockers=[{
                "id": "system-destructive",
                "kind": "destructive_action",
                "createdBy": "system",
                "matcherConfig": {"verbs": ["delete"]},
            }],
            node_id="step-1",
            label="Search",
            iteration=0,
            writer=lambda _event: None,
        ),
    )

    assert result is None
