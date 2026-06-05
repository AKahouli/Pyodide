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


def score_specificity(task_output: str) -> int:
    output = task_output.strip()
    if not output:
        return 10
    if len(output) < 80:
        return 55
    return 82


def score_determinism(task_description: str, expected_result: str, output_format_guide: str) -> int:
    score = 45
    if len(task_description.strip()) >= 80:
        score += 20
    if expected_result.strip():
        score += 15
    if output_format_guide.strip():
        score += 15
    return clamp_score(score)


def score_overall(metrics: dict[str, int], caps: list[int]) -> int:
    weighted = (
        metrics["accuracy_score"] * 0.25
        + metrics["completeness_score"] * 0.15
        + metrics["result_matching_score"] * 0.15
        + metrics["relevance_score"] * 0.10
        + metrics["format_compliance_score"] * 0.15
        + metrics["evidence_grounding_score"] * 0.10
        + metrics["handoff_readiness_score"] * 0.10
    )
    score = clamp_score(weighted)
    return min([score, *caps]) if caps else score
