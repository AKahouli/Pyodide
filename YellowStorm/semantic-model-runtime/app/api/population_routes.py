"""Population API group. Heavy work lives in workers, never here.
Run admission (P2.1) plus the Phase 6 human-control commands (P6.8-P6.16):
corrections record durably with optimistic concurrency, review resolution is
fenced on the open state, and revision activation compare-and-swaps the
serving tuple. None of these write AGE or projections directly."""

from __future__ import annotations

import hashlib
import json
import logging
import os
from typing import Any, Literal

from fastapi import APIRouter, Body, Header, HTTPException, Path, Request, Response, status
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.graph_search.indexer import request_index_quietly
from app.jobs.models import (ActivateRevisionCommand, CorrectionCommand, IdempotencyConflict,
                             ManualBatchCommand, ManualCommitCommand,
                             MirrorSpecificationCommand, PopulationCommand, PublishModelDataCommand,
                             ReviewResolveCommand)
from app.persistence import graph_window_store as window_store
from app.persistence import manual_store
from app.persistence import population_store as store
from app.population.age_projection import (ProjectionUnavailable, projection_graph,
                                             drop_projection, ensure_revision_projection,
                                             is_live_projection_ref, projection_exists,
                                             graph_counts, is_typed_projection,
                                             normalize_graph_exposure, read_projection_graph,
                                             read_projection_nodes, reproject_revision,
                                             restore_hidden_values, stored_graph_exposure)
from app.population.engine_version import population_engine_version
from app.population.compiler import (PopulationError, canonical_spec_hash, validate_specification)
from app.population.model_check import check_model
from app.workers.celery_app import POPULATION_QUEUES

router = APIRouter(prefix="/v1/semantic-model-population", tags=["population"])
logger = logging.getLogger(__name__)



def _engine_key(idempotency_key: str) -> str:
    """The caller's key for this runtime version; hashed when it would not fit the 200 characters."""
    key = f"{idempotency_key}:{population_engine_version()}"
    return key if len(key) <= 200 else "sha256:" + hashlib.sha256(key.encode()).hexdigest()

@router.post("/runs", status_code=status.HTTP_202_ACCEPTED)
async def request_run(
    command: PopulationCommand,
    request: Request,
    idempotency_key: str = Header(alias="Idempotency-Key", min_length=1, max_length=200),
) -> dict[str, object]:
    if os.environ.get("SEMANTIC_MODEL_RUNTIME_WRITES_ENABLED") != "true":
        raise HTTPException(status_code=503, detail="runtime_writes_disabled")
    service = getattr(request.app.state, "job_service", None)
    if service is None:
        raise HTTPException(status_code=503, detail="jobs_unavailable")
    try:
        admission = await service.admit(
            job_type="population.run",
            command=command,
            # A changed runtime is a new build, not the same one again.
            idempotency_key=_engine_key(idempotency_key),
            task_name="semantic-model-population.run",
            queue_name=POPULATION_QUEUES[1],
        )
    except IdempotencyConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {
        "jobId": admission.job_id,
        "status": admission.state,
        "progressUrl": f"/v1/semantic-model-jobs/{admission.job_id}",
        "reused": admission.reused,
    }


def _population_pool(request: Request):  # type: ignore[no-untyped-def]
    if os.environ.get("SEMANTIC_MODEL_RUNTIME_WRITES_ENABLED") != "true":
        raise HTTPException(status_code=503, detail="runtime_writes_disabled")
    pool = getattr(request.app.state, "population_pool", None)
    if pool is None:
        raise HTTPException(status_code=503, detail="population_store_unavailable")
    return pool


def _population_read_pool(request: Request):  # type: ignore[no-untyped-def]
    pool = getattr(request.app.state, "population_pool", None)
    if pool is None:
        raise HTTPException(status_code=503, detail="population_store_unavailable")
    return pool


def _age_pool(request: Request):  # type: ignore[no-untyped-def]
    pool = getattr(request.app.state, "age_pool", None)
    if pool is None:
        raise HTTPException(status_code=503, detail="age_projection_unavailable")
    return pool


@router.post("/specifications", status_code=status.HTTP_200_OK)
async def mirror_specification(command: MirrorSpecificationCommand,
                               request: Request) -> dict[str, object]:
    pool = _population_pool(request)
    issues = validate_specification(command.specification)
    if issues:
        raise HTTPException(status_code=422, detail="invalid_specification")
    try:
        actual = canonical_spec_hash(command.specification)
    except Exception as exc:
        raise HTTPException(status_code=422, detail="invalid_specification") from exc
    if actual != command.spec_hash:
        raise HTTPException(status_code=422, detail="spec_hash_mismatch")
    existing = await store.get_specification(pool, command.home_workspace_id,
                                             command.model_id, command.model_version_id,
                                             command.spec_hash)
    try:
        await store.mirror_specification(
            pool, home_workspace_id=command.home_workspace_id, model_id=command.model_id,
            model_version_id=command.model_version_id, spec_hash=command.spec_hash,
            specification=command.specification, select_current=True)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"modelId": command.model_id, "modelVersionId": command.model_version_id,
            "specHash": command.spec_hash, "reused": existing is not None}


@router.post("/check", status_code=status.HTTP_200_OK)
async def check_model_plan(body: dict) -> dict[str, object]:
    """Every problem a preview or build of this plan would stop on, listed at once. Pure validation:
    the same rules as a run, nothing read, stored or sent (the 256 KiB body limit bounds the work)."""
    return check_model(body)


class _WorkspaceScoped(BaseModel):
    """Body of a workspace-scoped read. NestJS computes the scope from the actor's current
    workspace access; a missing, null or oversized one is a validation failure — never
    "all workspaces". An empty list is honest: only source-free (manual) records show."""

    model_config = ConfigDict(extra="forbid")

    actor_user_id: str = Field(alias="actorUserId", min_length=1, max_length=200)
    environment: Literal["draft"] = "draft"
    data_revision_id: str | None = Field(default=None, alias="dataRevisionId", max_length=200)
    allowed_workspace_ids: list[str] = Field(alias="allowedWorkspaceIds", max_length=2000)

    @field_validator("allowed_workspace_ids")
    @classmethod
    def _bounded_ids(cls, value: list[str]) -> list[str]:
        if any(not item or len(item) > 200 for item in value):
            raise ValueError("workspace id must be 1..200 characters")
        return value


class ScopedGraphRead(_WorkspaceScoped):
    pass


MAX_GRAPH_WINDOW_NODES = 5000
DEFAULT_GRAPH_WINDOW_NODES = 2000


class ScopedGraphWindowRead(_WorkspaceScoped):
    """A bounded part of the graph: at most ``nodeLimit`` records (shared among the concepts, or
    all of one ``conceptId``), or the ``focusIds`` records with their neighbours."""

    node_limit: int = Field(DEFAULT_GRAPH_WINDOW_NODES, alias="nodeLimit", ge=1, le=MAX_GRAPH_WINDOW_NODES)
    concept_id: str | None = Field(default=None, alias="conceptId", max_length=200)
    focus_ids: list[str] = Field(default_factory=list, alias="focusIds", max_length=50)
    neighbours: bool = True

    @field_validator("focus_ids")
    @classmethod
    def _bounded_focus(cls, value: list[str]) -> list[str]:
        if any(not item or len(item) > 300 for item in value):
            raise ValueError("record id must be 1..300 characters")
        return value


class ScopedRecordsRead(_WorkspaceScoped):
    limit: int = Field(25, ge=1, le=50)
    concept_id: str | None = Field(default=None, alias="conceptId", max_length=200)


class ScopedConceptRecordsRead(_WorkspaceScoped):
    q: str | None = Field(default=None, max_length=200)
    limit: int = Field(50, ge=1, le=200)
    offset: int = Field(0, ge=0, le=1_000_000)
    filters: dict[str, str] | None = None


def _bounded_record_filters(filters: dict[str, str] | None) -> dict[str, str]:
    """Per-field filters of the records table: at most 30 fields, each text at most 200 characters."""
    filters = filters or {}
    if (len(filters) > 30
            or any(not isinstance(key, str) or not key or len(key) > 200
                   or not isinstance(value, str) or len(value) > 200
                   for key, value in filters.items())):
        raise HTTPException(status_code=422, detail="invalid_record_filters")
    return {key: value for key, value in filters.items() if value.strip()}


async def _pinned_draft_revision(pool: Any, model_id: str, data_revision_id: str | None) -> dict[str, Any]:
    """The draft binding, pinned to the asked revision when one is named (409 when it moved)."""
    binding = await store.get_active_binding(pool, model_id, "draft")
    if binding is None:
        raise HTTPException(status_code=404, detail="active_binding_not_found")
    if data_revision_id is not None and data_revision_id != binding["data_revision_id"]:
        raise HTTPException(status_code=409, detail="active_binding_changed")
    return binding


async def _restore_graph_values(pool: Any, binding: dict[str, Any], nodes: list[dict[str, Any]]) -> None:
    """A graph built with hidden or cut fields lacks their values: give them back to the nodes read
    from it, from the records stored with the revision (the same values the records table shows).
    ``binding`` is the draft binding read, which carries the exposure its graph was built with."""
    exposure = stored_graph_exposure({"graphExposure": binding.get("graph_exposure")})
    if exposure:
        await restore_hidden_values(pool, binding["data_revision_id"], nodes, exposure)


def _scoped_gaps(gaps: Any, allowed: list[str], hidden: set[str]) -> Any:
    """Gaps narrowed to the records this scope may see. The stored groups count the whole
    revision, so with anything hidden they would leak hidden record counts: the samples stay
    (scoped), the counts go. With nothing hidden the stored groups are already this scope's."""
    if not isinstance(gaps, dict):
        gaps = None
    gaps = gaps or {"missingValues": [], "unresolvedLinks": [], "other": []}
    if not hidden:
        return gaps
    workspaces = set(allowed)

    def sample_visible(sample: dict[str, Any]) -> bool:
        workspace_id = (sample.get("asset") or {}).get("workspaceId")
        return workspace_id is None or workspace_id in workspaces

    return {
        "missingValues": [], "unresolvedLinks": [], "other": [],
        "rowSamples": [sample for sample in (gaps.get("rowSamples") or [])
                       if isinstance(sample, dict) and sample_visible(sample)],
        "linkSamples": [sample for sample in (gaps.get("linkSamples") or [])
                        if isinstance(sample, dict) and sample.get("sourceEntityId") not in hidden],
    }


@router.get("/models/{model_id}/concepts/{concept_id}/records", status_code=status.HTTP_410_GONE)
async def search_concept_records_gone(model_id: str, concept_id: str) -> dict[str, object]:
    """Removed: it returned every record of the concept, whatever the caller may read.
    The workspace-scoped read is POST .../records/read."""
    raise HTTPException(status_code=status.HTTP_410_GONE, detail="endpoint_removed")


@router.post("/models/{model_id}/concepts/{concept_id}/records/read", status_code=status.HTTP_200_OK)
async def search_scoped_concept_records(model_id: str, concept_id: str, command: ScopedConceptRecordsRead,
                                        request: Request) -> dict[str, object]:
    """Browse one concept's records in the data in use, narrowed to the workspaces NestJS
    authorized for this actor: searchable, filterable per field, a page at a time."""
    field_filters = _bounded_record_filters(command.filters)
    pool = _population_read_pool(request)
    binding = await _pinned_draft_revision(pool, model_id, command.data_revision_id)
    total, entities = await store.search_revision_entities(
        pool, binding["data_revision_id"], concept_id, query=command.q, limit=command.limit,
        offset=command.offset, filters=field_filters,
        allowed_workspace_ids=command.allowed_workspace_ids)
    origins = await store.list_entity_origins(pool, binding["data_revision_id"],
                                              sorted(entity["entityId"] for entity in entities))
    for entity in entities:
        entity["origins"] = origins.get(entity["entityId"], {})
    return {"modelId": model_id, "conceptId": concept_id, "dataRevisionId": binding["data_revision_id"],
            "total": total, "offset": command.offset, "limit": command.limit, "entities": entities}


@router.get("/models/{model_id}/records", status_code=status.HTTP_410_GONE)
async def read_bound_records_gone(model_id: str) -> dict[str, object]:
    """Removed: it returned every record, whatever the caller may read.
    The workspace-scoped read is POST .../records/read."""
    raise HTTPException(status_code=status.HTTP_410_GONE, detail="endpoint_removed")


@router.post("/models/{model_id}/records/read", status_code=status.HTTP_200_OK)
async def read_scoped_records(model_id: str, command: ScopedRecordsRead, request: Request) -> dict[str, object]:
    """The data in use, narrowed to the workspaces NestJS authorized for this actor: the page's
    records, the links whose two ends are visible, visible counts, and gaps of visible records."""
    pool = _population_read_pool(request)
    binding = await _pinned_draft_revision(pool, model_id, command.data_revision_id)
    revision_id = binding["data_revision_id"]
    allowed = command.allowed_workspace_ids
    _visible, hidden = await store.split_entity_visibility(pool, revision_id, allowed)
    entities = await store.list_revision_entities_visible(
        pool, revision_id, command.limit, command.concept_id, allowed)
    origins = await store.list_entity_origins(pool, revision_id,
                                              sorted(entity["entityId"] for entity in entities))
    for entity in entities:
        entity["origins"] = origins.get(entity["entityId"], {})
    counts = await store.count_revision_rows_visible(pool, revision_id, allowed)
    # Records per concept over the visible records: the entity list below is only a page of it.
    concept_counts = await store.count_revision_entities_by_concept_visible(pool, revision_id, allowed)
    relationships = await store.list_revision_relationships_visible(pool, revision_id, allowed)
    revision = await store.get_data_revision(pool, revision_id)
    coverage = (revision or {}).get("coverage") or {}
    if isinstance(coverage, str):
        coverage = json.loads(coverage)
    gaps = _scoped_gaps(coverage.get("gaps") if isinstance(coverage, dict) else None, allowed, hidden)
    specification = await store.get_revision_specification(pool, revision_id)
    if specification is None:
        raise HTTPException(status_code=409, detail="revision_specification_not_found")
    return {"modelId": model_id, "modelVersionId": binding["model_version_id"],
            "dataRevisionId": revision_id, "entities": entities,
            "relationships": relationships, "counts": counts, "conceptCounts": concept_counts,
            # Lets the caller tell whether this data was built from the model as it is now.
            "executionFingerprint": (revision or {}).get("execution_fingerprint"),
            "gaps": gaps,
            "specification": specification}


@router.get("/models/{model_id}/graph", status_code=status.HTTP_410_GONE)
async def read_bound_graph_gone(model_id: str) -> dict[str, object]:
    """Removed: it returned the whole graph, whatever the caller may read.
    The workspace-scoped read is POST .../graph/read."""
    raise HTTPException(status_code=status.HTTP_410_GONE, detail="endpoint_removed")


@router.post("/models/{model_id}/graph/read", status_code=status.HTTP_200_OK)
async def read_scoped_graph(model_id: str, command: ScopedGraphRead, request: Request) -> dict[str, object]:
    """The draft graph, narrowed to the workspaces NestJS authorized for this actor: a node
    shows only when every workspace its record was read from is in the scope, and a link only
    when both of its ends do. Provenance is read from the canonical revision rows, never from
    the graph copy, and a record the store cannot vouch for stays hidden."""
    pool = _population_read_pool(request)
    binding = await _pinned_draft_revision(pool, model_id, command.data_revision_id)
    try:
        graph = await read_projection_graph(_age_pool(request), binding["projection_ref"])
    except PopulationError as exc:
        raise HTTPException(status_code=409, detail=exc.code) from exc
    visible, _hidden = await store.split_entity_visibility(
        pool, binding["data_revision_id"], command.allowed_workspace_ids)
    if visible != {node["id"] for node in graph["nodes"]}:
        graph = {
            "nodes": [node for node in graph["nodes"] if node["id"] in visible],
            "edges": [edge for edge in graph["edges"]
                      if edge["sourceId"] in visible and edge["targetId"] in visible],
        }
    await _restore_graph_values(pool, binding, graph["nodes"])
    specification = await store.get_revision_specification(pool, binding["data_revision_id"])
    if specification is None:
        raise HTTPException(status_code=409, detail="revision_specification_not_found")
    return {"modelId": model_id, "modelVersionId": binding["model_version_id"],
            "dataRevisionId": binding["data_revision_id"],
            "specification": specification, **graph}


@router.post("/models/{model_id}/graph/window", status_code=status.HTTP_200_OK)
async def read_scoped_graph_window(model_id: str, command: ScopedGraphWindowRead,
                                   request: Request) -> dict[str, object]:
    """A bounded part of the draft graph under the same workspace rule as ``graph/read``: only
    visible records are chosen (in SQL, over the canonical rows), only they are read from the
    graph, and the counts are of visible records and links. Without ``focusIds`` the window is
    the first records of the data, shared evenly among the concepts (or all from one concept)
    plus the visible totals; with them it is those records and, unless ``neighbours`` is false,
    the records linked to them."""
    pool = _population_read_pool(request)
    binding = await _pinned_draft_revision(pool, model_id, command.data_revision_id)
    revision_id = binding["data_revision_id"]
    allowed = command.allowed_workspace_ids
    totals: dict[str, object] | None = None
    if command.focus_ids:
        records, truncated = await window_store.select_focus_records(
            pool, revision_id, allowed, command.focus_ids, neighbours=command.neighbours,
            limit=command.node_limit)
    else:
        overview = await window_store.count_visible_overview(pool, revision_id, allowed)
        concept_counts = overview["concepts"]
        if command.concept_id is not None:
            concept_counts = {command.concept_id: concept_counts.get(command.concept_id, 0)}
        quotas = window_store.allocate_quotas(concept_counts, command.node_limit)
        records = await window_store.select_visible_records(pool, revision_id, allowed, quotas)
        truncated = len(records) < sum(concept_counts.values())
        totals = {"records": sum(overview["concepts"].values()), "links": sum(overview["relations"].values()),
                  "concepts": overview["concepts"], "relations": overview["relations"]}
    try:
        nodes = await read_projection_nodes(_age_pool(request), binding["projection_ref"],
                                            [record_id for record_id, _concept in records])
    except PopulationError as exc:
        raise HTTPException(status_code=409, detail=exc.code) from exc
    await _restore_graph_values(pool, binding, nodes)
    shown = {node["id"] for node in nodes}
    edges = [{"id": f"{link['relationId']}:{link['sourceId']}:{link['targetId']}", "label": link["relationId"],
              "sourceId": link["sourceId"], "targetId": link["targetId"],
              "properties": {"relation_id": link["relationId"]}}
             for link in await window_store.list_links_among(pool, revision_id, sorted(shown))]
    specification = await store.get_revision_specification(pool, revision_id)
    if specification is None:
        raise HTTPException(status_code=409, detail="revision_specification_not_found")
    return {"modelId": model_id, "modelVersionId": binding["model_version_id"],
            "dataRevisionId": revision_id, "specification": specification,
            "nodes": nodes, "edges": edges, "truncated": truncated,
            "nodeLimit": command.node_limit, "totals": totals}


@router.post("/corrections", status_code=status.HTTP_200_OK)
async def record_correction(command: CorrectionCommand, request: Request) -> dict[str, object]:
    """Record a correction. The sequence check is advisory optimistic
    concurrency: two concurrent writers with the same expectation both insert
    (BIGSERIAL preserves both), and rebuilds serialize on MAX(sequence)."""
    pool = _population_pool(request)
    if not isinstance(command.target_identity, dict) or not command.target_identity:
        raise HTTPException(status_code=422, detail="invalid_target_identity")
    if command.data_revision_id is not None:
        revision = await store.get_data_revision(pool, command.data_revision_id)
        if revision is None or revision["model_id"] != command.model_id:
            raise HTTPException(status_code=422, detail="unknown_data_revision")
    current = await store.model_correction_sequence(pool, command.model_id)
    if current != command.expected_correction_sequence:
        raise HTTPException(status_code=409, detail="stale_correction_sequence")
    if command.action == "revert":
        target = command.payload.get("sequence")
        if isinstance(target, bool) or not isinstance(target, int) or target < 1 or target > current:
            raise HTTPException(status_code=422, detail="invalid_revert_target")
    sequence = await store.record_correction(
        pool, model_id=command.model_id, model_version_id=command.model_version_id,
        actor_user_id=command.actor_user_id, reason=command.reason,
        target_identity=command.target_identity, action=command.action,
        payload=command.payload, data_revision_id=command.data_revision_id)
    return {"sequence": sequence, "modelId": command.model_id, "state": "accepted"}


@router.get("/models/{model_id}/corrections", status_code=status.HTTP_200_OK)
async def list_corrections(model_id: str, request: Request) -> dict[str, object]:
    """Corrections still in force (undone ones and undos themselves omitted)
    plus the model's correction watermark for the next write."""
    from app.population.corrections import corrections_in_force

    pool = _population_read_pool(request)
    corrections = await store.list_model_corrections(pool, model_id)
    return {"modelId": model_id,
            "correctionSequence": await store.model_correction_sequence(pool, model_id),
            "corrections": corrections_in_force(corrections)}


@router.post("/reviews/{review_id}/resolve", status_code=status.HTTP_200_OK)
async def resolve_review(review_id: str, command: ReviewResolveCommand,
                         request: Request) -> dict[str, object]:
    pool = _population_pool(request)
    item = await store.get_review_item(pool, review_id)
    if item is None or item["model_id"] != command.model_id:
        raise HTTPException(status_code=404, detail="review_not_found")
    if item["state"] == "resolved":
        if item["resolution"] == command.resolution:
            return {"reviewId": review_id, "state": "resolved", "reused": True}
        raise HTTPException(status_code=409, detail="review_resolution_conflict")
    resolved = await store.resolve_review_item(
        pool, review_id=review_id, model_id=command.model_id,
        resolution=command.resolution, resolved_by=command.actor_user_id,
        emit_signal=os.environ.get("SEMANTIC_MODEL_REALTIME_ENABLED") == "true")
    if not resolved:
        raise HTTPException(status_code=409, detail="review_resolution_conflict")
    return {"reviewId": review_id, "state": "resolved", "reused": False}


class PurgeModelDataCommand(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    forget_document_reading: bool = Field(default=False, alias="forgetDocumentReading")
    # The admin's purge time (Admin > Semantic models); absent means the built-in one.
    timeout_seconds: int = Field(default=store.DEFAULT_PURGE_TIMEOUT_S, alias="timeoutSeconds",
                                 ge=30, le=3600)


@router.post("/models/{model_id}/purge", status_code=status.HTTP_200_OK)
async def purge_model_data(model_id: str, command: PurgeModelDataCommand,
                           request: Request) -> dict[str, object]:
    """Clear a model's built data so the next build starts from nothing; its settings stay."""
    if not model_id or len(model_id) > 200:
        raise HTTPException(status_code=422, detail="invalid_model_id")
    pool = _population_pool(request)
    try:
        result = await store.purge_model_data(
            pool, model_id, forget_document_reading=command.forget_document_reading,
            timeout_s=command.timeout_seconds,
            emit_signal=os.environ.get("SEMANTIC_MODEL_REALTIME_ENABLED") == "true")
    except store.PopulationRunning as exc:
        raise HTTPException(status_code=409, detail="population_running") from exc
    # The graphs of the cleared revisions go too; one left behind is only unused space.
    age_pool = getattr(request.app.state, "age_pool", None)
    dropped = 0
    for ref in result.pop("projections"):
        if age_pool is None or not is_live_projection_ref(ref):
            continue
        graph = projection_graph(ref)
        try:
            async with age_pool.acquire() as connection:
                if await projection_exists(connection, graph):
                    await drop_projection(connection, graph)
                    dropped += 1
        except Exception as exc:  # noqa: BLE001 - the data is already cleared
            logger.warning("Could not drop graph %s of model %s: %s", graph, model_id,
                           type(exc).__name__)
    return {**result, "projectionsDropped": dropped}


class ForgetReadingsCommand(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")
    concept_id: str | None = Field(default=None, alias="conceptId", min_length=1, max_length=200)


@router.post("/models/{model_id}/forget-readings", status_code=status.HTTP_200_OK)
async def forget_document_readings(model_id: str, request: Request,
                                   command: ForgetReadingsCommand | None = None) -> dict[str, object]:
    """Forget the model's earlier AI readings of documents (one concept's when ``conceptId`` is
    given) so the next run reads them again. Records, links and the data in use stay as they are."""
    if not model_id or len(model_id) > 200:
        raise HTTPException(status_code=422, detail="invalid_model_id")
    try:
        forgotten = await store.forget_document_readings(_population_pool(request), model_id,
                                                         command.concept_id if command else None)
    except store.PopulationRunning as exc:
        raise HTTPException(status_code=409, detail="population_running") from exc
    return {"modelId": model_id, "documentReadings": forgotten}


@router.get("/models/{model_id}/graph-status", status_code=status.HTTP_200_OK)
async def read_graph_status(model_id: str, request: Request) -> dict[str, object]:
    """Which graph each environment serves (schema, revision, layout), what it holds compared
    with the stored records and links, and the state of its search index. Read only."""
    from app.graph_search.embeddings import profile_from_env
    from app.persistence import graph_search_store as search_store

    if not model_id or len(model_id) > 200:
        raise HTTPException(status_code=422, detail="invalid_model_id")
    pool = _population_read_pool(request)
    age_pool = getattr(request.app.state, "age_pool", None)
    profile = profile_from_env()
    environments: list[dict[str, Any]] = []
    for served in await store.served_graphs(pool, model_id):
        ref = served["projection_ref"]
        graph = projection_graph(ref) if is_live_projection_ref(ref) else None
        counts = None
        if graph and age_pool is not None:
            try:
                async with age_pool.acquire() as connection:
                    counts = await graph_counts(connection, graph)
            except Exception as exc:  # noqa: BLE001 - the status says the graph could not be read
                logger.warning("Could not count graph %s: %s", graph, type(exc).__name__)
        stored = {"records": int(served["records"]), "links": int(served["links"])}
        if counts is None:
            state = "missing"
        elif counts["vertices"] != stored["records"] or counts["edges"] != stored["links"]:
            state = "mismatch"
        else:
            state = "ok"
        generation = (await search_store.latest_generation(pool, served["data_revision_id"], profile.fingerprint)
                      if profile else None)
        index = search_store.public_generation(generation)
        created = served["created_at"]
        environments.append({
            "environment": served["environment"], "dataRevisionId": served["data_revision_id"],
            "modelVersionId": served["model_version_id"], "projectionRef": ref, "graphSchema": graph,
            "layout": "typed" if is_typed_projection(ref) else "entity",
            "builtAt": created.isoformat() if hasattr(created, "isoformat") else created,
            "stored": stored, "graph": counts, "state": state,
            "index": {key: index.get(key) for key in ("state", "expectedCount", "indexedCount", "completedAt")},
        })
    return {"modelId": model_id, "environments": environments}


@router.post("/models/{model_id}/reproject", status_code=status.HTTP_200_OK)
async def reproject_model_graphs(model_id: str, request: Request,
                                 body: dict[str, Any] | None = Body(default=None)) -> dict[str, object]:
    """Rebuild the graphs of the data a model serves from its stored records and links: no
    source is read again and no record changes. Refused while a build runs. ``graphExposure`` in the
    body (see :func:`normalize_graph_exposure`) is the fields each concept shows in the rebuilt
    graphs; without it they keep the exposure they have."""
    if not model_id or len(model_id) > 200:
        raise HTTPException(status_code=422, detail="invalid_model_id")
    try:
        exposure = (normalize_graph_exposure(body["graphExposure"])
                    if isinstance(body, dict) and body.get("graphExposure") is not None else None)
    except PopulationError as exc:
        raise HTTPException(status_code=422, detail=exc.code) from exc
    pool = _population_pool(request)
    age_pool = _age_pool(request)
    if await store.population_running(pool, model_id):
        raise HTTPException(status_code=409, detail="population_running")
    rebuilt: list[dict[str, Any]] = []
    for revision_id in await store.served_revisions(pool, model_id):
        try:
            rebuilt.append(await reproject_revision(pool, age_pool, revision_id, force=True, exposure=exposure))
        except PopulationError as exc:
            raise HTTPException(status_code=409, detail=exc.code) from exc
        except ProjectionUnavailable as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
    logger.info("Rebuilt the graphs of model %s: %s", model_id, rebuilt)
    return {"modelId": model_id, "revisions": rebuilt}


@router.delete("/models/{model_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_model(model_id: str, request: Request) -> Response:
    """Delete everything the runtime holds for a model: data, review items, search index,
    jobs, specifications and its graphs. Idempotent; refused while one of its jobs runs.
    Source documents belong to workspaces and are never touched."""
    if not model_id or len(model_id) > 200:
        raise HTTPException(status_code=422, detail="invalid_model_id")
    pool = getattr(request.app.state, "population_pool", None)
    if pool is None:
        raise HTTPException(status_code=503, detail="population_store_unavailable")
    try:
        result = await store.delete_model(pool, model_id)
    except store.ModelJobsRunning as exc:
        raise HTTPException(status_code=409, detail="model_jobs_running") from exc
    age_pool = getattr(request.app.state, "age_pool", None)
    failed = 0
    for ref in result["projections"]:
        if age_pool is None or not is_live_projection_ref(ref):
            continue
        graph = projection_graph(ref)
        try:
            async with age_pool.acquire() as connection:
                if await projection_exists(connection, graph):
                    await drop_projection(connection, graph)
        except Exception as exc:  # noqa: BLE001 - the rows are already gone
            failed += 1
            logger.warning("Could not drop graph %s of deleted model %s: %s", graph, model_id,
                           type(exc).__name__)
    logger.info("Deleted runtime data of model %s: %s (graphs not dropped: %d)",
                model_id, result["deleted"], failed)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


class CloneDataIdMap(BaseModel):
    model_config = ConfigDict(extra="forbid")

    concepts: dict[str, str] = Field(default_factory=dict)
    attributes: dict[str, str] = Field(default_factory=dict)
    relations: dict[str, str] = Field(default_factory=dict)
    mappings: dict[str, str] = Field(default_factory=dict)


class CloneDataCommand(BaseModel):
    """Copy a model's draft data into a clone whose ids the back already remapped."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    target_model_id: str = Field(alias="targetModelId", min_length=1, max_length=200)
    target_model_version_id: str = Field(alias="targetModelVersionId", min_length=1, max_length=200)
    id_map: CloneDataIdMap = Field(alias="idMap", default_factory=CloneDataIdMap)
    # The clone's own build plan, sent when the source data is current, so the copy reads as current.
    home_workspace_id: str | None = Field(default=None, alias="homeWorkspaceId", max_length=200)
    spec_hash: str | None = Field(default=None, alias="specHash", pattern=r"^sha256:[0-9a-f]{64}$")
    specification: dict[str, Any] | None = None
    execution_fingerprint: str | None = Field(default=None, alias="executionFingerprint", max_length=200)


@router.post("/models/{model_id}/clone-data", status_code=status.HTTP_200_OK)
async def clone_model_data(model_id: str, command: CloneDataCommand,
                           request: Request) -> dict[str, object]:
    """Copy the draft data revision of ``model_id`` into the (empty) clone, project its
    graph and serve it as the clone's draft data. The search index is requested, not copied.
    Refused (409) while a job of the source runs. Source documents are never copied."""
    from app.persistence import model_clone_store as clone_store

    if not model_id or len(model_id) > 200 or command.target_model_id == model_id:
        raise HTTPException(status_code=422, detail="invalid_model_id")
    planned = None
    if command.specification is not None or command.spec_hash is not None:
        if (command.specification is None or command.spec_hash is None or not command.home_workspace_id
                or canonical_spec_hash(command.specification) != command.spec_hash):
            raise HTTPException(status_code=422, detail="spec_hash_mismatch")
        planned = {"homeWorkspaceId": command.home_workspace_id, "specHash": command.spec_hash,
                   "specification": command.specification,
                   "executionFingerprint": command.execution_fingerprint}
    pool = _population_pool(request)
    age_pool = _age_pool(request)
    id_map = {**command.id_map.concepts, **command.id_map.attributes,
              **command.id_map.relations, **command.id_map.mappings}
    try:
        result = await clone_store.clone_model_data(
            pool, source_model_id=model_id, target_model_id=command.target_model_id,
            target_model_version_id=command.target_model_version_id, id_map=id_map, planned=planned)
    except store.ModelJobsRunning as exc:
        raise HTTPException(status_code=409, detail="model_jobs_running") from exc
    except clone_store.CloneTargetNotEmpty as exc:
        raise HTTPException(status_code=409, detail="target_has_data") from exc
    if not result["copied"]:
        return result
    try:
        projection = await ensure_revision_projection(pool, age_pool, result["revisionId"])
    except (PopulationError, ProjectionUnavailable) as exc:
        # Leave no half-copied data behind: the clone simply has none.
        await store.delete_model(pool, command.target_model_id)
        logger.warning("Clone of %s into %s: graph not built (%s); copied data removed",
                       model_id, command.target_model_id, getattr(exc, "code", type(exc).__name__))
        raise HTTPException(status_code=503, detail="clone_projection_failed") from exc
    await clone_store.activate_cloned_revision(
        pool, model_id=command.target_model_id, model_version_id=command.target_model_version_id,
        revision_id=result["revisionId"], projection_ref=projection["projectionRef"],
        correction_sequence=result["correctionSequence"])
    service = getattr(request.app.state, "job_service", None)
    await request_index_quietly(pool, service.admit if service else None, result["revisionId"])
    logger.info("Cloned data of model %s into %s: %s", model_id, command.target_model_id, result["counts"])
    return {**result, "projectionRef": projection["projectionRef"]}


@router.post("/revisions/{revision_id}/project", status_code=status.HTTP_200_OK)
async def project_revision(revision_id: str, request: Request) -> dict[str, object]:
    """Build and validate the immutable AGE graph before recording it (P6.16)."""
    pool = _population_pool(request)
    try:
        return await ensure_revision_projection(pool, _age_pool(request), revision_id)
    except PopulationError as exc:
        status_code = 404 if exc.code == "revision_not_found" else 409
        raise HTTPException(status_code=status_code, detail=exc.code) from exc
    except ProjectionUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post("/revisions/{revision_id}/activate", status_code=status.HTTP_200_OK)
async def activate_revision(revision_id: str, command: ActivateRevisionCommand,
                            request: Request) -> dict[str, object]:
    pool = _population_pool(request)
    revision = await store.get_data_revision(pool, revision_id)
    if revision is None or revision["model_id"] != command.model_id:
        raise HTTPException(status_code=404, detail="revision_not_found")
    if revision["validation_state"] != "valid":
        raise HTTPException(status_code=409, detail="revision_not_valid")
    if not is_live_projection_ref(revision["projection_ref"]):
        raise HTTPException(status_code=409, detail="revision_not_projected")
    current_sequence = await store.model_correction_sequence(pool, command.model_id)
    if current_sequence != command.expected_correction_sequence:
        raise HTTPException(status_code=409, detail="stale_correction_sequence")
    if revision["correction_sequence"] != current_sequence:
        raise HTTPException(status_code=409, detail="stale_revision_watermark")
    current = await store.get_active_binding(pool, command.model_id, command.environment)
    if command.expected_active_data_revision_id is None:
        if current is not None:
            raise HTTPException(status_code=409, detail="active_binding_exists")
        expected_version = None
    else:
        if current is None or current["data_revision_id"] != command.expected_active_data_revision_id:
            raise HTTPException(status_code=409, detail="stale_active_binding")
        expected_version = current["version"]
    swapped = await store.cas_active_binding(
        pool, model_id=command.model_id, environment=command.environment,
        expected_version=expected_version, model_version_id=command.model_version_id,
        data_revision_id=revision_id, projection_ref=revision["projection_ref"],
        correction_sequence=current_sequence, spec_hash=revision["spec_hash"],
        emit_signal=os.environ.get("SEMANTIC_MODEL_REALTIME_ENABLED") == "true")
    if not swapped:
        raise HTTPException(status_code=409, detail="activation_race")
    binding = await store.get_active_binding(pool, command.model_id, command.environment)
    return {"modelId": command.model_id, "environment": command.environment,
            "active": binding}


@router.post("/models/{model_id}/publish", status_code=status.HTTP_200_OK)
async def publish_model_data(model_id: str, command: PublishModelDataCommand,
                             request: Request) -> dict[str, object]:
    """Serve the draft data revision in production once its model version is published.

    Only data built from that exact version is promoted; the binding CAS also
    refuses a revision whose specification is no longer current for it.
    """
    pool = _population_pool(request)
    draft = await store.get_active_binding(pool, model_id, "draft")
    if draft is None:
        raise HTTPException(status_code=409, detail="no_draft_data")
    if draft["model_version_id"] != command.model_version_id:
        raise HTTPException(status_code=409, detail="draft_data_outdated")
    revision_id = draft["data_revision_id"]
    revision = await store.get_data_revision(pool, revision_id)
    if revision is None:
        raise HTTPException(status_code=409, detail="no_draft_data")
    try:
        projection = await ensure_revision_projection(pool, _age_pool(request), revision_id)
    except PopulationError as exc:
        raise HTTPException(status_code=409, detail=exc.code) from exc
    except ProjectionUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    # Published data is searched by chat: make sure its index exists (normally already built as draft).
    service = getattr(request.app.state, "job_service", None)
    await request_index_quietly(pool, service.admit if service else None, revision_id)
    current = await store.get_active_binding(pool, model_id, "production")
    if current is not None and current["data_revision_id"] == revision_id             and current["model_version_id"] == command.model_version_id:
        return {"modelId": model_id, "environment": "production", "active": current, "reused": True}
    swapped = await store.cas_active_binding(
        pool, model_id=model_id, environment="production",
        expected_version=None if current is None else current["version"],
        model_version_id=command.model_version_id, data_revision_id=revision_id,
        projection_ref=projection["projectionRef"],
        correction_sequence=revision["correction_sequence"], spec_hash=revision["spec_hash"],
        emit_signal=os.environ.get("SEMANTIC_MODEL_REALTIME_ENABLED") == "true")
    if not swapped:
        raise HTTPException(status_code=409, detail="draft_data_outdated")
    binding = await store.get_active_binding(pool, model_id, "production")
    return {"modelId": model_id, "environment": "production", "active": binding, "reused": False}


@router.get("/models/{model_id}/data-summary", status_code=status.HTTP_200_OK)
async def read_data_summary(model_id: str, request: Request) -> dict[str, object]:
    """Record counts of the draft and published data, keyed by the model
    version each was built from, so version comparisons can say how many
    records a publish adds or removes."""
    pool = _population_read_pool(request)
    result: dict[str, object] = {"modelId": model_id}
    for environment in ("draft", "production"):
        binding = await store.get_active_binding(pool, model_id, environment)
        if binding is None:
            result[environment] = None
            continue
        counts = await store.count_revision_rows(pool, binding["data_revision_id"])
        result[environment] = {"modelVersionId": binding["model_version_id"],
                               "records": counts["entities"],
                               "links": counts["relationships"]}
    return result


@router.get("/models/{model_id}/published", status_code=status.HTTP_200_OK)
async def read_published_binding(model_id: str, request: Request) -> dict[str, object]:
    binding = await store.get_active_binding(_population_read_pool(request), model_id, "production")
    if binding is None:
        raise HTTPException(status_code=404, detail="model_not_published")
    return {"modelId": model_id, "modelVersionId": binding["model_version_id"],
            "dataRevisionId": binding["data_revision_id"],
            "projectionRef": binding["projection_ref"]}


_SNAPSHOT_ID = r"^[a-z0-9_-]{8,128}$"


@router.post("/manual-sources/{model_id}/snapshots/{snapshot_id}/rows",
             status_code=status.HTTP_200_OK)
async def append_manual_rows(model_id: str, command: ManualBatchCommand, request: Request,
                             snapshot_id: str = Path(pattern=_SNAPSHOT_ID)) -> dict[str, object]:
    try:
        await manual_store.append_batch(
            _population_pool(request), model_id=model_id, snapshot_id=snapshot_id,
            rows=[row.model_dump(by_alias=True) for row in command.rows],
            links=[link.model_dump(by_alias=True) for link in command.links])
    except manual_store.ManualSnapshotError as exc:
        raise HTTPException(status_code=409, detail=exc.code) from exc
    return {"snapshotId": snapshot_id, "rows": len(command.rows), "links": len(command.links)}


@router.post("/manual-sources/{model_id}/snapshots/{snapshot_id}/commit",
             status_code=status.HTTP_200_OK)
async def commit_manual_snapshot(model_id: str, command: ManualCommitCommand, request: Request,
                                 snapshot_id: str = Path(pattern=_SNAPSHOT_ID)) -> dict[str, object]:
    try:
        created = await manual_store.commit_snapshot(
            _population_pool(request), model_id=model_id, snapshot_id=snapshot_id,
            row_count=command.row_count, link_count=command.link_count)
    except manual_store.ManualSnapshotError as exc:
        raise HTTPException(status_code=409, detail=exc.code) from exc
    return {"snapshotId": snapshot_id, "reused": not created}


@router.post("/document-preview", status_code=status.HTTP_200_OK)
async def preview_document_fields(body: dict, request: Request) -> dict[str, object]:
    """Read one document's extracted fields exactly as a run would, and say for each one how it
    was read or why it was not. Nothing is stored and no cache is used or filled."""
    from app.population.document import read_document_values, resolve_indexed_document
    from app.population.computed_fields import apply_computed, check_inputs, normalize_computed
    from app.population.document import _metadata_value
    from app.population.document_rules import RuleError, normalize_ai_settings, normalize_rules

    actor = body.get("actorUserId")
    entry = body.get("entry")
    if not isinstance(actor, str) or not actor or not isinstance(entry, dict):
        raise HTTPException(status_code=422, detail="invalid_preview")
    source = entry.get("source")
    mappings = entry.get("fieldMappings")
    if (not isinstance(source, dict) or not source.get("assetId") or not isinstance(mappings, list)
            or not 0 < len(mappings) <= 25 or not all(isinstance(item, dict) for item in mappings)):
        raise HTTPException(status_code=422, detail="invalid_preview")
    try:
        mappings = [{**item, "rules": normalize_rules(item.get("rules"))} for item in mappings
                    if item.get("mode") != "ignore"]
        mappings = [{**item, "computed": normalize_computed(item.get("computed"))}
                    if item.get("mode") == "computed" else item for item in mappings]
        check_inputs(mappings)
        normalize_ai_settings((entry.get("options") or {}).get("aiSettings"))
    except RuleError as exc:
        raise HTTPException(status_code=422, detail=f"invalid_rules: {exc}") from exc
    if any(item.get("mode") == "extract" and not str(item.get("sourceField") or "").strip() for item in mappings):
        raise HTTPException(status_code=422, detail="invalid_preview")
    pool = getattr(request.app.state, "index_pool", None)
    if pool is None:
        raise HTTPException(status_code=503, detail="index_unavailable")
    entry = {**entry, "fieldMappings": mappings, "mappingVersion": entry.get("mappingVersion") or "preview",
             "conceptId": entry.get("conceptId") or "preview"}
    resolved = await resolve_indexed_document(pool, entry, actor)
    if "gap" in resolved:
        gap = resolved["gap"]["gaps"][0]
        return {"status": gap["kind"], "detail": gap.get("detail"), "fields": {}}
    read = await read_document_values(
        pool, entry, resolved["assetRef"], resolved["capabilities"], resolved["candidate"]["documentPk"],
        model_id=str(body.get("modelId") or ""), ai_extraction=body.get("aiExtraction"))
    fields: dict[str, object] = {}
    for key, outcome in read["fields"].items():
        found = key in read["values"]
        evidence = read["evidence"].get(key) or {}
        fields[key] = {**outcome, **({"value": read["values"][key], "page": evidence.get("pageNumber"),
                                      "quote": read["quotes"].get(key)} if found else {}),
                       **({"raw": read["raws"][key]} if key in read["raws"] else {})}
    values = dict(read["values"])
    values.update({m["targetAttribute"]: m.get("constantValue") for m in mappings if m.get("mode") == "constant"})
    values.update({m["targetAttribute"]: _metadata_value(resolved["current"], m.get("sourceField"))
                   for m in mappings if m.get("mode") == "metadata"})
    computed = apply_computed(mappings, values, {"document_name": resolved["current"].get("originalName")})
    for key, outcome in computed.items():
        fields[key] = {**outcome, **({"value": values[key]} if outcome["reason"] == "found" else {})}
    preview: dict[str, object] = {"status": "read", "fields": fields, "aiSent": read["aiSent"]}
    if read["records"]:
        # Several records per document: each with what is shared (read once) and its own values.
        own = set(read.get("itemKeys") or []) | {m["targetAttribute"] for m in read["aiMappings"]}
        shared = {key: value for key, value in values.items() if key not in own}
        records = []
        for record in read["records"][:MAX_PREVIEW_RECORDS]:
            row = {**shared, **record["values"]}
            apply_computed(mappings, row, {"document_name": resolved["current"].get("originalName")})
            records.append({"values": row, "pages": {key: item.get("pageNumber") for key, item in record["evidence"].items()}})
        preview.update({"records": records, "recordCount": len(read["records"]),
                        "unevenFields": read.get("unevenFields") or []})
    return preview


# How many of a document's records its preview shows.
MAX_PREVIEW_RECORDS = 50


@router.post("/cell-preview", status_code=status.HTTP_200_OK)
async def preview_cell_fields(body: dict) -> dict[str, object]:
    """Read a few sheet rows' fields exactly as a run would: a column as it is, a value read out of a
    cell with the document rules and/or AI (with the row, column and span it was found at), a recipe.
    The rows are sample rows the person picked. Nothing is stored and no cache is used or filled."""
    from app.population.cell_fields import (MAX_CELL_CHARS, MAX_PREVIEW_ROWS, CellReader, extraction_columns,
                                            extractions_from_mappings, normalize_field_extractions)
    from app.population.computed_fields import apply_row_recipes, normalize_row_recipes
    from app.population.document_rules import RuleError, normalize_ai_settings

    entry = body.get("entry")
    rows = body.get("rows")
    if (not isinstance(entry, dict) or not isinstance(rows, list) or not 0 < len(rows) <= MAX_PREVIEW_ROWS
            or not all(isinstance(row, dict) and isinstance(row.get("values"), dict) and len(row["values"]) <= 200
                       for row in rows)):
        raise HTTPException(status_code=422, detail="invalid_preview")
    mappings = entry.get("fieldMappings")
    if (not isinstance(mappings, list) or not 0 < len(mappings) <= 100
            or not all(isinstance(item, dict) for item in mappings)):
        raise HTTPException(status_code=422, detail="invalid_preview")
    active = [item for item in mappings if item.get("mode") != "ignore" and isinstance(item.get("targetAttribute"), str)]
    # A derived source expanding a field: each sample record gives one row per item, read like a record.
    items_of: list[tuple[object, int | None, str | None]] = [(row.get("rowNumber"), None, None) for row in rows]
    item_fields: list[str] | None = None
    items_truncated = False
    if body.get("expand") is not None:
        from app.population.expand import ExpandError, item_attributes, item_paths, normalize_expand, split_value
        try:
            expand = normalize_expand(body["expand"], {key for row in rows for key in row["values"]})
        except ExpandError as exc:
            raise HTTPException(status_code=422, detail="invalid_expand") from exc
        expanded: list[dict] = []
        items_of = []
        for row in rows:
            for index, item in enumerate(split_value(row["values"].get(expand["field"]), expand), start=1):
                if len(expanded) >= MAX_PREVIEW_ROWS * MAX_PREVIEW_ITEMS_PER_ROW:
                    items_truncated = True
                    break
                attributes = item_attributes(item)
                expanded.append({"rowNumber": len(expanded) + 1, "values": {**row["values"], **attributes}})
                items_of.append((row.get("rowNumber"), index, str(attributes["@item"])[:300]))
        item_fields = item_paths([{"entityId": str(row.get("rowNumber")), "attributes": row["values"]} for row in rows], expand)
        rows = expanded
    try:
        extractions = normalize_field_extractions(extractions_from_mappings(active))
        shaped = [item for item in active if item.get("mode") in ("direct", "computed") and item.get("computed") is not None]
        recipes = normalize_row_recipes({item["targetAttribute"]: item["computed"] for item in shaped},
                                        {item["targetAttribute"] for item in active if item.get("mode") in ("direct", "computed", "extract", "constant")})
        settings = normalize_ai_settings((entry.get("options") or {}).get("aiSettings"))
    except RuleError as exc:
        raise HTTPException(status_code=422, detail=f"invalid_rules: {exc}") from exc
    reader = CellReader(extractions, {
        "conceptId": entry.get("conceptId") or "preview", "conceptLabel": entry.get("conceptLabel"),
        "source": entry.get("source") or {}, "assetRef": {"assetId": (entry.get("source") or {}).get("assetId")},
        "mappingVersion": "preview", "modelId": str(body.get("modelId") or ""),
        "aiExtraction": body.get("aiExtraction"), "settings": settings,
        # Rows of a sheet, or records of another concept (a derived source's sample records).
        "unit": "record" if entry.get("unit") == "record" else "row"}, ai_rows=MAX_PREVIEW_ROWS)
    texts = [{str(column): "" if value is None else str(value)[:MAX_CELL_CHARS] for column, value in row["values"].items()}
             for row in rows]
    columns = extraction_columns(extractions)
    read = await reader.read_rows([(row.get("rowNumber"), {column: cells.get(column, "") for column in columns})
                                   for row, cells in zip(rows, texts)]) if extractions and rows else [None] * len(rows)
    results = []
    for row, cells, outcome, (row_number, item_index, item_text) in zip(rows, texts, read, items_of):
        values: dict[str, object] = {}
        fields: dict[str, object] = {}
        for item in active:
            target = item["targetAttribute"]
            if item.get("mode") == "direct" and isinstance(item.get("sourceField"), str):
                value = row["values"].get(item["sourceField"])
                values[target] = value
                fields[target] = {"method": "direct", "column": item["sourceField"],
                                  "reason": "no_input" if value is None or str(value).strip() == "" else "found",
                                  **({"value": value} if value is not None and str(value).strip() else {})}
            elif item.get("mode") == "constant":
                values[target] = item.get("constantValue")
        if outcome is not None:
            for target in extractions:
                values[target] = outcome["values"].get(target)
                fields[target] = outcome["fields"].get(target) or {"method": "rules", "reason": "no_input"}
        for target, recipe in apply_row_recipes(recipes, values, cells).items():
            fields[target] = {"method": "computed", "reason": recipe["reason"], "input": recipe["input"],
                              **({"value": values[target]} if recipe["reason"] == "found" else {})}
        results.append({"rowNumber": row_number, "fields": fields,
                        **({"item": item_index, "itemText": item_text} if item_index is not None else {})})
    return {"rows": results, "ai": {key: reader.stats[key] for key in ("aiRows", "aiCalls", "aiSkippedRows", "aiFailedRows")},
            **({"itemFields": item_fields, "itemsTruncated": items_truncated} if item_fields is not None else {})}


MAX_SHAPED_ROWS = 500
# How many items of each sample record a preview reads, on average, when a derived source expands a field.
MAX_PREVIEW_ITEMS_PER_ROW = 5


@router.post("/sheet-rows", status_code=status.HTTP_200_OK)
async def shape_sheet_rows_route(body: dict) -> dict[str, object]:
    """A sheet's sample rows with its fields read as a run reads them (columns, fixed values, rules on a
    cell, recipes and joins), for the data preview. AI is not run. Nothing is stored."""
    from app.workers.datasource_tasks import shape_sheet_rows

    rows = body.get("rows")
    mappings = body.get("fieldMappings")
    if (not isinstance(rows, list) or len(rows) > MAX_SHAPED_ROWS
            or not all(isinstance(row, dict) and len(row) <= 201 for row in rows)
            or not isinstance(mappings, list) or not 0 < len(mappings) <= 100
            or not all(isinstance(item, dict) for item in mappings)):
        raise HTTPException(status_code=422, detail="invalid_preview")
    if body.get("expand") is not None:
        # Several records per row: each row gives one row per item of the expanded column.
        from app.population.expand import ExpandError, expand_rows, normalize_expand
        try:
            expand = normalize_expand(body["expand"], {key for row in rows for key in row})
        except ExpandError as exc:
            raise HTTPException(status_code=422, detail="invalid_expand") from exc
        rows, gaps = expand_rows(rows, {**expand, "maxItems": min(expand.get("maxItems") or 1000, 50)},
                                 lambda row: row.get(expand["field"]), lambda row: row.get("__sheetRow"))
        return {**shape_sheet_rows(mappings, rows[:MAX_SHAPED_ROWS * 2]),
                "itemsTruncated": bool(gaps) or len(rows) > MAX_SHAPED_ROWS * 2}
    return shape_sheet_rows(mappings, rows)


@router.post("/computed-preview", status_code=status.HTTP_200_OK)
async def preview_computed_field(body: dict) -> dict[str, object]:
    """Run one computed field on sample values (file names, values of the field it reads, or cells of
    the column it reads), with the value at each step. ``inputRecipe`` first shapes each sample, for a
    sheet field taken from another field that has its own recipe.

    A recipe joining several parts is tried on ``partSamples`` instead: per sample, the value of each
    part by ``"<kind>:<name>"``; ``partRecipes`` first shapes a part (a field with its own recipe)."""
    from app.population.computed_fields import (MAX_JOIN_PARTS, MAX_PREVIEW_SAMPLES, compute, compute_from,
                                                normalize_computed)
    from app.population.document_rules import RuleError

    try:
        spec = normalize_computed(body.get("computed"))
        before = normalize_computed(body["inputRecipe"]) if body.get("inputRecipe") is not None else None
        part_recipes = body.get("partRecipes") or {}
        if not isinstance(part_recipes, dict) or len(part_recipes) > MAX_JOIN_PARTS:
            raise RuleError("partRecipes must map parts to recipes")
        part_recipes = {str(key): normalize_computed(recipe) for key, recipe in part_recipes.items()}
    except RuleError as exc:
        raise HTTPException(status_code=422, detail=f"invalid_computed: {exc}") from exc
    if spec["input"]["kind"] == "join":
        part_samples = body.get("partSamples")
        if (not isinstance(part_samples, list) or not 0 < len(part_samples) <= MAX_PREVIEW_SAMPLES
                or not all(isinstance(sample, dict) and len(sample) <= MAX_JOIN_PARTS * 2
                           and all(isinstance(key, str) and len(key) <= 220 and isinstance(value, str) and len(value) <= 1000
                                   for key, value in sample.items()) for sample in part_samples)):
            raise HTTPException(status_code=422, detail="invalid_samples")
        joined = []
        for sample in part_samples:
            def lookup(kind: str, name: str, sample: dict = sample) -> str | None:
                key = f"{kind}:{name}"
                value = sample.get(key)
                if value is not None and key in part_recipes:
                    value, _ = compute(part_recipes[key], value)
                return value
            steps: list[dict] = []
            value, reason, text = compute_from(spec, lookup, steps)
            joined.append({"input": text, "value": value, "reason": reason, "steps": steps})
        return {"results": joined}
    samples = body.get("samples")
    if (not isinstance(samples, list) or not 0 < len(samples) <= MAX_PREVIEW_SAMPLES
            or not all(isinstance(sample, str) and len(sample) <= 1000 for sample in samples)):
        raise HTTPException(status_code=422, detail="invalid_samples")
    results = []
    for sample in samples:
        source: str | None = sample
        if before is not None:
            source, _ = compute(before, sample)
        steps: list[dict] = []
        value, reason = compute(spec, source, steps)
        results.append({"input": sample, "value": value, "reason": reason, "steps": steps})
    return {"results": results}


@router.post("/document-labels", status_code=status.HTTP_200_OK)
async def suggest_document_labels(body: dict, request: Request) -> dict[str, object]:
    """Headings and ``Label:`` texts that recur across a few of a source's documents, with how many
    documents hold each one. Every document is reauthorized for the actor, as a run does."""
    from app.datasource.section_reader import SectionReadError
    from app.population.document import _whole_document, resolve_indexed_document
    from app.population.document_labels import MAX_DOCUMENTS, labels_in_document, recurring_labels

    actor = body.get("actorUserId")
    sources = body.get("sources")
    if (not isinstance(actor, str) or not actor or not isinstance(sources, list)
            or not 0 < len(sources) <= MAX_DOCUMENTS
            or not all(isinstance(item, dict) and item.get("assetId") for item in sources)):
        raise HTTPException(status_code=422, detail="invalid_label_request")
    pool = getattr(request.app.state, "index_pool", None)
    if pool is None:
        raise HTTPException(status_code=503, detail="index_unavailable")
    per_document: list[list[dict]] = []
    unread: list[dict[str, object]] = []
    for source in sources:
        entry = {"source": source, "conceptId": "labels", "fieldMappings": []}
        resolved = await resolve_indexed_document(pool, entry, actor)
        if "gap" in resolved:
            unread.append({"assetId": source.get("assetId"), "status": resolved["gap"]["gaps"][0]["kind"]})
            continue
        try:
            sections = await _whole_document(pool, resolved["candidate"]["documentPk"])
        except SectionReadError:
            unread.append({"assetId": source.get("assetId"), "status": "index_unavailable"})
            continue
        per_document.append(labels_in_document(sections))
    return {"documentsRead": len(per_document), "unread": unread, "labels": recurring_labels(per_document)}
