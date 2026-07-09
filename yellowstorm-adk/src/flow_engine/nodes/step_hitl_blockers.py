"""Smart HITL blocker evaluation for step nodes."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from langchain_core.messages import HumanMessage
from structlog import get_logger
from langgraph.types import interrupt

from src.config.settings import get_settings
from src.middleware.correlation import get_user
from src.flow_engine.nodes.step_hitl import (
    StepHitlResult,
    _build_interrupt_payload,
    append_hitl_transcript_block,
    build_blocker_judge_prompt,
    build_human_context_entry,
    extract_interrupt_message,
    normalize_interrupt_action,
    parse_blocker_judge_response,
    should_proceed_without_more_clarification,
)
from src.smart_rag.infrastructure.model_parameters import normalize_temperature_for_model

logger = get_logger(__name__)


@dataclass(frozen=True)
class HitlBlockerDecision:
    """Describes a deterministic pause before the LLM/tool execution starts."""

    interrupt_type: str
    message: str
    reason_code: str
    risk_level: str
    blocker_kind: str
    blocker_rule_id: str | None = None


def evaluate_hitl_blocker(
    node_config: dict[str, Any],
    input_context: dict[str, Any],
    hitl_policy: dict[str, Any],
    hitl_blockers: list[dict[str, Any]],
) -> HitlBlockerDecision | None:
    """Return the first deterministic Smart HITL blocker that applies."""

    if hitl_policy.get("mode") != "auto":
        return None
    rule = _matching_missing_input_rule(hitl_blockers)
    missing_input = _missing_required_input(node_config, input_context)
    if rule and missing_input and _policy_allows(hitl_policy, "clarificationsEnabled"):
        return HitlBlockerDecision(
            interrupt_type="clarification",
            message=str(rule.get("message") or rule.get("promptTemplate") or f"Required input '{missing_input}' is missing. Please provide it before this step runs."),
            reason_code=str(rule.get("reasonCode") or rule.get("reason_code") or "missing_required_input"),
            risk_level=str(rule.get("riskLevel") or rule.get("risk_level") or "medium"),
            blocker_kind="missing_required_input",
            blocker_rule_id=str(rule.get("id") or "") or None,
        )
    rule = _matching_action_rule(node_config, hitl_blockers)
    if rule and _policy_allows(hitl_policy, "approvalsEnabled"):
        return HitlBlockerDecision(
            interrupt_type="approval_request",
            message=str(rule.get("message") or rule.get("promptTemplate") or f"Task '{node_config.get('label') or 'step'}' needs approval."),
            reason_code=str(rule.get("reasonCode") or rule.get("reason_code") or rule.get("kind") or "approval_required"),
            risk_level=str(rule.get("riskLevel") or rule.get("risk_level") or "critical"),
            blocker_kind=str(rule.get("kind") or "destructive_action"),
            blocker_rule_id=str(rule.get("id") or "") or None,
        )
    rule = _matching_instruction_rule(node_config, hitl_blockers)
    if rule and _policy_allows(hitl_policy, "approvalsEnabled"):
        return HitlBlockerDecision(
            interrupt_type="approval_request",
            message=str(rule.get("message") or f"Task '{node_config.get('label') or 'step'}' needs approval."),
            reason_code=str(rule.get("reasonCode") or rule.get("reason_code") or "explicit_approval_required"),
            risk_level=str(rule.get("riskLevel") or rule.get("risk_level") or "medium"),
            blocker_kind=str(rule.get("kind") or "explicit_human_request"),
            blocker_rule_id=str(rule.get("id") or "") or None,
        )
    return None


async def evaluate_llm_judge_blocker(
    node_config: dict[str, Any],
    input_context: dict[str, Any],
    hitl_policy: dict[str, Any],
    hitl_blockers: list[dict[str, Any]],
    model_id: str,
    feedback_history: list[dict[str, str]] | None = None,
) -> dict[str, Any] | None:
    if hitl_policy.get("mode") != "auto":
        return None
    rules = [rule for rule in hitl_blockers if _is_llm_judge_rule(rule)]
    if not rules:
        return None

    from langchain_openai import ChatOpenAI

    settings = get_settings()
    prompt = build_blocker_judge_prompt(
        label=str(node_config.get("label") or "step"),
        node_description=_node_text(node_config),
        input_context=input_context,
        blockers=rules,
        feedback_history=feedback_history,
    )
    llm = ChatOpenAI(
        base_url=settings.LITELLM_API_BASE_URL,
        api_key=settings.LITELLM_API_SECRET_KEY,
        model=model_id,
        temperature=normalize_temperature_for_model(model_id, 0.0),
        model_kwargs={"user": get_user()},
    )
    try:
        response = await llm.ainvoke([HumanMessage(content=prompt)])
    except Exception as exc:
        logger.warning("[hitl] LLM blocker judge failed", error=str(exc))
        return None
    response_text = getattr(response, "content", "")
    judged = parse_blocker_judge_response(response_text)
    if not judged:
        logger.warning(
            "[hitl] LLM blocker judge returned no blocking decision",
            node_label=str(node_config.get("label") or "step"),
            blocker_ids=[str(rule.get("id") or "") for rule in rules],
            response=str(response_text)[:500],
        )
        return None
    rule = next((item for item in rules if str(item.get("id") or "") == judged["blocker_id"]), None)
    if not rule:
        logger.warning(
            "[hitl] LLM blocker judge returned unknown blocker",
            blocker_id=judged["blocker_id"],
            known_blocker_ids=[str(item.get("id") or "") for item in rules],
        )
        return None
    return {"rule": rule, "message": judged["message"]}


async def handle_llm_judge_blocker(
    node_config: dict[str, Any],
    input_context: dict[str, Any],
    hitl_policy: dict[str, Any],
    hitl_blockers: list[dict[str, Any]],
    model_id: str,
    node_id: str,
    label: str,
    node_description: str,
    iteration: int,
    writer: Any,
) -> StepHitlResult:
    result = StepHitlResult()
    max_rounds = max(int(getattr(get_settings(), "PLAYBOOK_MAX_HITL_ROUNDS", 5) or 0), 0)
    feedback_history: list[dict[str, str]] = []
    current_description = node_description
    for round_index in range(max_rounds):
        judgement = await evaluate_llm_judge_blocker(
            node_config, input_context, hitl_policy, hitl_blockers, model_id,
            feedback_history=feedback_history,
        )
        decision = build_llm_judge_blocker_decision(judgement)
        if decision is None:
            result.updated_description = current_description if feedback_history else None
            return result
        payload = _build_blocker_interrupt_payload(
            decision, node_id, label, current_description, iteration + round_index + 1, hitl_policy,
        )
        writer({"type": "NodeSuspended", "node_id": node_id, "iteration": iteration, "payload": payload})
        current_description = _record_blocker_reply(
            result, interrupt(payload), decision, current_description,
            feedback_history, node_id, label, hitl_policy,
        )
        if result.skipped or result.failed or result.suppress_follow_up_clarification:
            return result

    if feedback_history:
        transcript_description = append_hitl_transcript_block(
            current_description,
            _feedback_history_to_transcript(feedback_history),
        )
        result.updated_description = (
            f"{transcript_description}\n\n"
            "Clarification from system: The HITL round limit was reached. Proceed with the available information."
        )
        result.suppress_follow_up_clarification = True
    return result


def _build_blocker_interrupt_payload(
    decision: HitlBlockerDecision,
    node_id: str,
    label: str,
    node_description: str,
    round_number: int,
    hitl_policy: dict[str, Any],
) -> dict[str, Any]:
    return _build_interrupt_payload(
        decision.interrupt_type,
        decision.message,
        node_id=node_id,
        label=label,
        node_description=node_description,
        round_number=round_number,
        resumable_actions=_resumable_actions(decision.interrupt_type),
        reason_code=decision.reason_code,
        risk_level=decision.risk_level,
        feedback_scope_default=str(_default_feedback_scope(decision, hitl_policy)),
        blocker_rule_id=decision.blocker_rule_id,
        blocker_kind=decision.blocker_kind,
    )


def _record_blocker_reply(
    result: StepHitlResult,
    response: Any,
    decision: HitlBlockerDecision,
    node_description: str,
    feedback_history: list[dict[str, str]],
    node_id: str,
    label: str,
    hitl_policy: dict[str, Any],
) -> str:
    action = normalize_interrupt_action(response, decision.interrupt_type)
    if _finish_on_terminal_action(result, action, response):
        return node_description
    message = extract_interrupt_message(response)
    if not message:
        result.failed = True
        result.error_msg = "Clarification response was empty"
        return node_description
    if decision.interrupt_type == "clarification" and should_proceed_without_more_clarification(message):
        result.updated_description = _build_bypass_instruction(node_description)
        result.suppress_follow_up_clarification = True
        return node_description
    feedback_history.append({"question": decision.message, "answer": message})
    _append_context_entry(result, response, decision, node_id, label, hitl_policy)
    return _append_feedback_to_description(
        node_description,
        decision.interrupt_type,
        message,
        feedback_history,
    )


def _finish_on_terminal_action(result: StepHitlResult, action: str, response: Any) -> bool:
    if action == "skip":
        result.skipped = True
        return True
    if action == "reject":
        result.failed = True
        result.error_msg = extract_interrupt_message(response) or "Task blocked by human"
        return True
    return False


def _append_context_entry(
    result: StepHitlResult,
    response: Any,
    decision: HitlBlockerDecision,
    node_id: str,
    label: str,
    hitl_policy: dict[str, Any],
) -> None:
    context_entry = build_human_context_entry(
        response,
        node_id=node_id,
        label=label,
        interrupt_type=decision.interrupt_type,
        message=decision.message,
        default_scope=str(_default_feedback_scope(decision, hitl_policy)),
    )
    if context_entry:
        result.human_context.append(context_entry)


def _append_feedback_to_description(
    node_description: str,
    interrupt_type: str,
    message: str,
    feedback_history: list[dict[str, str]] | None = None,
) -> str:
    if interrupt_type == "clarification":
        return append_hitl_transcript_block(
            node_description,
            _feedback_history_to_transcript(feedback_history or []),
        )
    return f"{node_description}\n\nHuman Feedback: {message}"


def _feedback_history_to_transcript(feedback_history: list[dict[str, str]]) -> list[dict[str, str]]:
    transcript: list[dict[str, str]] = []
    for entry in feedback_history:
        question = str(entry.get("question") or "").strip()
        answer = str(entry.get("answer") or "").strip()
        if question:
            transcript.append({"role": "assistant", "content": question})
        if answer:
            transcript.append({"role": "user", "content": answer})
    return transcript


def _build_bypass_instruction(node_description: str) -> str:
    return (
        f"{node_description}\n\n"
        "Clarification from user: The user explicitly bypassed missing HITL requirements. "
        "Proceed with the available information, choose broad reasonable defaults for "
        "missing criteria, and produce the best possible final result now. Do not ask "
        "another clarification question."
    )


def build_llm_judge_blocker_decision(judgement: dict[str, Any] | None) -> HitlBlockerDecision | None:
    if not judgement:
        return None
    rule = judgement.get("rule")
    if not isinstance(rule, dict):
        return None
    return HitlBlockerDecision(
        interrupt_type="clarification" if str(rule.get("action") or "clarify") == "clarify" else "approval_request",
        message=str(judgement.get("message") or rule.get("promptTemplate") or rule.get("description") or "This step needs human input before continuing."),
        reason_code=str(rule.get("reasonCode") or rule.get("reason_code") or rule.get("kind") or "custom_llm_judge"),
        risk_level=str(rule.get("riskLevel") or rule.get("risk_level") or "medium"),
        blocker_kind=str(rule.get("kind") or "custom"),
        blocker_rule_id=str(rule.get("id") or "") or None,
    )


def handle_smart_hitl_blocker(
    decision: HitlBlockerDecision | None,
    node_id: str,
    label: str,
    node_description: str,
    iteration: int,
    writer: Any,
    hitl_policy: dict[str, Any],
) -> StepHitlResult:
    """Suspend execution for a deterministic blocker and normalize the resume decision."""

    result = StepHitlResult()
    if decision is None:
        return result
    payload = _build_interrupt_payload(
        decision.interrupt_type,
        decision.message,
        node_id=node_id,
        label=label,
        node_description=node_description,
        round_number=iteration + 1,
        resumable_actions=_resumable_actions(decision.interrupt_type),
        reason_code=decision.reason_code,
        risk_level=decision.risk_level,
        feedback_scope_default=str(_default_feedback_scope(decision, hitl_policy)),
        blocker_rule_id=decision.blocker_rule_id,
        blocker_kind=decision.blocker_kind,
    )
    writer({"type": "NodeSuspended", "node_id": node_id, "iteration": iteration, "payload": payload})
    response = interrupt(payload)
    action = normalize_interrupt_action(response, decision.interrupt_type)
    if action == "skip":
        result.skipped = True
        return result
    if action == "reject":
        result.failed = True
        result.error_msg = extract_interrupt_message(response) or "Task blocked by human"
        return result
    message = extract_interrupt_message(response)
    if decision.interrupt_type == "clarification":
        if not message:
            result.failed = True
            result.error_msg = "Clarification response was empty"
            return result
        if should_proceed_without_more_clarification(message):
            result.updated_description = (
                f"{node_description}\n\n"
                "Clarification from user: The user explicitly declined further clarification. "
                "Proceed with the available information, choose broad reasonable defaults for "
                "missing criteria, and produce the best possible final result now. Do not ask "
                "another clarification question."
            )
            result.suppress_follow_up_clarification = True
            return result
        result.updated_description = append_hitl_transcript_block(
            node_description,
            [
                {"role": "assistant", "content": decision.message},
                {"role": "user", "content": message},
            ],
        )
        context_entry = build_human_context_entry(
            response,
            node_id=node_id,
            label=label,
            interrupt_type=decision.interrupt_type,
            message=decision.message,
            default_scope=str(hitl_policy.get("feedbackScopeDefault") or "downstream_run"),
        )
        if context_entry:
            result.human_context.append(context_entry)
    elif message:
        result.updated_description = f"{node_description}\n\nHuman Feedback: {message}"
        context_entry = build_human_context_entry(
            response,
            node_id=node_id,
            label=label,
            interrupt_type=decision.interrupt_type,
            message=decision.message,
            default_scope=str(_default_feedback_scope(decision, hitl_policy)),
        )
        if context_entry:
            result.human_context.append(context_entry)
    return result


def _policy_allows(hitl_policy: dict[str, Any], key: str) -> bool:
    legacy_to_current = {
        "clarificationsEnabled": "clarificationEnabled",
        "approvalsEnabled": "approvalEnabled",
    }
    canonical = legacy_to_current.get(key, key)
    value = hitl_policy.get(canonical, hitl_policy.get(key))
    return True if value is None else bool(value)


def _missing_required_input(node_config: dict[str, Any], input_context: dict[str, Any]) -> str:
    input_config = node_config.get("input")
    ports = input_config.get("ports") if isinstance(input_config, dict) else []
    for port in ports if isinstance(ports, list) else []:
        if isinstance(port, dict) and port.get("required") is True:
            port_id = str(port.get("id") or "")
            if port_id and _is_empty_input(input_context.get(port_id)):
                return str(port.get("label") or port.get("name") or port_id)
    return ""


def _is_empty_input(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    if isinstance(value, (list, tuple, set, dict)):
        return len(value) == 0
    return False


def _matching_instruction_rule(
    node_config: dict[str, Any],
    hitl_blockers: list[dict[str, Any]],
) -> dict[str, Any] | None:
    description = _node_text(node_config)
    for rule in hitl_blockers:
        if str(rule.get("createdBy") or rule.get("created_by") or "") != "user":
            continue
        kind = str(rule.get("kind") or "")
        if kind not in {"explicit_human_request", "explicit_user_instruction"}:
            continue
        if rule.get("enabled") is False:
            continue
        matcher = rule.get("matcher")
        if isinstance(matcher, dict) and _matcher_applies(description, matcher):
            return rule
        matcher_config = rule.get("matcherConfig") or rule.get("matcher_config")
        if isinstance(matcher_config, dict) and _any_pattern_matches(description, matcher_config.get("phrases")):
            return rule
    return None


def _matching_missing_input_rule(hitl_blockers: list[dict[str, Any]]) -> dict[str, Any] | None:
    for rule in hitl_blockers:
        if rule.get("enabled") is False:
            continue
        if str(rule.get("createdBy") or rule.get("created_by") or "") != "user":
            continue
        if str(rule.get("kind") or "") == "missing_required_input":
            return rule
    return None


def _matching_action_rule(
    node_config: dict[str, Any],
    hitl_blockers: list[dict[str, Any]],
) -> dict[str, Any] | None:
    action_text = _node_action_text(node_config)
    for rule in hitl_blockers:
        if str(rule.get("createdBy") or rule.get("created_by") or "") != "user":
            continue
        if rule.get("enabled") is False:
            continue
        if str(rule.get("kind") or "") not in {"destructive_action", "external_send", "workspace_write"}:
            continue
        if _any_pattern_matches(action_text, rule.get("appliesToConnectorActions")):
            return rule
        matcher_config = rule.get("matcherConfig") or rule.get("matcher_config")
        if isinstance(matcher_config, dict) and _any_pattern_matches(action_text, matcher_config.get("verbs")):
            return rule
    return None


def _matcher_applies(description: str, matcher: dict[str, Any]) -> bool:
    pattern = str(matcher.get("pattern") or matcher.get("value") or "").strip().lower()
    return bool(pattern and pattern in description)


def _any_pattern_matches(text: str, patterns: Any) -> bool:
    if not isinstance(patterns, list):
        return False
    return any(str(pattern or "").strip().lower() in text for pattern in patterns if str(pattern or "").strip())


def _is_llm_judge_rule(rule: dict[str, Any]) -> bool:
    return (
        rule.get("enabled", True) is not False
        and str(rule.get("createdBy") or rule.get("created_by") or "") == "user"
        and str(rule.get("kind") or "") == "custom"
        and str(rule.get("matcherType") or rule.get("matcher_type") or "") == "llm_judge"
    )


def _node_action_text(node_config: dict[str, Any]) -> str:
    metadata = node_config.get("metadata") if isinstance(node_config.get("metadata"), dict) else {}
    bindings = metadata.get("connector_bindings") or metadata.get("connectorBindings") or []
    action_keys = [
        str(action.get("action_key") or action.get("actionKey") or "")
        for binding in bindings if isinstance(binding, dict)
        for action in binding.get("actions", []) if isinstance(action, dict)
    ]
    selected_action = str(
        node_config.get("selectedAction")
        or node_config.get("selected_action")
        or metadata.get("selectedAction")
        or metadata.get("selected_action")
        or "",
    ).strip()
    if selected_action:
        return selected_action.lower()

    unique_action_keys = [key for key in dict.fromkeys(action_keys) if key]
    if len(unique_action_keys) == 1:
        return unique_action_keys[0].lower()

    return ""


def _node_text(node_config: dict[str, Any]) -> str:
    metadata = node_config.get("metadata") if isinstance(node_config.get("metadata"), dict) else {}
    input_config = node_config.get("input") if isinstance(node_config.get("input"), dict) else {}
    output_config = node_config.get("output") if isinstance(node_config.get("output"), dict) else {}
    return " ".join([
        str(node_config.get("label") or ""),
        str(node_config.get("description") or ""),
        str(input_config.get("raw") or ""),
        str(output_config.get("raw") or ""),
        str(metadata.get("description") or ""),
    ]).lower()


def _resumable_actions(interrupt_type: str) -> list[str]:
    if interrupt_type == "clarification":
        return ["reply", "skip"]
    return ["approve", "reject", "skip"]


def _default_feedback_scope(decision: HitlBlockerDecision, hitl_policy: dict[str, Any]) -> str:
    policy_scope = str(hitl_policy.get("feedbackScopeDefault") or "downstream_run")
    if decision.interrupt_type != "clarification" and _is_sensitive_blocker(decision):
        return "step_only"
    return policy_scope


def _is_sensitive_blocker(decision: HitlBlockerDecision) -> bool:
    return decision.risk_level in {"high", "critical"} or decision.blocker_kind in {"destructive_action", "external_send"}
