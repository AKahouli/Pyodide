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
    score_output_quality,
    score_overall,
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
    )


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
    overall = score_overall([output_quality, expected_match, tool_usage])

    recommendation = "none"
    if overall < 50:
        recommendation = "generate_new_optimized_playbook"
    elif overall < 75:
        recommendation = "update_current_playbook"

    result = ExecutionAdvisorResult(
        accuracy_score=output_quality,
        completeness_score=max(0, min(100, expected_match)),
        result_matching_score=expected_match,
        overall_score=overall,
        confidence=0.82 if request.expected_result or request.baseline_output else 0.6,
        tool_usage_score=tool_usage,
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
