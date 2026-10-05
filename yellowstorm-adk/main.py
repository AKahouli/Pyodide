"""Application entry point for the Smart ADK API."""

import asyncio
import os
from contextlib import asynccontextmanager
from importlib.metadata import version
from os import getenv

# Keep full LLM message content out of ADK telemetry spans.
os.environ["ADK_CAPTURE_MESSAGE_CONTENT_IN_SPANS"] = "false"

from fastapi.exceptions import RequestValidationError
from src.middleware import add_middleware
#from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.status import HTTP_422_UNPROCESSABLE_ENTITY

from src.logger.setup_logging import setup_logging
from src.logger.logging import configure_logging, CorrelationIdFilter
from src.logger.logging import get_logger
from src.middleware import add_middleware
# from src.config.settings import get_settings

import uvicorn
from fastapi import FastAPI
from src.routers import chatbot
from src.config.settings import get_settings
from pydantic import TypeAdapter

from src.routers.chatbot import chatbot_router, agentic_router
from src.routers.similarity_search import router as similarity_search_router
from src.routers.authentification import router as auth_router
from src.routers.health import router as health_router
from src.routers.playbook import playbook_router
from src.routers.evaluation import router as evaluation_router
from src.smart_rag.infrastructure.session.manager import (
    dispose_shared_database_session_service,
    dispose_shared_engine,
    get_shared_database_session_service,
)
from src.routers.evaluation_batch import router as evaluation_batch_router
from src.routers.response_evaluation import router as response_evaluation_router
from src.routers.response_correction import router as response_correction_router
from src.routers.semantic_model import router as semantic_model_router
from src.routers.vectorstores import router as vectorstores_router

from src.evaluation.repository import EvaluationRepository, dispose_evaluation_engine
from src.a2a_gateway.repository import A2AAgentRepository, dispose_a2a_engine
from src.a2a_gateway.router import serving_router as a2a_serving_router

# Import gRPC server
from src.grpc_server.server import start_grpc_server

app_settings = get_settings()
DD_TRACE_ENABLED = app_settings.DD_TRACE_ENABLED

logger = get_logger("api.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting router chatbot (UP)...")
    if app_settings.APPLICATION_INSIGHTS_LOG:
        try:
            from azure.monitor.opentelemetry import configure_azure_monitor
        except ImportError as exc:
            logger.error(
                "APPLICATION_INSIGHTS_LOG is enabled but azure-monitor-opentelemetry is not installed"
            )
            raise RuntimeError(
                "Missing optional dependency 'azure-monitor-opentelemetry' required for Application Insights logging"
            ) from exc

        # logging in application insights
        configure_logging()
        logger.addFilter(CorrelationIdFilter())
        configure_azure_monitor(
            connection_string=app_settings.APPLICATIONINSIGHTS_CONNECTION_STRING,
            logger_name="api",
        )
        logger.warning("azure.core.pipeline.policies.http_logging_policy")
        logger.warning("azure.monitor.opentelemetry.exporter.export._base")
    else:
        # logging in elastic search or locally
        LOG_JSON_FORMAT = TypeAdapter(bool).validate_python(
            getenv("LOG_JSON_FORMAT", False)
        )
        COLOR_LOGS = TypeAdapter(bool).validate_python(getenv("COLOR_LOGS", True))
        LOG_LEVEL = getenv("LOG_LEVEL", "INFO")
        setup_logging(
            json_logs=LOG_JSON_FORMAT, log_level=LOG_LEVEL, color_logs=COLOR_LOGS
        )

    runtime_versions = {
        package: version(package)
        for package in (
            "google-adk",
            "langgraph",
            "langgraph-checkpoint",
            "langgraph-checkpoint-postgres",
            "langgraph-checkpoint-sqlite",
            "langchain",
            "langchain-core",
            "langchain-openai",
            "langchain-community",
        )
    }
    logger.info("AI runtime versions: %s", runtime_versions)

    # Apply global LLM patches (mapping, timeouts, and logging)
    try:
        from src.evaluation.agent_evaluator import apply_litellm_debug_patch
        apply_litellm_debug_patch()
        from src.companion_ai.adk.adk_patches import (
            apply_replay_barrier_timeout_patch, apply_replay_barrier_resilience_patch)
        apply_replay_barrier_timeout_patch()
        apply_replay_barrier_resilience_patch()
        logger.info("✅ Global LLM patches applied successfully at startup")
    except Exception as e:
        logger.error(f"Failed to apply global LLM patches: {e}")

    # Initialize evaluation database if configured
    try:
        logger.info("Initializing evaluation repository...")
        await EvaluationRepository.initialize()
    except Exception as e:
        logger.error(f"Failed to initialize evaluation repository: {e}")

    # Initialize A2A gateway agent store
    try:
        logger.info("Initializing A2A agent store...")
        await A2AAgentRepository.initialize()
    except Exception as e:
        logger.error(f"Failed to initialize A2A agent store: {e}")

    # Eagerly warm the shared ADK session service (pooled engine +
    # prepare_tables) before gRPC traffic so request-path session lookups
    # skip engine creation and schema checks.
    try:
        logger.info("Initializing shared ADK database session service...")
        session_service = await get_shared_database_session_service()
        logger.info(
            "Shared ADK database session service ready (engine_id=%s)",
            id(session_service.db_engine),
        )
    except Exception as e:
        # Keep starting: the provider retries lazily on the first request.
        logger.error(f"Failed to warm shared ADK database session service: {e}")

    # Start gRPC under a supervisor: a transient database/network startup
    # failure is retried while the process stays healthy instead of leaving
    # HTTP alive with gRPC permanently dead. Fatal configuration failures
    # terminate the supervisor task and are logged with an actionable cause.
    grpc_supervisor = None
    grpc_port = app_settings.GRPC_PORT
    grpc_enabled = app_settings.GRPC_ENABLED

    if grpc_enabled:
        from src.grpc_server.supervisor import (
            GrpcSupervisor,
            set_current_supervisor,
        )
        grpc_supervisor = GrpcSupervisor(
            host="0.0.0.0", port=int(grpc_port), start_callable=start_grpc_server
        )
        set_current_supervisor(grpc_supervisor)
        grpc_supervisor_task = grpc_supervisor.start()

        def _supervisor_done_callback(task: "asyncio.Task[None]") -> None:
            if task.cancelled():
                return
            exc = task.exception()
            if exc is not None:
                logger.error(
                    "[gRPC] supervisor terminated with fatal error: %s: %s",
                    type(exc).__name__,
                    exc,
                )

        grpc_supervisor_task.add_done_callback(_supervisor_done_callback)

        # Bounded first-readiness wait: the supervisor keeps retrying, but the
        # readiness endpoint reports degraded until serving actually starts.
        try:
            await asyncio.wait_for(
                grpc_supervisor.wait_ready(),
                timeout=app_settings.GRPC_STARTUP_READY_TIMEOUT_SECONDS,
            )
            logger.info("✅ gRPC supervisor serving on port %s", grpc_port)
        except asyncio.TimeoutError:
            logger.warning(
                "gRPC supervisor not serving within %ss; retrying in background "
                "and reporting degraded readiness",
                app_settings.GRPC_STARTUP_READY_TIMEOUT_SECONDS,
            )
    else:
        logger.info(
            "gRPC server disabled (GRPC_ENABLED=false). Only REST/SSE endpoints available."
        )

    # Application startup logic ends here
    yield

    # Application shutdown logic
    logger.info("Shutting down Smart ADK API...")

    # Stop the supervised gRPC server (cancels backoff/initialization promptly,
    # drains the listener, and never recreates services after shutdown).
    if grpc_supervisor:
        logger.info("Stopping gRPC supervisor...")
        await grpc_supervisor.stop()
        from src.grpc_server.supervisor import set_current_supervisor
        set_current_supervisor(None)

    # Dispose the shared ADK session service, then its engine exactly once.
    # gRPC is stopped above, so no in-flight request still holds the service.
    await dispose_shared_database_session_service()
    await dispose_shared_engine()

    await dispose_evaluation_engine()
    await dispose_a2a_engine()
    logger.info("Finished router chatbot (DOWN)")
    logger.info("Exiting...")


app = FastAPI(
    title="YellowStorm Smart ADK API",
    summary="YellowStorm Smart ADK API - Chat with ADK endpoint",
    version="V1",
    lifespan=lifespan,
)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    logger.exception("Validation error on request")
    return JSONResponse(
        status_code=HTTP_422_UNPROCESSABLE_ENTITY,
        content={"detail": exc.errors()},
    )


add_middleware(app, app_settings)
if app_settings.APPLICATION_INSIGHTS_LOG:
    FastAPIInstrumentor.instrument_app(app)


config_path = (
    app_settings.APPLICATION_INSIGHTS_LOG_CONFIG_PATH
    if app_settings.APPLICATION_INSIGHTS_LOG
    else app_settings.LOG_CONFIG_PATH
)

# Main router that includes both sub-routers
app.include_router(chatbot_router)
app.include_router(agentic_router)
app.include_router(similarity_search_router)
app.include_router(auth_router)
app.include_router(playbook_router)
app.include_router(evaluation_router)
app.include_router(evaluation_batch_router)
app.include_router(response_evaluation_router)
app.include_router(response_correction_router)
app.include_router(semantic_model_router)
app.include_router(vectorstores_router)
app.include_router(a2a_serving_router)
app.include_router(health_router)
if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host=app_settings.HOST,
        log_config=config_path,
        workers=app_settings.UVICORN_WORKERS,
        port=app_settings.PORT,
        timeout_keep_alive=app_settings.TIMEOUT_KEEP_ALIVE,
        reload=False,
        loop="src.asyncio_loop:selector_loop_factory" if os.name == "nt" else "auto",
    )
