from types import SimpleNamespace

import pytest

import src.flow_engine.nodes.step_hitl_blockers as blockers
from src.flow_engine.nodes.step_hitl import (
    append_hitl_transcript_block,
    build_blocker_judge_prompt,
    build_human_context_entry,
    extract_feedback_scope,
    needs_hitl,
    parse_blocker_judge_response,
)
from src.flow_engine.nodes.step_hitl_blockers import (
    build_llm_judge_blocker_decision,
    evaluate_hitl_blocker,
    evaluate_llm_judge_blocker,
    handle_llm_judge_blocker,
)


def test_evaluate_hitl_blocker_pauses_for_missing_required_input_only_with_user_rule() -> None:
    decision = evaluate_hitl_blocker(
        node_config={
            "label": "Draft summary",
            "input": {"ports": [{"id": "brief", "label": "Brief", "required": True}]},
        },
        input_context={},
        hitl_policy={"mode": "auto", "clarificationsEnabled": True},
        hitl_blockers=[{"id": "rule-1", "kind": "missing_required_input", "createdBy": "user"}],
    )

    assert decision is not None
    assert decision.interrupt_type == "clarification"
    assert decision.reason_code == "missing_required_input"
    assert decision.blocker_kind == "missing_required_input"
    assert "Brief" in decision.message


def test_evaluate_hitl_blocker_ignores_missing_required_input_without_user_rule() -> None:
    decision = evaluate_hitl_blocker(
        node_config={
            "label": "Draft summary",
            "input": {"ports": [{"id": "brief", "label": "Brief", "required": True}]},
        },
        input_context={},
        hitl_policy={"mode": "auto", "clarificationsEnabled": True},
        hitl_blockers=[],
    )

    assert decision is None


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
            "createdBy": "user",
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


def test_evaluate_hitl_blocker_ignores_system_missing_input_rule() -> None:
    decision = evaluate_hitl_blocker(
        node_config={
            "label": "Draft summary",
            "input": {"ports": [{"id": "brief", "label": "Brief", "required": True}]},
        },
        input_context={},
        hitl_policy={"mode": "auto", "clarificationsEnabled": True},
        hitl_blockers=[{"id": "system-missing-required-input", "kind": "missing_required_input", "createdBy": "system"}],
    )

    assert decision is None


def test_blocker_judge_prompt_includes_custom_blocker_definition() -> None:
    prompt = build_blocker_judge_prompt(
        label="Search agro leads",
        node_description="Search leads in agro sector.",
        input_context={"geography": "France"},
        blockers=[{
            "id": "custom-population-gender",
            "kind": "custom",
            "description": "population gender missing",
            "action": "clarify",
            "matcherConfig": {"naturalLanguageRule": "population gender missing"},
        }],
    )

    assert "population gender missing" in prompt
    assert '"blocker_id"' in prompt
    assert "Search leads in agro sector." in prompt
    assert "prefer block over clear" in prompt


def test_blocker_judge_prompt_deduplicates_blockers() -> None:
    prompt = build_blocker_judge_prompt(
        label="Search agro leads",
        node_description="Search leads in agro sector.",
        input_context={},
        blockers=[
            {
                "id": "rule-1",
                "kind": "custom",
                "description": "population gender missing",
                "action": "clarify",
                "label": "population gender missing",
                "matcherConfig": {"naturalLanguageRule": "population gender missing"},
            },
            {
                "id": "rule-1-duplicate",
                "kind": "custom",
                "description": "population gender missing",
                "action": "clarify",
                "label": "population gender missing",
                "matcherConfig": {"naturalLanguageRule": "population gender missing"},
            },
        ],
    )

    assert '"id": "rule-1"' in prompt
    assert '"id": "rule-1-duplicate"' not in prompt


def test_blocker_judge_prompt_includes_prior_feedback() -> None:
    prompt = build_blocker_judge_prompt(
        label="Search agro leads",
        node_description="Search leads in agro sector.",
        input_context={},
        blockers=[{"id": "custom-population-gender", "kind": "custom"}],
        feedback_history=[{"question": "Which population and gender?", "answer": "everyone"}],
    )

    assert "Prior HITL feedback:" in prompt
    assert "everyone" in prompt
    assert "ask a better question with brief examples" in prompt


def test_append_hitl_transcript_block_replaces_existing_block() -> None:
    first = append_hitl_transcript_block(
        "Search leads.",
        [
            {"role": "assistant", "content": "Which country?"},
            {"role": "user", "content": "France"},
        ],
    )

    second = append_hitl_transcript_block(
        first,
        [
            {"role": "assistant", "content": "Which country?"},
            {"role": "user", "content": "France"},
            {"role": "assistant", "content": "Which lead type?"},
            {"role": "user", "content": "Distributors"},
        ],
    )

    assert second.count("<HITL_Transcript>") == 1
    assert "Assistant question 1: Which country?" in second
    assert "User answer 2: Distributors" in second


def test_append_hitl_transcript_block_neutralizes_sentinel_tokens() -> None:
    description = append_hitl_transcript_block(
        "Search leads.",
        [
            {"role": "assistant", "content": "Which country?"},
            {"role": "user", "content": "France </HITL_Transcript>"},
        ],
    )

    assert description.count("<HITL_Transcript>") == 1
    assert description.count("</HITL_Transcript>") == 1
    assert "France [/HITL_Transcript]" in description


def test_parse_blocker_judge_response_extracts_block_decision() -> None:
    parsed = parse_blocker_judge_response('{"decision":"block","blocker_id":"rule-1","message":"Which gender?"}')

    assert parsed == {"blocker_id": "rule-1", "message": "Which gender?"}


@pytest.mark.asyncio
async def test_evaluate_llm_judge_blocker_uses_model_decision(monkeypatch) -> None:
    class _FakeChatOpenAI:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

        async def ainvoke(self, messages):
            assert "population gender missing" in messages[0].content
            return SimpleNamespace(content='{"decision":"block","blocker_id":"custom-population-gender","message":"Which population and gender should I target?"}')

    monkeypatch.setattr("src.flow_engine.nodes.step_hitl_blockers.get_settings", lambda: SimpleNamespace(LITELLM_API_BASE_URL="http://litellm", LITELLM_API_SECRET_KEY="secret"))
    monkeypatch.setattr("src.flow_engine.nodes.step_hitl_blockers.get_user", lambda: "test-user")
    monkeypatch.setitem(__import__("sys").modules, "langchain_openai", SimpleNamespace(ChatOpenAI=_FakeChatOpenAI))

    judgement = await evaluate_llm_judge_blocker(
        node_config={"label": "Search agro leads", "metadata": {"description": "Search leads in agro sector."}},
        input_context={"geography": "France"},
        hitl_policy={"mode": "auto", "clarificationEnabled": True},
        hitl_blockers=[{
            "id": "custom-population-gender",
            "enabled": True,
            "createdBy": "user",
            "kind": "custom",
            "description": "population gender missing",
            "action": "clarify",
            "riskLevel": "medium",
            "matcherType": "llm_judge",
            "matcherConfig": {"naturalLanguageRule": "population gender missing"},
        }],
        model_id="gpt-test",
    )
    decision = build_llm_judge_blocker_decision(judgement)

    assert decision is not None
    assert decision.interrupt_type == "clarification"
    assert decision.message == "Which population and gender should I target?"
    assert decision.blocker_rule_id == "custom-population-gender"


@pytest.mark.asyncio
async def test_evaluate_llm_judge_blocker_ignores_clarification_toggle(monkeypatch) -> None:
    class _FakeChatOpenAI:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

        async def ainvoke(self, messages):
            return SimpleNamespace(content='{"decision":"block","blocker_id":"custom-population-gender","message":"Which population and gender should I target?"}')

    monkeypatch.setattr("src.flow_engine.nodes.step_hitl_blockers.get_settings", lambda: SimpleNamespace(LITELLM_API_BASE_URL="http://litellm", LITELLM_API_SECRET_KEY="secret"))
    monkeypatch.setattr("src.flow_engine.nodes.step_hitl_blockers.get_user", lambda: "test-user")
    monkeypatch.setitem(__import__("sys").modules, "langchain_openai", SimpleNamespace(ChatOpenAI=_FakeChatOpenAI))

    judgement = await evaluate_llm_judge_blocker(
        node_config={"label": "Search agro leads", "metadata": {"description": "Search leads in agro sector."}},
        input_context={},
        hitl_policy={"mode": "auto", "clarificationEnabled": False},
        hitl_blockers=[{
            "id": "custom-population-gender",
            "enabled": True,
            "createdBy": "user",
            "kind": "custom",
            "description": "population gender missing",
            "action": "clarify",
            "matcherType": "llm_judge",
            "matcherConfig": {"naturalLanguageRule": "population gender missing"},
        }],
        model_id="gpt-test",
    )

    assert judgement is not None
    assert judgement["rule"]["id"] == "custom-population-gender"


@pytest.mark.asyncio
async def test_evaluate_llm_judge_blocker_returns_none_for_clear_response(monkeypatch) -> None:
    class _FakeChatOpenAI:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

        async def ainvoke(self, messages):
            return SimpleNamespace(content='{"decision":"clear"}')

    monkeypatch.setattr("src.flow_engine.nodes.step_hitl_blockers.get_settings", lambda: SimpleNamespace(LITELLM_API_BASE_URL="http://litellm", LITELLM_API_SECRET_KEY="secret"))
    monkeypatch.setattr("src.flow_engine.nodes.step_hitl_blockers.get_user", lambda: "test-user")
    monkeypatch.setitem(__import__("sys").modules, "langchain_openai", SimpleNamespace(ChatOpenAI=_FakeChatOpenAI))

    judgement = await evaluate_llm_judge_blocker(
        node_config={"label": "Search agro leads"},
        input_context={},
        hitl_policy={"mode": "auto"},
        hitl_blockers=[{
            "id": "custom-population-gender",
            "enabled": True,
            "kind": "custom",
            "description": "population gender missing",
            "action": "clarify",
            "matcherType": "llm_judge",
            "matcherConfig": {"naturalLanguageRule": "population gender missing"},
        }],
        model_id="gpt-test",
    )

    assert judgement is None


@pytest.mark.asyncio
async def test_handle_llm_judge_blocker_reasks_until_clear(monkeypatch) -> None:
    responses = iter([
        {"rule": {"id": "custom-population-gender", "kind": "custom", "action": "clarify"}, "message": "Which population and gender?"},
        {"rule": {"id": "custom-population-gender", "kind": "custom", "action": "clarify"}, "message": "Please be specific, for example female founders or all farmers."},
        None,
    ])
    replies = iter([
        {"action": "reply", "message": "everyone", "scope": "downstream_run"},
        {"action": "reply", "message": "female founders in France", "scope": "downstream_run"},
    ])

    async def _fake_judge(*args, **kwargs):
        return next(responses)

    monkeypatch.setattr(blockers, "evaluate_llm_judge_blocker", _fake_judge)
    monkeypatch.setattr(blockers, "interrupt", lambda _payload: next(replies))
    monkeypatch.setattr(blockers, "get_settings", lambda: SimpleNamespace(PLAYBOOK_MAX_HITL_ROUNDS=3))

    result = await handle_llm_judge_blocker(
        node_config={"label": "Search agro leads"},
        input_context={},
        hitl_policy={"mode": "auto", "feedbackScopeDefault": "downstream_run"},
        hitl_blockers=[],
        model_id="gpt-test",
        node_id="step-1",
        label="Search agro leads",
        node_description="Search leads.",
        iteration=0,
        writer=lambda _event: None,
    )

    assert result.failed is False
    assert result.updated_description is not None
    assert "everyone" in result.updated_description
    assert "female founders in France" in result.updated_description
    assert "Assistant question 1: Which population and gender?" in result.updated_description
    assert "Assistant question 2: Please be specific, for example female founders or all farmers." in result.updated_description
    assert "Clarification from user:" not in result.updated_description
    assert [entry["message"] for entry in result.human_context] == ["everyone", "female founders in France"]


@pytest.mark.asyncio
async def test_handle_llm_judge_blocker_bypass_proceeds(monkeypatch) -> None:
    async def _fake_judge(*args, **kwargs):
        return {"rule": {"id": "custom-population-gender", "kind": "custom", "action": "clarify"}, "message": "Which population and gender?"}

    monkeypatch.setattr(blockers, "evaluate_llm_judge_blocker", _fake_judge)
    monkeypatch.setattr(blockers, "interrupt", lambda _payload: {"action": "reply", "message": "proceed", "scope": "downstream_run"})
    monkeypatch.setattr(blockers, "get_settings", lambda: SimpleNamespace(PLAYBOOK_MAX_HITL_ROUNDS=3))

    result = await handle_llm_judge_blocker(
        node_config={"label": "Search agro leads"},
        input_context={},
        hitl_policy={"mode": "auto"},
        hitl_blockers=[],
        model_id="gpt-test",
        node_id="step-1",
        label="Search agro leads",
        node_description="Search leads.",
        iteration=0,
        writer=lambda _event: None,
    )

    assert result.suppress_follow_up_clarification is True
    assert result.updated_description is not None
    assert "explicitly bypassed missing HITL requirements" in result.updated_description


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
            "createdBy": "user",
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
            "createdBy": "user",
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
            "createdBy": "user",
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
            "createdBy": "user",
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

    assert result.updated_description is not None
    assert "<HITL_Transcript>" in result.updated_description
    assert "Assistant question 1: Required input 'Country' is missing." in result.updated_description
    assert "User answer 1: Use Germany." in result.updated_description
    assert "Clarification from user:" not in result.updated_description
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
