from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

JobState = Literal[
    "queued",
    "waiting_dependencies",
    "running",
    "cancel_requested",
    "completed",
    "completed_with_gaps",
    "failed",
    "cancelled",
    "superseded",
]


class JobCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")

    actor_user_id: str = Field(alias="actorUserId", min_length=1, max_length=200)
    model_id: str | None = Field(default=None, alias="modelId", max_length=200)
    workspace_id: str | None = Field(default=None, alias="workspaceId", max_length=200)
    payload: dict[str, Any] = Field(default_factory=dict)


@dataclass(frozen=True)
class Admission:
    job_id: str
    state: JobState
    reused: bool


@dataclass(frozen=True)
class Lease:
    task_id: int
    job_id: str
    task_name: str
    payload: dict[str, Any]
    lease_epoch: int
    lease_owner: str
    lease_expires_at: datetime


@dataclass(frozen=True)
class OutboxItem:
    outbox_id: int
    task_id: int
    task_name: str
    queue_name: str
    payload: dict[str, Any]
    claim_owner: str


class IdempotencyConflict(Exception):
    pass


class StaleLease(Exception):
    pass
