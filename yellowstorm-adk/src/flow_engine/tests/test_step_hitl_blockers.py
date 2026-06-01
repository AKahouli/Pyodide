import src.flow_engine.nodes.step_hitl_blockers as blockers
from src.flow_engine.nodes.step_hitl import build_human_context_entry, extract_feedback_scope, needs_hitl
from src.flow_engine.nodes.step_hitl_blockers import evaluate_hitl_blocker


def test_evaluate_hitl_blocker_pauses_for_missing_required_input() -> None:
    decision = evaluate_hitl_blocker(
        node_config={
            "label": "Draft summary",
            "input": {"ports": [{"id": "brief", "label": "Brief", "required": True}]},
        },
        input_context={},
        hitl_policy={"mode": "auto", "clarificationsEnabled": True},
        hitl_blockers=[],
    )

    assert decision is not None
    assert decision.interrupt_type == "clarification"
    assert decision.reason_code == "missing_required_input"
    assert decision.blocker_kind == "missing_required_input"
    assert "Brief" in decision.message


def test_evaluate_hitl_blocker_ignores_auto_when_policy_is_not_auto() -> None:
    decision = evaluate_hitl_blocker(
        node_config={
            "label": "Draft summary",
            "input": {"ports": [{"id": "brief", "label": "Brief", "required": True}]},
        },
        input_context={},
        hitl_policy={"mode": "assist"},
        hitl_blockers=[],
    )

    assert decision is None


def test_needs_hitl_keeps_explicit_clarification_when_smart_hitl_is_off() -> None:
    assert needs_hitl({"allowClarification": True, "hitlPolicy": {"mode": "off"}}) is True


def test_evaluate_hitl_blocker_pauses_for_explicit_approval_rule() -> None:
    decision = evaluate_hitl_blocker(
        node_config={
            "label": "Send email",
            "description": "Send the final message to the customer.",
        },
        input_context={},
        hitl_policy={"mode": "auto", "approvalsEnabled": True},
        hitl_blockers=[{
            "id": "rule-1",
            "kind": "explicit_human_request",
            "matcher": {"type": "contains", "pattern": "final message"},
            "message": "Approve the customer-facing email.",
            "riskLevel": "high",
        }],
    )

    assert decision is not None
    assert decision.interrupt_type == "approval_request"
    assert decision.blocker_rule_id == "rule-1"
    assert decision.risk_level == "high"
    assert decision.message == "Approve the customer-facing email."


def test_evaluate_hitl_blocker_respects_disabled_approvals_for_instruction_rule() -> None:
    decision = evaluate_hitl_blocker(
        node_config={
            "label": "Send email",
            "description": "Send the final message to the customer.",
        },
        input_context={},
        hitl_policy={"mode": "auto", "approvalsEnabled": False},
        hitl_blockers=[{
            "id": "system-explicit-user-instruction",
            "kind": "explicit_user_instruction",
            "matcherConfig": {"phrases": ["final message"]},
        }],
    )

    assert decision is None


def test_evaluate_hitl_blocker_defers_explicit_clarification_instruction_to_llm_question() -> None:
    decision = evaluate_hitl_blocker(
        node_config={
            "label": "Search agro leads",
            "description": "Search leads in agro sector, ask the user for clarifications.",
        },
        input_context={},
        hitl_policy={"mode": "auto", "clarificationEnabled": True},
        hitl_blockers=[],
    )

    assert decision is None


def test_evaluate_hitl_blocker_does_not_preempt_step_prompt_clarification_instruction() -> None:
    decision = evaluate_hitl_blocker(
        node_config={
            "label": "Search agro leads",
            "input": {"raw": "Search leads in agro sector, ask the user for clarifications."},
        },
        input_context={},
        hitl_policy={"mode": "auto", "clarificationEnabled": True},
        hitl_blockers=[],
    )

    assert decision is None


def test_evaluate_hitl_blocker_pauses_for_destructive_action_rule() -> None:
    decision = evaluate_hitl_blocker(
        node_config={
            "label": "Clean archive",
            "selectedAction": "delete",
        },
        input_context={},
        hitl_policy={"mode": "auto", "approvalsEnabled": True},
        hitl_blockers=[{
            "id": "system-destructive-action",
            "kind": "destructive_action",
            "riskLevel": "critical",
            "matcherConfig": {"verbs": ["delete", "purge"]},
        }],
    )

    assert decision is not None
    assert decision.interrupt_type == "approval_request"
    assert decision.reason_code == "destructive_action"
    assert decision.blocker_rule_id == "system-destructive-action"


def test_evaluate_hitl_blocker_pauses_for_external_connector_action() -> None:
    decision = evaluate_hitl_blocker(
        node_config={
            "label": "Notify customer",
            "selectedAction": "send_email",
            "metadata": {
                "connector_bindings": [{
                    "connector_id": "mail",
                    "actions": [{"action_key": "send_email"}],
                }],
            },
        },
        input_context={},
        hitl_policy={"mode": "auto", "approvalsEnabled": True},
        hitl_blockers=[{
            "id": "system-external-send",
            "kind": "external_send",
            "riskLevel": "critical",
            "appliesToConnectorActions": ["send"],
        }],
    )

    assert decision is not None
    assert decision.interrupt_type == "approval_request"
    assert decision.reason_code == "external_send"
    assert decision.blocker_rule_id == "system-external-send"


def test_evaluate_hitl_blocker_does_not_match_action_rules_on_label_only() -> None:
    decision = evaluate_hitl_blocker(
        node_config={"label": "Send summary draft"},
        input_context={},
        hitl_policy={"mode": "auto", "approvalsEnabled": True},
        hitl_blockers=[{
            "id": "system-external-send",
            "kind": "external_send",
            "riskLevel": "critical",
            "appliesToConnectorActions": ["send"],
        }],
    )

    assert decision is None


def test_evaluate_hitl_blocker_does_not_match_when_multiple_bound_actions_exist_without_selection() -> None:
    decision = evaluate_hitl_blocker(
        node_config={
            "label": "Draft follow-up",
            "metadata": {
                "connector_bindings": [{
                    "connector_id": "mail",
                    "actions": [
                        {"action_key": "send_email"},
                        {"action_key": "delete_draft"},
                    ],
                }],
            },
        },
        input_context={},
        hitl_policy={"mode": "auto", "approvalsEnabled": True},
        hitl_blockers=[{
            "id": "system-destructive-action",
            "kind": "destructive_action",
            "riskLevel": "critical",
            "matcherConfig": {"verbs": ["delete"]},
        }],
    )

    assert decision is None


def test_build_human_context_entry_requires_non_step_scope() -> None:
    entry = build_human_context_entry(
        {"message": "Use Germany for the rest of the run.", "scope": "downstream_run", "remember": True},
        node_id="step-1",
        label="Collect country",
        interrupt_type="clarification",
        message="Which country?",
        default_scope="step_only",
    )

    assert entry == {
        "node_id": "step-1",
        "task_title": "Collect country",
        "interrupt_type": "clarification",
        "message": "Use Germany for the rest of the run.",
        "scope": "downstream_run",
        "remember": True,
        "source_message": "Which country?",
    }


def test_extract_feedback_scope_accepts_all_backend_scopes() -> None:
    for scope in ("step_only", "downstream_run", "entire_run", "future_node_runs", "future_workflow_runs"):
        assert extract_feedback_scope({"scope": scope}) == scope


def test_build_human_context_entry_accepts_entire_run_scope() -> None:
    entry = build_human_context_entry(
        {"message": "Use Germany for all remaining steps.", "scope": "entire_run"},
        node_id="step-1",
        label="Collect country",
        interrupt_type="clarification",
        message="Which country?",
        default_scope="step_only",
    )

    assert entry is not None
    assert entry["scope"] == "entire_run"
    assert entry["message"] == "Use Germany for all remaining steps."


def test_build_human_context_entry_excludes_future_memory_scopes() -> None:
    for scope in ("step_only", "future_node_runs", "future_workflow_runs"):
        entry = build_human_context_entry(
            {"message": "Use Germany later.", "scope": scope, "remember": True},
            node_id="step-1",
            label="Collect country",
            interrupt_type="clarification",
            message="Which country?",
            default_scope="step_only",
        )

        assert entry is None


def test_handle_smart_hitl_blocker_returns_human_context(monkeypatch) -> None:
    decision = blockers.HitlBlockerDecision(
        interrupt_type="clarification",
        message="Required input 'Country' is missing.",
        reason_code="missing_required_input",
        risk_level="medium",
        blocker_kind="missing_required_input",
    )
    monkeypatch.setattr(
        blockers,
        "interrupt",
        lambda _payload: {"action": "reply", "message": "Use Germany.", "scope": "downstream_run"},
    )

    result = blockers.handle_smart_hitl_blocker(
        decision,
        node_id="step-1",
        label="Collect country",
        node_description="",
        iteration=0,
        writer=lambda _event: None,
        hitl_policy={"feedbackScopeDefault": "downstream_run"},
    )

    assert result.updated_description == "\n\nClarification from user: Use Germany."
    assert result.human_context[0]["message"] == "Use Germany."
    assert result.human_context[0]["scope"] == "downstream_run"


def test_handle_smart_hitl_blocker_honors_ignore_reply(monkeypatch) -> None:
    decision = blockers.HitlBlockerDecision(
        interrupt_type="clarification",
        message="Required input 'Country' is missing.",
        reason_code="missing_required_input",
        risk_level="medium",
        blocker_kind="missing_required_input",
    )
    monkeypatch.setattr(
        blockers,
        "interrupt",
        lambda _payload: {"action": "reply", "message": "ignore these criterias", "scope": "downstream_run"},
    )

    result = blockers.handle_smart_hitl_blocker(
        decision,
        node_id="step-1",
        label="Collect country",
        node_description="Search leads.",
        iteration=0,
        writer=lambda _event: None,
        hitl_policy={"feedbackScopeDefault": "downstream_run"},
    )

    assert result.failed is False
    assert result.updated_description is not None
    assert "Proceed with the available information" in result.updated_description
    assert result.suppress_follow_up_clarification is True


def test_handle_smart_hitl_blocker_uses_step_only_for_sensitive_approvals(monkeypatch) -> None:
    decision = blockers.HitlBlockerDecision(
        interrupt_type="approval_request",
        message="Approve sending to customer.",
        reason_code="external_send",
        risk_level="critical",
        blocker_kind="external_send",
        blocker_rule_id="rule-1",
    )
    payload_by_interrupt: dict[str, object] = {}

    monkeypatch.setattr(
        blockers,
        "interrupt",
        lambda payload: payload_by_interrupt.update(payload) or {"action": "approve"},
    )

    result = blockers.handle_smart_hitl_blocker(
        decision,
        node_id="step-1",
        label="Notify customer",
        node_description="",
        iteration=0,
        writer=lambda _event: None,
        hitl_policy={"feedbackScopeDefault": "downstream_run", "approvalEnabled": True},
    )

    assert result.updated_description is None
    assert result.failed is False
    # Sensitive approvals should force step-only scope unless user-supplied scope is present.
    assert payload_by_interrupt.get("feedback_scope_default") == "step_only"


def test_policy_allows_uses_current_policy_keys() -> None:
    assert blockers._policy_allows({"clarificationEnabled": False}, "clarificationEnabled") is False
    assert blockers._policy_allows({"approvalEnabled": True}, "approvalsEnabled") is True
