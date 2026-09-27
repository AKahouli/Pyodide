"""Population API group. Heavy work lives in workers, never here.
Run admission (P2.1) plus the Phase 6 human-control commands (P6.8-P6.16):
corrections record durably with optimistic concurrency, review resolution is
fenced on the open state, and revision activation compare-and-swaps the
serving tuple. None of these write AGE or projections directly."""

from __future__ import annotations

import json
import os

from fastapi import APIRouter, Header, HTTPException, Path, Query, Request, status

from app.jobs.models import (ActivateRevisionCommand, CorrectionCommand, IdempotencyConflict,
                             ManualBatchCommand, ManualCommitCommand,
                             MirrorSpecificationCommand, PopulationCommand, PublishModelDataCommand,
                             ReviewResolveCommand)
from app.persistence import manual_store
from app.persistence import population_store as store
from app.population.age_projection import (ProjectionUnavailable, ensure_revision_projection,
                                             is_live_projection_ref, read_projection_graph)
from app.population.compiler import (PopulationError, canonical_spec_hash, validate_specification)
from app.workers.celery_app import POPULATION_QUEUES

router = APIRouter(prefix="/v1/semantic-model-population", tags=["population"])


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
            idempotency_key=idempotency_key,
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


@router.get("/models/{model_id}/records", status_code=status.HTTP_200_OK)
async def read_bound_records(model_id: str, request: Request, environment: str = "draft",
                             limit: int = 25,
                             concept_id: str | None = Query(default=None, alias="conceptId"),
                             data_revision_id: str | None = Query(default=None,
                                                                  alias="dataRevisionId"),
                             ) -> dict[str, object]:
    if environment != "draft" or limit < 1 or limit > 50:
        raise HTTPException(status_code=422, detail="invalid_read_scope")
    pool = _population_read_pool(request)
    binding = await store.get_active_binding(pool, model_id, environment)
    if binding is None:
        raise HTTPException(status_code=404, detail="active_binding_not_found")
    revision_id = binding["data_revision_id"]
    if data_revision_id is not None and data_revision_id != revision_id:
        raise HTTPException(status_code=409, detail="active_binding_changed")
    counts = await store.count_revision_rows(pool, revision_id)
    # Records per concept, over the whole revision: the entity list below is only a page of it.
    concept_counts = await store.count_revision_entities_by_concept(pool, revision_id)
    entities = await store.list_revision_entities(pool, revision_id, limit, concept_id)
    entity_ids = {entity["entityId"] for entity in entities}
    origins = await store.list_entity_origins(pool, revision_id, sorted(entity_ids))
    for entity in entities:
        entity["origins"] = origins.get(entity["entityId"], {})
    revision = await store.get_data_revision(pool, revision_id)
    coverage = (revision or {}).get("coverage") or {}
    if isinstance(coverage, str):
        coverage = json.loads(coverage)
    gaps = coverage.get("gaps") if isinstance(coverage, dict) else None
    relationships = [relationship for relationship in
                     await store.list_revision_relationships(pool, revision_id)
                     if relationship["sourceEntityId"] in entity_ids
                     and relationship["targetEntityId"] in entity_ids]
    specification = await store.get_revision_specification(pool, revision_id)
    if specification is None:
        raise HTTPException(status_code=409, detail="revision_specification_not_found")
    return {"modelId": model_id, "modelVersionId": binding["model_version_id"],
            "dataRevisionId": revision_id, "entities": entities,
            "relationships": relationships, "counts": counts, "conceptCounts": concept_counts,
            "gaps": gaps or {"missingValues": [], "unresolvedLinks": [], "other": []},
            "specification": specification}


@router.get("/models/{model_id}/graph", status_code=status.HTTP_200_OK)
async def read_bound_graph(model_id: str, request: Request,
                           environment: str = "draft",
                           data_revision_id: str | None = Query(default=None,
                                                                alias="dataRevisionId"),
                           ) -> dict[str, object]:
    if environment != "draft":
        raise HTTPException(status_code=422, detail="invalid_read_scope")
    pool = _population_read_pool(request)
    binding = await store.get_active_binding(pool, model_id, environment)
    if binding is None:
        raise HTTPException(status_code=404, detail="active_binding_not_found")
    if data_revision_id is not None and data_revision_id != binding["data_revision_id"]:
        raise HTTPException(status_code=409, detail="active_binding_changed")
    try:
        graph = await read_projection_graph(_age_pool(request), binding["projection_ref"])
    except PopulationError as exc:
        raise HTTPException(status_code=409, detail=exc.code) from exc
    specification = await store.get_revision_specification(pool, binding["data_revision_id"])
    if specification is None:
        raise HTTPException(status_code=409, detail="revision_specification_not_found")
    return {"modelId": model_id, "modelVersionId": binding["model_version_id"],
            "dataRevisionId": binding["data_revision_id"],
            "specification": specification, **graph}


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
