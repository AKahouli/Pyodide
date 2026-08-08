from typing import Any

from src.flow_engine.dynamic_reasoning.models import GeneratedExecutionPlan


def adapt_runtime_subgraph(value: dict[str, Any]) -> GeneratedExecutionPlan:
    return GeneratedExecutionPlan.model_validate(value)
