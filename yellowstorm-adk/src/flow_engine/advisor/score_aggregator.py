"""Score helpers for the deterministic execution advisor."""

from __future__ import annotations


def clamp_score(value: float) -> int:
    return max(0, min(100, round(value)))


def score_output_quality(task_output: str, task_error: str) -> int:
    if task_error.strip():
        return 15
    if not task_output.strip():
        return 10
    if len(task_output.strip()) < 40:
        return 55
    return 85


def score_expected_match(task_output: str, expected_result: str, baseline_output: str) -> tuple[int, str, str, bool, str]:
    if expected_result.strip():
        normalized_expected = expected_result.strip().lower()
        normalized_output = task_output.strip().lower()
        matched = normalized_expected[:32] in normalized_output if normalized_expected else False
        return (
            88 if matched else 52,
            "node_field",
            "semantic_description",
            matched,
            "The task output was compared against the configured expected result.",
        )

    if baseline_output.strip():
        matched = baseline_output.strip().lower()[:32] in task_output.strip().lower() if task_output.strip() else False
        return (
            84 if matched else 48,
            "golden_baseline",
            "baseline_comparison",
            matched,
            "The task output was compared against the active replay baseline.",
        )

    return 0, "none", "none", False, "No expected result was available for comparison."


def score_tool_usage(tool_trace_count: int, tool_issue_count: int) -> int:
    if tool_trace_count == 0:
        return 35
    return clamp_score(85 - (tool_issue_count * 8))


def score_overall(scores: list[int]) -> int:
    return clamp_score(sum(scores) / len(scores)) if scores else 0
