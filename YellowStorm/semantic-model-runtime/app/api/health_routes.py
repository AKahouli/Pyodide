"""P2.10: liveness vs readiness. A runtime outage must not fail core NestJS."""

from __future__ import annotations

import os

from fastapi import APIRouter, Request

router = APIRouter(tags=["health"])


@router.get("/health/live")
def live() -> dict[str, str]:
    return {"status": "alive"}


@router.get("/health/ready")
def ready(request: Request) -> dict[str, object]:
    # Capability flags only; never probe heavy deps synchronously here.
    return {
        "status": "ready",
        "runtimeEnabled": os.environ.get("SEMANTIC_MODEL_RUNTIME_ENABLED") == "true",
        "runtimeWritesEnabled": os.environ.get("SEMANTIC_MODEL_RUNTIME_WRITES_ENABLED") == "true",
        "brokerConfigured": bool(os.environ.get("SEMANTIC_BROKER_URL")),
        "jobStoreReady": getattr(request.app.state, "job_service", None) is not None,
        "dispatcherEnabled": os.environ.get("SEMANTIC_JOB_DISPATCHER_ENABLED") == "true",
    }
