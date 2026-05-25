"""Helper functions for deterministic advisor evidence extraction."""

from __future__ import annotations

from typing import Any


def summarize_output_presence(task_output: str, task_error: str) -> tuple[list[str], list[str]]:
    missing_facts: list[str] = []
    incoherences: list[str] = []

    if task_error.strip():
        incoherences.append(f"Task ended with error: {task_error.strip()}")
    if not task_output.strip():
        missing_facts.append("Task output is empty.")

    return missing_facts, incoherences


def inspect_tool_trace(tool_trace: list[dict[str, Any]]) -> dict[str, list[str]]:
    issues = {
        "tool_selection_issues": [],
        "missing_tool_calls": [],
        "redundant_tool_calls": [],
        "tool_output_use_issues": [],
        "tool_sequencing_issues": [],
        "tool_usage_strengths": [],
    }

    if not tool_trace:
        issues["missing_tool_calls"].append("No tool calls were recorded for this step.")
        return issues

    names = [str(item.get("tool_name") or "") for item in tool_trace]
    seen: set[str] = set()
    for name in names:
        if name in seen:
            issues["redundant_tool_calls"].append(f"Tool '{name}' was called more than once.")
        else:
            seen.add(name)

    for item in tool_trace:
        summary = str(item.get("output_summary") or "").strip()
        tool_name = str(item.get("tool_name") or "tool")
        if summary:
            issues["tool_usage_strengths"].append(f"{tool_name} returned captured output.")
        else:
            issues["tool_output_use_issues"].append(f"{tool_name} has no summarized output.")

    return issues


def inspect_output_format(task_output: str, output_format_guide: str) -> tuple[list[str], list[str]]:
    unsupported_claims: list[str] = []
    rewrite_hints: list[str] = []

    if output_format_guide.strip() and "#" in output_format_guide and "#" not in task_output:
        unsupported_claims.append("Output does not preserve the expected heading structure.")
        rewrite_hints.append("Preserve the documented heading hierarchy in the final answer.")

    if output_format_guide.strip() and "|" in output_format_guide and "|" not in task_output:
        unsupported_claims.append("Output does not preserve the expected table structure.")
        rewrite_hints.append("Return the result using the expected table layout.")

    return unsupported_claims, rewrite_hints
