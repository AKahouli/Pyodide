"""Typed models for execution advisor requests and results."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(slots=True)
class ExecutionAdvisorToolTraceItem:
    call_index: int
    tool_name: str
    args: dict[str, Any] = field(default_factory=dict)
    output_summary: str = ""


@dataclass(slots=True)
class ExecutionAdvisorRequest:
    execution_id: str
    owner_id: str
    playbook_id: str
    task_id: str
    task_title: str
    task_description: str
    expected_result: str
    output_format_guide: str
    baseline_output: str
    task_output: str
    task_error: str
    task_status: str
    tool_trace: list[ExecutionAdvisorToolTraceItem] = field(default_factory=list)
    artifacts_json: str = ""
    task_metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class ExecutionAdvisorResult:
    accuracy_score: int
    completeness_score: int
    result_matching_score: int
    overall_score: int
    confidence: float
    tool_usage_score: int
    expected_result_source: str
    expected_result_type: str
    expected_result_matched: bool
    expected_result_reason: str
    missing_facts: list[str] = field(default_factory=list)
    incoherences: list[str] = field(default_factory=list)
    unsupported_claims: list[str] = field(default_factory=list)
    handoff_risks: list[str] = field(default_factory=list)
    rewrite_hints: list[str] = field(default_factory=list)
    tool_selection_issues: list[str] = field(default_factory=list)
    missing_tool_calls: list[str] = field(default_factory=list)
    redundant_tool_calls: list[str] = field(default_factory=list)
    tool_output_use_issues: list[str] = field(default_factory=list)
    tool_sequencing_issues: list[str] = field(default_factory=list)
    tool_usage_strengths: list[str] = field(default_factory=list)
    tool_usage_recommendation: str = ""
    safe_auto_fix_type: str = "none"
    recommendation: str = "none"
    reason: str = ""
    model: str = "deterministic-execution-advisor"
