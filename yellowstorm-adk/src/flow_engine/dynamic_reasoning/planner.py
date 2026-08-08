from __future__ import annotations

import json
from typing import Any

import litellm
from pydantic import ValidationError

from src.flow_engine.dynamic_reasoning.models import DynamicReasoningDecision, PlannerSnapshot


PLANNING_CONTRACT = """
Return only one top-level JSON object matching the decision schema below. Do not
wrap the object or return a shorthand decision. Choose SUBGRAPH only
when decomposition creates at least two distinct useful work units or a meaningful
validation dependency and materially improves reliability, context handling,
validation, or parallelism. Otherwise choose DIRECT. Generated plans contain only
task work nodes and one mandatory synthesis node. Never request permissions,
tools, connectors, workspaces, router, iterator, HITL, or recursive reasoning.
""".strip()

DIRECT_EXAMPLE = {
    "mode": "direct",
    "reasonCodes": [],
    "reasonSummary": "The task is already atomic and safe to execute directly.",
    "confidence": 0.9,
    "consideredFactors": [],
    "directSafe": True,
    "plan": None,
}


class PlannerDecisionError(ValueError):
    """Raised when planner content does not satisfy the public decision contract."""


async def decide(
    planner: PlannerSnapshot,
    task_descriptor: dict[str, Any],
    input_envelope: dict[str, Any],
    repair_context: dict[str, Any] | None = None,
) -> DynamicReasoningDecision:
    payload = {"task": task_descriptor, "inputContext": input_envelope}
    if repair_context:
        payload["repair"] = repair_context
    decision_schema = DynamicReasoningDecision.model_json_schema(by_alias=True)
    contract = (
        f"{PLANNING_CONTRACT}\n\nDecision JSON Schema:\n"
        f"{json.dumps(decision_schema, ensure_ascii=False)}\n\n"
        f"Valid DIRECT example:\n{json.dumps(DIRECT_EXAMPLE, ensure_ascii=False)}"
    )
    kwargs: dict[str, Any] = {
        "model": planner.model,
        "messages": [
            {"role": "system", "content": f"{planner.system_prompt}\n\n{contract}"},
            {"role": "user", "content": json.dumps(payload, ensure_ascii=False, default=str)},
        ],
        "response_format": {"type": "json_object"},
    }
    if not planner.omit_temperature:
        kwargs["temperature"] = planner.temperature
    response = await litellm.acompletion(**kwargs)
    content = response.choices[0].message.content
    if not isinstance(content, str):
        raise PlannerDecisionError("Playbook Planner returned an invalid decision")
    try:
        return DynamicReasoningDecision.model_validate_json(content)
    except (ValidationError, ValueError, TypeError):
        raise PlannerDecisionError("Playbook Planner returned an invalid decision") from None
