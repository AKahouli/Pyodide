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


class DiscoveryCommand(JobCommand):
    """Datasource discovery command.

    The canonical home workspace is required: the worker authorizes
    cross-workspace reads against it and never infers it from the payload, so
    admission rejects a missing value instead of admitting a job the worker
    must fail.
    """

    model_config = ConfigDict(extra="forbid")

    workspace_id: str = Field(alias="workspaceId", min_length=1, max_length=200)


class PopulationSource(BaseModel):
    """One resolved mapped source. Columns are source-header names; the worker
    renames them to concept attributes through ``columnMapping`` and drops
    unmapped columns so unmapped source values never leak into assertions."""

    model_config = ConfigDict(extra="forbid")

    concept_id: str = Field(alias="conceptId", min_length=1, max_length=200)
    source: dict[str, Any]
    options: dict[str, Any] = Field(default_factory=dict)
    column_mapping: dict[str, str] = Field(alias="columnMapping", min_length=1)
    label_field: str | None = Field(default=None, alias="labelField", max_length=200)
    mapping_version: str = Field(default="v1", alias="mappingVersion", max_length=200)


class RelationBinding(BaseModel):
    """Compiled matching-plan input: which source attribute holds the target
    reference for one relation."""

    model_config = ConfigDict(extra="forbid")

    relation_id: str = Field(alias="relationId", min_length=1, max_length=200)
    reference_field: str = Field(alias="referenceField", min_length=1, max_length=200)


class PopulationPayload(BaseModel):
    """Concrete population command (plan 5.4). The canonical specification and
    the resolved source set travel inline as a documented bridge until the
    runtime spec mirror (P1.5/P7) serves ``sourceSetRef`` server-side."""

    model_config = ConfigDict(extra="forbid")

    model_version_id: str = Field(alias="modelVersionId", min_length=1, max_length=200)
    spec_hash: str = Field(alias="specHash", pattern=r"^sha256:[0-9a-f]{64}$")
    purpose: Literal["preview", "build", "refresh"]
    specification: dict[str, Any]
    sources: list[PopulationSource] = Field(min_length=1, max_length=25)
    relation_bindings: list[RelationBinding] = Field(
        default_factory=list, alias="relationBindings", max_length=50)
    expected_active_data_revision_id: str | None = Field(
        default=None, alias="expectedActiveDataRevisionId", max_length=200)
    expected_correction_sequence: int = Field(
        default=0, alias="expectedCorrectionSequence", ge=0)
    budget_profile_id: str = Field(
        default="default", alias="budgetProfileId", max_length=200)


class PopulationCommand(JobCommand):
    model_config = ConfigDict(extra="forbid")

    model_id: str = Field(alias="modelId", min_length=1, max_length=200)
    workspace_id: str = Field(alias="workspaceId", min_length=1, max_length=200)
    payload: PopulationPayload


class MirrorSpecificationCommand(BaseModel):
    """Mirror an immutable canonical specification for execution (P1.5).

    The supplied ``specHash`` must equal the recomputed canonical hash;
    a version arriving with different content is a conflict, never a rewrite."""

    model_config = ConfigDict(extra="forbid")

    home_workspace_id: str = Field(alias="homeWorkspaceId", min_length=1, max_length=200)
    model_id: str = Field(alias="modelId", min_length=1, max_length=200)
    model_version_id: str = Field(alias="modelVersionId", min_length=1, max_length=200)
    spec_hash: str = Field(alias="specHash", pattern=r"^sha256:[0-9a-f]{64}$")
    specification: dict[str, Any]


class CorrectionCommand(BaseModel):
    """Human correction through the single population write pipeline (P6.8).

    Recorded durably with optimistic concurrency; applied to serving state by
    rebuild/activation, never by direct projection edits."""

    model_config = ConfigDict(extra="forbid")

    actor_user_id: str = Field(alias="actorUserId", min_length=1, max_length=200)
    model_id: str = Field(alias="modelId", min_length=1, max_length=200)
    model_version_id: str = Field(alias="modelVersionId", min_length=1, max_length=200)
    action: Literal["create_entity", "edit_entity", "remove_entity", "add_relationship",
                    "remove_relationship", "set_override", "reset_override",
                    "suppress", "unsuppress"]
    target_identity: dict[str, Any] = Field(alias="targetIdentity")
    reason: str = Field(default="", max_length=2000)
    payload: dict[str, Any] = Field(default_factory=dict)
    expected_correction_sequence: int = Field(
        alias="expectedCorrectionSequence", ge=0)
    data_revision_id: str | None = Field(
        default=None, alias="dataRevisionId", max_length=200)


class ReviewResolveCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")

    actor_user_id: str = Field(alias="actorUserId", min_length=1, max_length=200)
    model_id: str = Field(alias="modelId", min_length=1, max_length=200)
    resolution: dict[str, Any]


class ActivateRevisionCommand(BaseModel):
    """Explicit authorized activation using the expected active tuple (P6.16)."""

    model_config = ConfigDict(extra="forbid")

    actor_user_id: str = Field(alias="actorUserId", min_length=1, max_length=200)
    model_id: str = Field(alias="modelId", min_length=1, max_length=200)
    model_version_id: str = Field(alias="modelVersionId", min_length=1, max_length=200)
    expected_correction_sequence: int = Field(
        alias="expectedCorrectionSequence", ge=0)
    expected_active_data_revision_id: str | None = Field(
        default=None, alias="expectedActiveDataRevisionId", max_length=200)
    environment: Literal["production", "shadow", "test"] = "production"


class SourceEventPayload(BaseModel):
    model_config = ConfigDict(extra="allow")

    workspace_id: str = Field(alias="workspaceId", min_length=1, max_length=200)
    document_id: str = Field(alias="documentId", min_length=1, max_length=200)


class SourceEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_id: str = Field(alias="eventId", min_length=1, max_length=200)
    event_type: Literal[
        "workspace.document.registered.v1",
        "workspace.document.artifact_ready.v1",
        "workspace.document.indexing_started.v1",
        "workspace.document.indexing_ready.v1",
        "workspace.document.indexing_failed.v1",
        "workspace.document.deleted.v1",
    ] = Field(alias="eventType")
    occurred_at: datetime = Field(alias="occurredAt")
    payload: SourceEventPayload


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
    attempt_count: int = 1


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
