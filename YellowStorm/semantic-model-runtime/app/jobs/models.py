from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal

from pydantic import (BaseModel, ConfigDict, Field, SerializerFunctionWrapHandler,
                      model_serializer, model_validator)

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
    """One resolved tabular or document mapping, discriminated by source kind."""

    model_config = ConfigDict(extra="forbid")

    concept_id: str = Field(alias="conceptId", min_length=1, max_length=200)
    source: dict[str, Any]
    source_kind: Literal["tabular", "excel_sheet", "csv", "document", "manual"] | None = Field(
        default=None, alias="sourceKind")
    options: dict[str, Any] = Field(default_factory=dict)
    column_mapping: dict[str, str] | None = Field(default=None, alias="columnMapping")
    constant_mapping: dict[str, Any] | None = Field(default=None, alias="constantMapping", min_length=1)
    field_mappings: list[dict[str, Any]] | None = Field(
        default=None, alias="fieldMappings", min_length=1, max_length=25)
    label_field: str | None = Field(default=None, alias="labelField", max_length=200)
    # Tabular only: a field's recipe (same shape as a document's computed field), by field.
    field_recipes: dict[str, dict[str, Any]] | None = Field(default=None, alias="fieldRecipes", max_length=50)
    # Tabular only: a field read out of a cell's text with the document reading rules and/or AI, by field.
    field_extractions: dict[str, dict[str, Any]] | None = Field(
        default=None, alias="fieldExtractions", max_length=25)
    mapping_version: str = Field(default="v1", alias="mappingVersion", max_length=200)

    @model_validator(mode="after")
    def validate_mapping_shape(self):  # type: ignore[no-untyped-def]
        if self.source_kind == "document":
            if (self.field_mappings is None or self.column_mapping is not None
                    or self.constant_mapping is not None or self.field_recipes is not None
                    or self.field_extractions is not None):
                raise ValueError("document sources require fieldMappings only")
        elif ((self.column_mapping is None and self.constant_mapping is None)
              or self.field_mappings is not None):
            raise ValueError("tabular sources require columnMapping only")
        return self

    @model_serializer(mode="wrap")
    def serialize(self, handler: SerializerFunctionWrapHandler) -> dict[str, Any]:
        # A source without recipes or cell extractions keeps its historical stored shape.
        data = handler(self)
        if self.field_recipes is None:
            data.pop("fieldRecipes", None)
            data.pop("field_recipes", None)
        if self.field_extractions is None:
            data.pop("fieldExtractions", None)
            data.pop("field_extractions", None)
        return data


class RelationBinding(BaseModel):
    """Compiled matching-plan fields for one relation rule."""

    model_config = ConfigDict(extra="forbid")

    relation_id: str = Field(alias="relationId", min_length=1, max_length=200)
    reference_field: str = Field(alias="referenceField", min_length=1, max_length=200)
    target_field: str | None = Field(default=None, alias="targetField", min_length=1, max_length=200)

    @model_serializer(mode="wrap")
    def serialize(self, handler: SerializerFunctionWrapHandler) -> dict[str, Any]:
        data = handler(self)
        if self.target_field is None:
            data.pop("targetField", None)
            data.pop("target_field", None)
        return data


class DerivationField(BaseModel):
    """A field of the derived concept: copied from a field of the source concept (the default), read
    out of its text with rules and/or AI (``extract``), taken from a field by a recipe (``computed``),
    or fixed (``constant``). Checked in depth by ``app.population.derived.normalize_derivations``."""

    model_config = ConfigDict(extra="forbid")

    source_attribute: str | None = Field(default=None, alias="sourceAttribute", min_length=1, max_length=200)
    target_attribute: str = Field(alias="targetAttribute", min_length=1, max_length=200)
    mode: Literal["direct", "extract", "computed", "constant"] | None = None
    label: str | None = Field(default=None, max_length=200)
    extraction_strategy: Literal["deterministic", "ai", "rules_then_ai"] | None = Field(
        default=None, alias="extractionStrategy")
    rules: dict[str, Any] | None = None
    semantic_definition: str | None = Field(default=None, alias="semanticDefinition", max_length=2000)
    agent_id: str | None = Field(default=None, alias="agentId", max_length=64)
    description: str | None = Field(default=None, max_length=2000)
    value_type: str | None = Field(default=None, alias="valueType", max_length=50)
    allowed_values: list[str] | None = Field(default=None, alias="allowedValues", max_length=200)
    computed: dict[str, Any] | None = None
    constant_value: str | int | float | bool | None = Field(default=None, alias="constantValue")

    @model_serializer(mode="wrap")
    def serialize(self, handler: SerializerFunctionWrapHandler) -> dict[str, Any]:
        # A field copied as it is serializes as it did before the field modes existed.
        data = handler(self)
        return {key: value for key, value in data.items() if value is not None}


class Derivation(BaseModel):
    """A concept made from the distinct key values another concept's records carry."""

    model_config = ConfigDict(extra="forbid")

    derivation_id: str = Field(alias="derivationId", min_length=1, max_length=200)
    concept_id: str = Field(alias="conceptId", min_length=1, max_length=200)
    source_concept_id: str = Field(alias="sourceConceptId", min_length=1, max_length=200)
    field_mappings: list[DerivationField] = Field(alias="fieldMappings", min_length=1, max_length=50)
    conflict_rule: Literal["most_frequent", "latest", "longest", "leave_empty"] = Field(
        default="most_frequent", alias="conflictRule")
    order_by: str | None = Field(default=None, alias="orderBy", max_length=200)
    label_field: str | None = Field(default=None, alias="labelField", max_length=200)
    mapping_version: str = Field(default="v1", alias="mappingVersion", max_length=200)
    # How much of a field's text the AI reads; only present when a field is read by AI.
    ai_settings: dict[str, Any] | None = Field(default=None, alias="aiSettings")
    # One source field expanded into several items, each read as a record (see app.population.expand).
    expand: dict[str, Any] | None = None

    @model_serializer(mode="wrap")
    def serialize(self, handler: SerializerFunctionWrapHandler) -> dict[str, Any]:
        data = handler(self)
        if self.ai_settings is None:
            data.pop("aiSettings", None)
            data.pop("ai_settings", None)
        if self.expand is None:
            data.pop("expand", None)
        return data


class PopulationScope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["model", "mapping"]
    mapping_id: str | None = Field(default=None, alias="mappingId", max_length=200)


class PopulationPayload(BaseModel):
    """Concrete population command (plan 5.4). The canonical specification and
    the resolved source set travel inline as a documented bridge until the
    runtime spec mirror (P1.5/P7) serves ``sourceSetRef`` server-side."""

    model_config = ConfigDict(extra="forbid")

    model_version_id: str = Field(alias="modelVersionId", min_length=1, max_length=200)
    spec_hash: str = Field(alias="specHash", pattern=r"^sha256:[0-9a-f]{64}$")
    population_execution_fingerprint: str | None = Field(
        default=None, alias="populationExecutionFingerprint",
        pattern=r"^sha256:[0-9a-f]{64}$")
    purpose: Literal["preview", "build", "refresh"]
    scope: PopulationScope
    specification: dict[str, Any]
    sources: list[PopulationSource] = Field(min_length=1, max_length=25)
    relation_bindings: list[RelationBinding] = Field(
        default_factory=list, alias="relationBindings", max_length=50)
    # Concepts made from another concept's records, after every source is read.
    derivations: list[Derivation] = Field(default_factory=list, max_length=50)
    # Identity of the AI extractor actually used (agent slug, effective model,
    # contract version), or null when no mapping requests AI extraction. Part of
    # the execution fingerprint so a model change produces a new revision.
    ai_extraction: dict[str, Any] | None = Field(default=None, alias="aiExtraction")
    expected_active_data_revision_id: str | None = Field(
        default=None, alias="expectedActiveDataRevisionId", max_length=200)
    expected_correction_sequence: int = Field(
        default=0, alias="expectedCorrectionSequence", ge=0)
    budget_profile_id: str = Field(
        default="default", alias="budgetProfileId", max_length=200)
    # Run size limits set by an admin (app.population.run_limits); absent means the built-in ones.
    limits: dict[str, int] | None = Field(default=None)

    @model_serializer(mode="wrap")
    def serialize(self, handler: SerializerFunctionWrapHandler) -> dict[str, Any]:
        # A command without derivations serializes as it did before they existed, so its
        # admission hash still matches jobs admitted earlier under the same idempotency key.
        data = handler(self)
        if not self.derivations:
            data.pop("derivations", None)
        if self.limits is None:
            data.pop("limits", None)
        return data


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
                    "suppress", "unsuppress", "revert"]
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
    environment: Literal["draft", "production", "shadow", "test"] = "production"


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


class PublishModelDataCommand(BaseModel):
    """Promote the model's draft data revision to production for a published version."""

    model_config = ConfigDict(extra="forbid")

    actor_user_id: str = Field(alias="actorUserId", min_length=1, max_length=200)
    model_version_id: str = Field(alias="modelVersionId", min_length=1, max_length=200)


class ManualRow(BaseModel):
    model_config = ConfigDict(extra="forbid")

    concept_id: str = Field(alias="conceptId", min_length=1, max_length=200)
    row_key: str = Field(alias="rowKey", min_length=1, max_length=200)
    label: str = Field(default="", max_length=500)
    values: dict[str, Any] = Field(default_factory=dict)


class ManualLink(BaseModel):
    model_config = ConfigDict(extra="forbid")

    relation_id: str = Field(alias="relationId", min_length=1, max_length=200)
    source_row_key: str = Field(alias="sourceRowKey", min_length=1, max_length=200)
    target_row_key: str = Field(alias="targetRowKey", min_length=1, max_length=200)


class ManualBatchCommand(BaseModel):
    """One batch of a manual source snapshot; batches are appended until commit."""

    model_config = ConfigDict(extra="forbid")

    rows: list[ManualRow] = Field(default_factory=list, max_length=500)
    links: list[ManualLink] = Field(default_factory=list, max_length=500)


class ManualCommitCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")

    row_count: int = Field(alias="rowCount", ge=0)
    link_count: int = Field(alias="linkCount", ge=0)
