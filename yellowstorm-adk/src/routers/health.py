"""Liveness and readiness endpoints.

Readiness must reflect the actual gRPC serving state (via the supervisor), not
merely that the HTTP process responds. An HTTP 200 from this process alone is
never proof that gRPC traffic can be served.
"""

from fastapi import APIRouter
from starlette.responses import JSONResponse

from src.config.settings import get_settings
from src.grpc_server.supervisor import get_current_supervisor

router = APIRouter(tags=["health"])


@router.get("/health/live")
async def liveness():
    """The process and its supervisor loop are operating; dependency outages
    alone do not fail liveness."""
    return {"status": "ok"}


@router.get("/health/ready")
async def readiness():
    """New work can be served: required gRPC capability is serving."""
    settings = get_settings()
    if not settings.GRPC_ENABLED:
        return {"status": "ok", "grpc": "disabled"}

    supervisor = get_current_supervisor()
    if supervisor is None:
        return JSONResponse(
            status_code=503,
            content={"status": "unavailable", "grpc": "not_started"},
        )
    if supervisor.is_ready():
        return {"status": "ok", "grpc": supervisor.state}
    return JSONResponse(
        status_code=503,
        content={"status": "unavailable", "grpc": supervisor.state},
    )
