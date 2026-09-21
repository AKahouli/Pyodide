"""One FastAPI application: ``semantic-model-runtime`` (Phase 2A, P2.1).

Mounts datasource / population / jobs routers with a versioned OpenAPI
document. Heavy computation never runs here (see app/workers/); this process
does bounded validation and (from P2.4) durable job admission only.

P2.2 guards: service identity, 256 KiB command body limit (§6.5), correlation
IDs. P2.10: ``/health/live`` vs ``/health/ready``.
"""

from __future__ import annotations

import logging
import os
import uuid
from contextlib import asynccontextmanager
from typing import AsyncIterator, cast

import asyncpg
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from .api import datasource_routes, health_routes, index_routes, job_routes, population_routes
from .jobs.dispatcher import OutboxDispatcher, OutboxRepository
from .jobs.service import JobRepository, JobService
from .persistence.postgres_jobs import PostgresJobRepository
from .security.service_auth import is_authorized

MAX_BODY_BYTES = 256 * 1024
REQUEST_ID_HEADER = "X-Request-Id"
SERVICE_KEY_HEADER = "X-Semantic-Service-Key"

logger = logging.getLogger(__name__)

# Health is unauthenticated by design (load-balancer / core capability checks).
OPEN_PATHS = {"/health/live", "/health/ready", "/openapi.json", "/docs"}


async def check_body_size(request: Request) -> str:
    """Enforce MAX_BODY_BYTES while consuming the ASGI stream.

    Returns 'ok' | 'too_large' | 'read_error'. Stops reading as soon as the
    limit is exceeded, so chunked bodies without Content-Length cannot grow
    memory unbounded. Consumed bytes (<= limit) are cached on the request so
    downstream handlers can still read the body.
    """
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > MAX_BODY_BYTES:
        return "too_large"
    if not declared.isdigit():
        total = 0
        chunks: list[bytes] = []
        try:
            async for chunk in request.stream():
                total += len(chunk)
                if total > MAX_BODY_BYTES:
                    return "too_large"
                chunks.append(chunk)
        except Exception:
            return "read_error"
        request._body = b"".join(chunks)  # bounded: total <= limit
        return "ok"
    try:
        body = await request.body()
    except Exception:
        return "read_error"
    return "too_large" if len(body) > MAX_BODY_BYTES else "ok"


def create_app(job_repository: JobRepository | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        pool: asyncpg.Pool | None = None
        repository = job_repository
        dispatcher: OutboxDispatcher | None = None
        database_url = os.environ.get("SEMANTIC_RUNTIME_DATABASE_URL", "")
        if repository is None and database_url:
            pool = await asyncpg.create_pool(
                database_url,
                min_size=1,
                max_size=int(os.environ.get("SEMANTIC_RUNTIME_API_DB_POOL_MAX", "5")),
                command_timeout=5,
                server_settings={
                    "application_name": "semantic-model-runtime-api",
                    "statement_timeout": "5s",
                    "lock_timeout": "2s",
                    "idle_in_transaction_session_timeout": "5s",
                },
            )
            repository = PostgresJobRepository(pool)
        app.state.job_service = JobService(repository) if repository else None
        app.state.source_event_repository = repository
        # Phase 6 canonical store shares the runtime database pool.
        # A test may inject a fake; lifespan never overwrites it.
        if getattr(app.state, "population_pool", None) is None:
            app.state.population_pool = pool
        # Phase 4 index pool. A test may inject a fake; otherwise creation is
        # best-effort so the API stays up when the index is unreachable.
        index_pool = getattr(app.state, "index_pool", None)
        index_owned = False
        if index_pool is None and os.environ.get("SEMANTIC_INDEX_DATABASE_URL"):
            try:
                from app.datasource.logical_index import create_index_pool

                index_pool = await create_index_pool()
                index_owned = True
            except Exception:
                logger.warning("semantic index pool unavailable; index reads disabled")
                index_pool = None
        app.state.index_pool = index_pool
        app.state.index_pool_owned = index_owned
        if (
            repository is not None
            and os.environ.get("SEMANTIC_MODEL_RUNTIME_WRITES_ENABLED") == "true"
            and os.environ.get("SEMANTIC_JOB_DISPATCHER_ENABLED") == "true"
            and os.environ.get("SEMANTIC_BROKER_URL")
        ):
            dispatcher = OutboxDispatcher(cast(OutboxRepository, repository))
            await dispatcher.start()
        try:
            yield
        finally:
            if dispatcher:
                await dispatcher.stop()
            if app.state.index_pool_owned and app.state.index_pool is not None:
                await app.state.index_pool.close()
            if pool:
                await pool.close()

    app = FastAPI(title="semantic-model-runtime", version="1.0.0", lifespan=lifespan)

    @app.middleware("http")
    async def guards(request: Request, call_next):  # type: ignore[no-untyped-def]
        request_id = request.headers.get(REQUEST_ID_HEADER) or uuid.uuid4().hex
        if request.url.path not in OPEN_PATHS and not is_authorized(request.headers.get(SERVICE_KEY_HEADER)):
            return JSONResponse(
                status_code=401,
                content={"detail": "unauthorized"},
                headers={REQUEST_ID_HEADER: request_id},
            )
        body_state = await check_body_size(request)
        if body_state == "too_large":
            return JSONResponse(
                status_code=413,
                content={"detail": "payload_too_large"},
                headers={REQUEST_ID_HEADER: request_id},
            )
        if body_state == "read_error":
            return JSONResponse(
                status_code=400,
                content={"detail": "unreadable_body"},
                headers={REQUEST_ID_HEADER: request_id},
            )
        try:
            response = await call_next(request)
        except HTTPException as exc:
            return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail},
                                headers={REQUEST_ID_HEADER: request_id})
        response.headers[REQUEST_ID_HEADER] = request_id
        return response

    app.include_router(health_routes.router)
    app.include_router(datasource_routes.router)
    app.include_router(index_routes.router)
    app.include_router(population_routes.router)
    app.include_router(job_routes.router)
    return app


app = create_app()


def runtime_flags() -> dict[str, bool]:
    return {
        "runtimeEnabled": os.environ.get("SEMANTIC_MODEL_RUNTIME_ENABLED") == "true",
        "runtimeWritesEnabled": os.environ.get("SEMANTIC_MODEL_RUNTIME_WRITES_ENABLED") == "true",
    }
