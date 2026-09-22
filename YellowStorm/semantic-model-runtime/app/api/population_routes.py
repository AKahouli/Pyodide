"""Population API group. Heavy work lives in workers, never here.

Run admission (P2.1) plus the Phase 6 human-control commands (P6.8-P6.16):
corrections record durably with optimistic concurrency, review resolution is
fenced on the open state, and revision activation compare-and-swaps the
serving tuple. None of these write AGE or projections directly."""

from __future__ import annotations

import logging
import os

from fastapi import APIRouter, Header, HTTPException, Request, status

from app.jobs.models import (ActivateRevisionCommand, CorrectionCommand, IdempotencyConflict,
                             MirrorSpecificationCommand, PopulationCommand,
                             ReviewResolveCommand)
from app.persistence import population_store as store
from app.population.age_projection import (compile_projection, drop_projection,
                                            is_live_projection_ref, live_projection_ref,
                                            project_revision as execute_projection,
                                            projection_counts, projection_exists,
                                            projection_graph_name, validate_projection)
from app.population.compiler import (PopulationError, canonical_spec_hash, validate_specification)
from app.workers.celery_app import POPULATION_QUEUES

router = APIRouter(prefix="/v1/semantic-model-population", tags=["population"])
logger = logging.getLogger(__name__)


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
    if existing is not None:
        if existing["spec_hash"] != command.spec_hash:
            raise HTTPException(status_code=409, detail="specification_conflict")
        return {"modelId": command.model_id, "modelVersionId": command.model_version_id,
                "specHash": command.spec_hash, "reused": True}
    try:
        await store.mirror_specification(
            pool, home_workspace_id=command.home_workspace_id, model_id=command.model_id,
            model_version_id=command.model_version_id, spec_hash=command.spec_hash,
            specification=command.specification)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"modelId": command.model_id, "modelVersionId": command.model_version_id,
            "specHash": command.spec_hash, "reused": False}


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
    sequence = await store.record_correction(
        pool, model_id=command.model_id, model_version_id=command.model_version_id,
        actor_user_id=command.actor_user_id, reason=command.reason,
        target_identity=command.target_identity, action=command.action,
        payload=command.payload, data_revision_id=command.data_revision_id)
    return {"sequence": sequence, "modelId": command.model_id, "state": "accepted"}


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
    revision = await store.get_data_revision(pool, revision_id)
    if revision is None:
        raise HTTPException(status_code=404, detail="revision_not_found")
    if revision["validation_state"] != "valid":
        raise HTTPException(status_code=409, detail="revision_not_valid")
    if is_live_projection_ref(revision["projection_ref"]):
        return {"revisionId": revision_id, "projectionRef": revision["projection_ref"],
                "reused": True}
    age_pool = _age_pool(request)
    graph = projection_graph_name(revision_id)
    async with age_pool.acquire() as connection:
        await connection.fetchval("SELECT pg_advisory_lock(hashtextextended($1, 0))", graph)
        try:
            current = await store.get_data_revision(pool, revision_id)
            if current is None:
                raise HTTPException(status_code=404, detail="revision_not_found")
            if is_live_projection_ref(current["projection_ref"]):
                return {"revisionId": revision_id, "projectionRef": current["projection_ref"],
                        "reused": True}
            return await _build_projection(
                pool, connection, revision_id, graph, current["projection_ref"])
        finally:
            await connection.fetchval("SELECT pg_advisory_unlock(hashtextextended($1, 0))", graph)


async def _build_projection(pool, connection, revision_id: str, graph: str,
                            previous_ref: str | None) -> dict[str, object]:  # type: ignore[no-untyped-def]
    # Validate against true stored counts, not the bounded listing: a prefix
    # must never be certified as the whole revision. Known ceiling: revisions
    # with more than 10000 stored relationships (worker cap is 20000) stay
    # persistable but unprojectable until the listing limit is raised.
    stored = await store.count_revision_rows(pool, revision_id)
    entities = await store.list_revision_entities(pool, revision_id)
    relationships = await store.list_revision_relationships(pool, revision_id)
    if stored["entities"] != len(entities) or stored["relationships"] != len(relationships):
        raise HTTPException(status_code=409, detail="projection_too_large")
    known_ids = {entity["entityId"] for entity in entities}
    for relationship in relationships:
        if (relationship["sourceEntityId"] not in known_ids
                or relationship["targetEntityId"] not in known_ids):
            raise HTTPException(status_code=409, detail="projection_incoherent")
    try:
        plan = compile_projection(entities, relationships)
    except PopulationError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    expected = {"vertices": len(entities), "edges": len(relationships)}
    try:
        async with connection.transaction():
            if await projection_exists(connection, graph):
                await drop_projection(connection, graph)
            await execute_projection(connection, graph=graph, plan=plan)
            actual = await projection_counts(connection, graph)
            if validate_projection(expected, actual):
                raise PopulationError("projection_validation_failed")
    except PopulationError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        logger.warning("AGE projection failed for revision %s: %s", revision_id, type(exc).__name__)
        raise HTTPException(status_code=503, detail="age_projection_failed") from exc
    projection_ref = live_projection_ref(graph)
    try:
        recorded = await store.set_revision_projection(
            pool, revision_id, projection_ref, previous_ref)
    except Exception as exc:
        logger.warning("Projection persistence failed for revision %s: %s",
                       revision_id, type(exc).__name__)
        current = await _revision_after_persistence_error(pool, revision_id)
        if current is not None and current["projection_ref"] == projection_ref:
            recorded = True
        else:
            if current is not None and current["projection_ref"] == previous_ref:
                await _discard_projection(connection, graph, revision_id)
            raise HTTPException(status_code=503, detail="projection_persistence_failed") from exc
    if not recorded:
        current = await store.get_data_revision(pool, revision_id)
        if current is None or current["projection_ref"] != projection_ref:
            await _discard_projection(connection, graph, revision_id)
            raise HTTPException(status_code=409, detail="projection_record_conflict")
    return {"revisionId": revision_id, "projectionRef": projection_ref,
            "graph": graph, "vertices": expected["vertices"], "edges": expected["edges"],
            "reused": not recorded}


async def _revision_after_persistence_error(pool, revision_id: str):  # type: ignore[no-untyped-def]
    try:
        return await store.get_data_revision(pool, revision_id)
    except Exception as exc:
        logger.error("Could not reconcile projection persistence for revision %s: %s",
                     revision_id, type(exc).__name__)
        return None


async def _discard_projection(connection, graph: str, revision_id: str) -> None:  # type: ignore[no-untyped-def]
    try:
        if await projection_exists(connection, graph):
            await drop_projection(connection, graph)
    except Exception as exc:
        logger.error("Failed to discard AGE graph for revision %s: %s",
                     revision_id, type(exc).__name__)


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
        correction_sequence=current_sequence,
        emit_signal=os.environ.get("SEMANTIC_MODEL_REALTIME_ENABLED") == "true")
    if not swapped:
        raise HTTPException(status_code=409, detail="activation_race")
    binding = await store.get_active_binding(pool, command.model_id, command.environment)
    return {"modelId": command.model_id, "environment": command.environment,
            "active": binding}
