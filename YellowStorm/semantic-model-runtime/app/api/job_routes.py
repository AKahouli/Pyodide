"""P2.1 common operational API group. Durable state lands with P2.4."""

from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException, Query, Request

router = APIRouter(prefix="/v1/semantic-model-jobs", tags=["jobs"])


def _service(request: Request):  # type: ignore[no-untyped-def]
    service = getattr(request.app.state, "job_service", None)
    if service is None:
        raise HTTPException(status_code=503, detail="jobs_unavailable")
    return service


@router.get("/events")
async def list_events(
    request: Request,
    job_id: str = Query(alias="jobId"),
    after: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=200),
    actor_user_id: str = Header(alias="X-Actor-User-Id", min_length=1, max_length=200),
) -> dict[str, object]:
    events = await _service(request).repository.list_events(
        job_id, actor_user_id, after, limit
    )
    return {"items": events, "continuation": events[-1]["eventId"] if len(events) == limit else None}


@router.get("/active")
async def get_active_job(
    request: Request,
    model_id: str = Query(alias="modelId", min_length=1, max_length=200),
    job_type: str = Query(default="population.run", alias="jobType", max_length=100),
    actor_user_id: str = Header(alias="X-Actor-User-Id", min_length=1, max_length=200),
) -> dict[str, object]:
    job = await _service(request).repository.find_active_job(
        actor_user_id=actor_user_id, model_id=model_id, job_type=job_type)
    return {"job": job}


@router.get("/{job_id}")
async def get_job(
    job_id: str,
    request: Request,
    actor_user_id: str = Header(alias="X-Actor-User-Id", min_length=1, max_length=200),
) -> dict[str, object]:
    job = await _service(request).repository.get_job(job_id, actor_user_id)
    if job is None:
        # Do not reveal whether a job exists for another actor.
        raise HTTPException(status_code=404, detail="job_not_found")
    return job


@router.post("/{job_id}/cancel")
async def cancel_job(
    job_id: str,
    request: Request,
    actor_user_id: str = Header(alias="X-Actor-User-Id", min_length=1, max_length=200),
) -> dict[str, object]:
    job = await _service(request).repository.request_cancel(job_id, actor_user_id)
    if job is None:
        raise HTTPException(status_code=404, detail="job_not_found")
    return job
