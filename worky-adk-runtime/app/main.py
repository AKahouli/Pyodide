"""FastAPI entry point for the Worky (Chief of Staff) ADK runtime.

Listens on port 8011. Exposes:
  - `GET  /health`                — liveness probe
  - `POST /runtime/streams/{id}/planning-turn` — owner → Manager turn
  - `POST /runtime/streams/{id}/{start|resume|replan|stop}` — 501 stubs
  - `POST /runtime/tasks/{id}/cancel` — 501 stub

The runtime never writes state directly to Mongo. All mutations are
state-change requests sent to NestJS at `/worky/internal/*` with a
service-token + idempotency key (see `app/clients/backend_client.py`).
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import JSONResponse

from .config import get_settings
from .routers import execution_router, planning_router
from .telemetry import setup_tracing
from .clients import BackendClient
from .agents.runner import build_runner

logger = logging.getLogger("worky.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    logging.basicConfig(level=settings.log_level)
    setup_tracing()
    client = BackendClient(settings)
    await client.start()
    app.state.backend_client = client
    app.state.settings = settings
    app.state.run_planning_turn = build_runner()
    logger.info("Worky runtime ready", extra={"port": settings.port})
    try:
        yield
    finally:
        await client.aclose()


app = FastAPI(
    title="Worky ADK Runtime",
    version="0.1.0",
    lifespan=lifespan,
)


@app.get("/health")
async def health() -> JSONResponse:
    settings = get_settings()
    return JSONResponse(
        {
            "status": "ok",
            "adk_version": settings.adk_version,
            "model_provider": "litellm",
        }
    )


app.include_router(planning_router)
app.include_router(execution_router)


if __name__ == "__main__":
    import uvicorn

    settings = get_settings()
    uvicorn.run("app.main:app", host="0.0.0.0", port=settings.port)
