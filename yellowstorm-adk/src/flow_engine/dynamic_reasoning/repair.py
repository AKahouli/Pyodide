from __future__ import annotations

from typing import Any

from src.flow_engine.dynamic_reasoning.models import DynamicReasoningDecision, PlannerSnapshot, ValidationIssue
from src.flow_engine.dynamic_reasoning.planner import decide


async def repair_plan(
    planner: PlannerSnapshot,
    task_descriptor: dict[str, Any],
    input_envelope: dict[str, Any],
    original_decision: DynamicReasoningDecision,
    issues: list[ValidationIssue],
) -> DynamicReasoningDecision:
    return await decide(planner, task_descriptor, input_envelope, {
        "instruction": "Regenerate the complete plan while resolving every reported issue.",
        "originalPlan": original_decision.plan.model_dump(by_alias=True) if original_decision.plan else None,
        "validationIssues": [issue.model_dump(by_alias=True) for issue in issues],
    })
