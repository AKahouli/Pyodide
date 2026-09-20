"""P2.1 datasource API group. Heavy work lives in workers, never here."""

from __future__ import annotations

import os

from fastapi import APIRouter, Header, HTTPException, Request, status

from app.jobs.models import DiscoveryCommand, IdempotencyConflict
from app.workers.celery_app import DATASOURCE_QUEUES

router = APIRouter(prefix="/v1/semantic-model-datasource", tags=["datasource"])


@router.post("/discoveries", status_code=status.HTTP_202_ACCEPTED)
async def request_discovery(
    command: DiscoveryCommand,
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
            job_type="datasource.discovery",
            command=command,
            idempotency_key=idempotency_key,
            task_name="semantic-model-datasource.discover",
            queue_name=DATASOURCE_QUEUES[1],
        )
    except IdempotencyConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {
        "jobId": admission.job_id,
        "status": admission.state,
        "progressUrl": f"/v1/semantic-model-jobs/{admission.job_id}",
        "reused": admission.reused,
    }
