from __future__ import annotations

from typing import Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator


def _to_camel(value: str) -> str:
    head, *tail = value.split("_")
    return head + "".join(part.capitalize() for part in tail)


class ContractModel(BaseModel):
    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True)


ValidationCode = Literal[
    "SCHEMA_INVALID", "DUPLICATE_NODE_ID", "UNKNOWN_NODE_REFERENCE",
    "MISSING_DEPENDENCY", "CYCLIC_DEPENDENCY", "UNREACHABLE_NODE",
    "UNKNOWN_INPUT_PORT", "INVALID_INPUT_SELECTOR", "PORT_TYPE_MISMATCH",
    "OUTPUT_SCHEMA_MISMATCH", "MISSING_SYNTHESIS_PATH",
    "WORK_NODE_LIMIT_EXCEEDED", "PARALLELISM_LIMIT_EXCEEDED",
    "PERMISSION_SCOPE_EXPANSION", "UNSUPPORTED_NODE_TYPE",
    "INSUFFICIENT_DECOMPOSITION_VALUE",
]


class DynamicReasoningPolicy(ContractModel):
    max_work_nodes: int = Field(default=6, ge=1, le=32)
    max_parallelism: int = Field(default=3, ge=1, le=32)
    max_depth: int = Field(default=1, ge=1, le=1)
    max_repair_attempts: int = Field(default=1, ge=0, le=3)


class PlannerSnapshot(ContractModel):
    agent_id: str
    agent_type_slug: str
    model: str
    system_prompt: str = ""
    temperature: float = 0.0
    omit_temperature: bool = False
    prompt_hash: str = ""
    agent_revision: str = ""


class GeneratedInputBinding(ContractModel):
    kind: Literal["port", "port-items", "port-partition", "generated-output"]
    port_id: str | None = None
    selector: Literal["all"] | None = None
    item_ids: list[str] = Field(default_factory=list)
    partition_index: int | None = None
    partition_count: int | None = None
    node_id: str | None = None
    output_port_id: str | None = None


class GeneratedOutputPort(ContractModel):
    id: str
    type: str = "text"


class GeneratedWorkNode(ContractModel):
    id: str = Field(pattern=r"^[a-z0-9-]{1,64}$")
    title: str = Field(min_length=1, max_length=200)
    instruction: str = Field(min_length=1, max_length=20000)
    input_bindings: list[GeneratedInputBinding] = Field(default_factory=list)
    output_ports: list[GeneratedOutputPort] = Field(default_factory=list)
    depends_on: list[str] = Field(default_factory=list)
    kind: Literal["task"] = "task"


class GeneratedSynthesisNode(GeneratedWorkNode):
    kind: Literal["synthesis"] = "synthesis"


class GeneratedExecutionPlan(ContractModel):
    schema_version: Literal["1"] = "1"
    nodes: list[GeneratedWorkNode]
    synthesis: GeneratedSynthesisNode


class ConsideredFactor(ContractModel):
    factor: str
    observation: str
    impact: Literal["supports-direct", "supports-subgraph", "neutral"]


class DynamicReasoningDecision(ContractModel):
    mode: Literal["direct", "subgraph"]
    reason_codes: list[str] = Field(default_factory=list)
    reason_summary: str
    confidence: float = Field(ge=0, le=1)
    considered_factors: list[ConsideredFactor] = Field(default_factory=list)
    direct_safe: bool
    plan: GeneratedExecutionPlan | None = None

    @model_validator(mode="after")
    def validate_mode_contract(self) -> Self:
        if self.mode == "direct":
            if not self.direct_safe:
                raise ValueError("DIRECT decisions must be safe for direct execution")
            if self.plan is not None:
                raise ValueError("DIRECT decisions cannot include a generated plan")
        elif self.plan is None:
            raise ValueError("SUBGRAPH decisions must include a generated plan")
        return self


class ValidationIssue(ContractModel):
    code: ValidationCode
    severity: Literal["error", "warning"] = "error"
    path: str
    message: str
    related_node_ids: list[str] = Field(default_factory=list)
    expected: Any = None
    actual: Any = None
    repair_hint: str | None = None


class DynamicReasoningOutcome(ContractModel):
    mode: Literal["direct", "subgraph"]
    decision: DynamicReasoningDecision
    result_payload: dict[str, Any] | None = None
    accepted_plan: GeneratedExecutionPlan | None = None
    validation_issues: list[ValidationIssue] = Field(default_factory=list)
