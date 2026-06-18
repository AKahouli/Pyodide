"""Pydantic schemas for the Worky Manager plan-delta wire format.

These mirror the backend's `PlanDeltaBodyDto` shape (see
`back/src/modules/worky/dto/plan-delta-body.dto.ts`). They are the
strictly-validated shape the Manager agent emits through the
`submit_plan_delta` tool. Validation failures are surfaced to the
agent so it can retry with corrected output.
"""
from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field, field_validator

Lane = Literal[
    "backlog",
    "ready",
    "running",
    "review",
    "blocked",
    "done",
]
Priority = Literal["low", "medium", "high", "critical"]
AssigneeType = Literal["ephemeral_ai_agent", "human_agent", "unassigned"]
ActionCategory = Literal[
    "internal_analysis",
    "research",
    "drafting",
    "internal_artifact_write",
    "internal_platform_notification",
    "external_send",
    "customer_facing_release",
    "external_comms",
    "budget_overrun",
    "cancel_human_task",
    "replanning",
]


class CreateTask(BaseModel):
    clientTaskId: Optional[str] = Field(default=None, max_length=128)
    title: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = Field(default=None, max_length=5000)
    lane: Lane
    planningStatus: Optional[Literal["pending", "confirmed"]] = None
    priority: Optional[Priority] = None
    assigneeType: Optional[AssigneeType] = None
    dependsOn: Optional[List[str]] = None
    requiredTools: Optional[List[str]] = None
    actionCategory: ActionCategory
    acceptanceCriteria: Optional[List[str]] = None
    budgetEstimateUsd: Optional[float] = Field(default=None, ge=0)
    tokensEstimate: Optional[int] = Field(default=None, ge=0)


class UpdateTask(BaseModel):
    taskId: str = Field(..., min_length=1)
    title: Optional[str] = Field(default=None, max_length=200)
    description: Optional[str] = Field(default=None, max_length=5000)
    lane: Optional[Lane] = None
    priority: Optional[Priority] = None
    dependsOn: Optional[List[str]] = None
    actionCategory: Optional[ActionCategory] = None
    acceptanceCriteria: Optional[List[str]] = None


class CancelTask(BaseModel):
    taskId: str = Field(..., min_length=1)
    reason: Optional[str] = Field(default=None, max_length=2000)


class ClarificationRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=5000)
    options: Optional[List[str]] = None
    blocksTaskClientIds: Optional[List[str]] = None
    blocksTaskIds: Optional[List[str]] = None
    type: Optional[Literal["clarification", "assignment_disambiguation"]] = None


class PlanDeltaBody(BaseModel):
    create_tasks: Optional[List[CreateTask]] = None
    update_tasks: Optional[List[UpdateTask]] = None
    cancel_tasks: Optional[List[CancelTask]] = None
    clarification_requests: Optional[List[ClarificationRequest]] = None

    @field_validator("create_tasks", "update_tasks", "cancel_tasks", "clarification_requests")
    @classmethod
    def _limit_size(cls, v: Optional[List[BaseModel]]) -> Optional[List[BaseModel]]:
        # Defensive: a single turn should not propose 200+ tasks. The
        # Manager should batch via multiple turns if needed.
        if v is not None and len(v) > 100:
            raise ValueError("Plan delta section exceeds 100 entries; batch across turns.")
        return v


def parse_plan_delta(raw: dict) -> PlanDeltaBody:
    """Parse a raw dict from the LLM into a validated `PlanDeltaBody`."""
    return PlanDeltaBody.model_validate(raw)
