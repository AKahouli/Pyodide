"""Deterministic task execution advisor service."""

from __future__ import annotations

import json
from dataclasses import asdict
from typing import Any

from .evidence_extractor import (
    inspect_output_format,
    inspect_tool_trace,
    summarize_output_presence,
)
from .execution_advisor_models import (
    ExecutionAdvisorRequest,
    ExecutionAdvisorResult,
    ExecutionAdvisorToolTraceItem,
)
from .score_aggregator import (
    score_expected_match,
    score_determinism,
    score_output_quality,
    score_overall,
    score_specificity,
    score_tool_usage,
)


def _parse_tool_trace(raw_tool_trace: list[dict[str, Any]]) -> list[ExecutionAdvisorToolTraceItem]:
    return [
        ExecutionAdvisorToolTraceItem(
            call_index=int(item.get("call_index", 0) or 0),
            tool_name=str(item.get("tool_name") or ""),
            args=item.get("args") or {},
            output_summary=str(item.get("output_summary") or ""),
        )
        for item in raw_tool_trace
    ]


def build_execution_advisor_request(payload: dict[str, Any]) -> ExecutionAdvisorRequest:
    return ExecutionAdvisorRequest(
        execution_id=str(payload.get("execution_id") or ""),
        owner_id=str(payload.get("owner_id") or ""),
        playbook_id=str(payload.get("playbook_id") or ""),
        task_id=str(payload.get("task_id") or ""),
        task_title=str(payload.get("task_title") or ""),
        task_description=str(payload.get("task_description") or ""),
        expected_result=str(payload.get("expected_result") or ""),
        output_format_guide=str(payload.get("output_format_guide") or ""),
        baseline_output=str(payload.get("baseline_output") or ""),
        task_output=str(payload.get("task_output") or ""),
        task_error=str(payload.get("task_error") or ""),
        task_status=str(payload.get("task_status") or ""),
        tool_trace=_parse_tool_trace(payload.get("tool_trace") or []),
        artifacts_json=str(payload.get("artifacts_json") or ""),
        task_metadata=payload.get("task_metadata") or {},
        usage=payload.get("usage") or {},
        llm_prompt_trace=payload.get("llm_prompt_trace") or [],
    )


def _estimate_prompt_tokens(request: ExecutionAdvisorRequest) -> int:
    """Estimate step inference size from usage first, then prompt text fallback."""

    usage_total = request.usage.get("totalTokens") or request.usage.get("total_tokens")
    if isinstance(usage_total, (int, float)) and usage_total > 0:
        return int(usage_total)

    prompt_chars = sum(
        len(str(item.get("prompt") or ""))
        for item in request.llm_prompt_trace
        if isinstance(item, dict)
    )
    if prompt_chars > 0:
        return max(1, prompt_chars // 4)

    return max(1, len(request.task_description + request.task_output) // 4)


def _looks_like_pure_transform(text: str) -> bool:
    """Detect tasks that can plausibly run as deterministic transforms."""

    keywords = {
        "parse", "normalize", "validate", "convert", "map", "filter",
        "sort", "calculate", "deduplicate", "extract", "format",
        "json", "csv", "table", "schema", "regex", "router", "condition",
    }
    lowered = text.lower()
    return any(keyword in lowered for keyword in keywords)


def _looks_like_llm_required(text: str) -> list[str]:
    """Return explicit reasons that deterministic replacement should stay blocked."""

    reasons: list[str] = []
    lowered = text.lower()

    if any(keyword in lowered for keyword in ["research", "find latest", "current", "web", "news"]):
        reasons.append("The task appears to require external or current knowledge.")
    if any(keyword in lowered for keyword in ["write", "draft", "creative", "narrative", "persuasive"]):
        reasons.append("The task appears to require natural-language generation.")
    if any(keyword in lowered for keyword in ["analyze", "assess", "judge", "recommend", "strategy"]):
        reasons.append("The task appears to require semantic judgment or reasoning.")
    if any(keyword in lowered for keyword in ["approve", "human", "sensitive", "legal", "medical", "financial"]):
        reasons.append("The task may require human-sensitive review or policy judgment.")

    return reasons


def analyze_cost_efficiency(
    request: ExecutionAdvisorRequest,
    determinism: int,
    specificity: int,
) -> dict[str, Any]:
    """Create conservative cost findings without generating executable code."""

    task_text = " ".join([
        request.task_title,
        request.task_description,
        request.expected_result,
        request.output_format_guide,
    ])
    estimated_tokens = _estimate_prompt_tokens(request)
    is_pure_transform = _looks_like_pure_transform(task_text)
    llm_reasons = _looks_like_llm_required(task_text)
    has_stable_contract = bool(
        request.expected_result.strip() or request.output_format_guide.strip()
    )
    output_is_structured = request.task_output.strip().startswith(("{", "[", "|")) or "," in request.task_output[:200]

    hints: list[str] = []
    script_hints: list[str] = []
    priority = 0
    score = 75

    if estimated_tokens > 4000:
        priority += 30
        score -= 20
        hints.append("Prompt/context appears large; compact repeated instructions and only pass required upstream context.")
    if estimated_tokens > 8000:
        priority += 20
        hints.append("Step has very high token usage; consider splitting context or replacing deterministic parts.")
    if is_pure_transform and has_stable_contract:
        priority += 25
        hints.append("Task appears deterministic enough for cheaper execution.")
        if not llm_reasons and output_is_structured and determinism >= 70 and specificity >= 60:
            script_hints.append("Candidate for validated Python replacement because it looks like a pure structured transformation.")
            priority += 50
    if llm_reasons:
        score -= 10
        hints.append("LLM inference may still be needed; optimize prompt and model before attempting replacement.")

    estimated_reduction = None
    if script_hints:
        estimated_reduction = 95
    elif hints:
        estimated_reduction = 25 if estimated_tokens <= 4000 else 40

    return {
        "cost_efficiency_score": max(0, min(100, score)),
        "cost_optimization_priority": max(0, min(100, priority)),
        "estimated_token_reduction_pct": estimated_reduction,
        "estimated_latency_reduction_pct": estimated_reduction,
        "cost_optimization_hints": hints,
        "script_replacement_hints": script_hints,
        "llm_still_required_reasons": llm_reasons,
    }


def evaluate_task_execution(payload: dict[str, Any]) -> dict[str, Any]:
    request = build_execution_advisor_request(payload)
    tool_trace_dicts = [asdict(item) for item in request.tool_trace]
    missing_facts, incoherences = summarize_output_presence(request.task_output, request.task_error)
    tool_findings = inspect_tool_trace(tool_trace_dicts)
    unsupported_claims, rewrite_hints = inspect_output_format(
        request.task_output,
        request.output_format_guide,
    )

    output_quality = score_output_quality(request.task_output, request.task_error)
    expected_match, expected_source, expected_type, expected_matched, expected_reason = score_expected_match(
        request.task_output,
        request.expected_result,
        request.baseline_output,
    )
    tool_issue_count = sum(len(tool_findings[key]) for key in (
        "tool_selection_issues",
        "missing_tool_calls",
        "redundant_tool_calls",
        "tool_output_use_issues",
        "tool_sequencing_issues",
    ))
    tool_usage = score_tool_usage(len(request.tool_trace), tool_issue_count)
    format_compliance = 65 if unsupported_claims else 90 if request.output_format_guide.strip() else 75
    evidence_grounding = 65 if tool_findings["tool_output_use_issues"] else 85 if request.tool_trace else 60
    handoff_readiness = 60 if output_quality < 60 else 82
    specificity = score_specificity(request.task_output)
    determinism = score_determinism(request.task_description, request.expected_result, request.output_format_guide)
    cost_findings = analyze_cost_efficiency(request, determinism, specificity)
    relevance = 80 if request.task_output.strip() else 10
    hitl_appropriateness = 70 if request.task_error.strip() else 85
    caps: list[int] = []
    if not request.task_output.strip():
        caps.append(20)
    if request.task_error.strip():
        caps.append(25)
    if expected_source != "none" and not expected_matched:
        caps.append(60)
    if unsupported_claims:
        caps.append(65)
    if handoff_readiness < 65:
        caps.append(60)
    metrics = {
        "accuracy_score": output_quality,
        "completeness_score": max(0, min(100, expected_match)),
        "result_matching_score": expected_match,
        "relevance_score": relevance,
        "format_compliance_score": format_compliance,
        "evidence_grounding_score": evidence_grounding,
        "handoff_readiness_score": handoff_readiness,
    }
    overall = score_overall(metrics, caps)
    blocking_issue_count = sum(1 for score in (output_quality, format_compliance, evidence_grounding, handoff_readiness) if score < 60)
    downstream_impact_level = "high" if handoff_readiness < 60 else "medium" if handoff_readiness < 75 else "low"
    risk_severity = "critical" if blocking_issue_count >= 3 else "high" if blocking_issue_count >= 1 else "medium" if overall < 75 else "low"
    step_priority = max(0, min(100, 100 - min(determinism, specificity, format_compliance)))
    playbook_priority = max(0, min(100, 100 - min(handoff_readiness, evidence_grounding)))

    recommendation = "none"
    if overall < 50:
        recommendation = "generate_new_optimized_playbook"
    elif overall < 75:
        recommendation = "update_current_playbook"
    recommended_action = "optimize_playbook" if playbook_priority > step_priority else "optimize_step"
    if unsupported_claims:
        recommended_action = "improve_output_contract"
    elif tool_issue_count > 0 and tool_usage < min(step_priority, playbook_priority):
        recommended_action = "improve_tooling"
    if blocking_issue_count == 0:
        if cost_findings["script_replacement_hints"] and cost_findings["cost_optimization_priority"] >= 70:
            recommended_action = "replace_with_deterministic_script"
        elif cost_findings["cost_optimization_priority"] >= 50:
            recommended_action = "optimize_prompt_cost"

    result = ExecutionAdvisorResult(
        accuracy_score=output_quality,
        completeness_score=max(0, min(100, expected_match)),
        result_matching_score=expected_match,
        overall_score=overall,
        confidence=0.82 if request.expected_result or request.baseline_output else 0.6,
        tool_usage_score=tool_usage,
        relevance_score=relevance,
        specificity_score=specificity,
        format_compliance_score=format_compliance,
        evidence_grounding_score=evidence_grounding,
        handoff_readiness_score=handoff_readiness,
        hitl_appropriateness_score=hitl_appropriateness,
        determinism_score=determinism,
        cost_efficiency_score=cost_findings["cost_efficiency_score"],
        step_optimization_priority=step_priority,
        playbook_optimization_priority=playbook_priority,
        cost_optimization_priority=cost_findings["cost_optimization_priority"],
        estimated_token_reduction_pct=cost_findings["estimated_token_reduction_pct"],
        estimated_latency_reduction_pct=cost_findings["estimated_latency_reduction_pct"],
        risk_severity=risk_severity,
        blocking_issue_count=blocking_issue_count,
        downstream_impact_level=downstream_impact_level,
        recommended_action=recommended_action,
        available_actions={"optimize_step": True, "optimize_playbook": True},
        expected_result_source=expected_source,
        expected_result_type=expected_type,
        expected_result_matched=expected_matched,
        expected_result_reason=expected_reason,
        missing_facts=missing_facts,
        incoherences=incoherences,
        unsupported_claims=unsupported_claims,
        handoff_risks=[] if overall >= 60 else ["Review downstream consumers for incomplete data handoff."],
        rewrite_hints=rewrite_hints,
        tool_selection_issues=tool_findings["tool_selection_issues"],
        missing_tool_calls=tool_findings["missing_tool_calls"],
        redundant_tool_calls=tool_findings["redundant_tool_calls"],
        tool_output_use_issues=tool_findings["tool_output_use_issues"],
        tool_sequencing_issues=tool_findings["tool_sequencing_issues"],
        tool_usage_strengths=tool_findings["tool_usage_strengths"],
        tool_usage_recommendation="Use tool outputs explicitly in the final answer." if tool_findings["tool_output_use_issues"] else "Tool usage looks coherent for this step.",
        cost_optimization_hints=cost_findings["cost_optimization_hints"],
        script_replacement_hints=cost_findings["script_replacement_hints"],
        llm_still_required_reasons=cost_findings["llm_still_required_reasons"],
        safe_auto_fix_type="optimize_step" if rewrite_hints else "none",
        recommendation=recommendation,
        reason="Deterministic execution advisor evaluation completed.",
    )

    result_dict = asdict(result)
    if "artifacts_json" in payload:
        try:
            json.loads(request.artifacts_json or "[]")
        except json.JSONDecodeError:
            result_dict["unsupported_claims"].append("Artifacts payload could not be parsed as JSON.")
    return result_dict
