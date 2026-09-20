"""P2.1 population API group. Heavy work lives in workers, never here."""

from __future__ import annotations

import os

from fastapi import APIRouter, Header, HTTPException, Request, status

from app.jobs.models import IdempotencyConflict, JobCommand
from app.workers.celery_app import POPULATION_QUEUES

router = APIRouter(prefix="/v1/semantic-model-population", tags=["population"])


@router.post("/runs", status_code=status.HTTP_202_ACCEPTED)
async def request_run(
    command: JobCommand,
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
