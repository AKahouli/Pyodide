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
        from src.companion_ai.adk_patches import apply_replay_barrier_timeout_patch
        apply_replay_barrier_timeout_patch()
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

    # Start gRPC server as background task
    grpc_server_task = None
    grpc_port = app_settings.GRPC_PORT
    grpc_enabled = app_settings.GRPC_ENABLED

    if grpc_enabled:
        try:
            logger.info(f"Starting gRPC server on port {grpc_port}...")
            grpc_server_task = asyncio.create_task(
                start_grpc_server(host="0.0.0.0", port=int(grpc_port))
            )

            # Add error callback to catch failures after task creationVectorstores
            def _grpc_task_error_callback(task):
                try:
                    task.result()  # This will raise if the task failed
                except asyncio.CancelledError:
                    pass  # Task was cancelled during shutdown, this is expected
                except Exception as e:
                    logger.error(
                        f"[gRPC] Background task failed: {str(e)}"
                    )

            grpc_server_task.add_done_callback(_grpc_task_error_callback)

            # Wait briefly so immediate startup failures surface in logs without
            # blocking the FastAPI app forever if gRPC initialization hangs.
            try:
                await asyncio.wait_for(asyncio.shield(grpc_server_task), timeout=0.5)
            except asyncio.TimeoutError:
                logger.info(
                    "gRPC server startup still in progress; continuing FastAPI startup"
                )

            if grpc_server_task.done():
                grpc_server_task.result()

            logger.info("✅ gRPC server task started (running in background)")
        except Exception as e:
            logger.error(f"Failed to start gRPC server: {str(e)}")
            logger.warning(
                "Continuing without gRPC support. Only REST/SSE endpoints will be available."
            )
    else:
        logger.info(
            "gRPC server disabled (GRPC_ENABLED=false). Only REST/SSE endpoints available."
        )

    # Application startup logic ends here
    yield

    # Application shutdown logic
    logger.info("Shutting down Smart ADK API...")

    # Stop gRPC server
    if grpc_server_task:
        logger.info("Stopping gRPC server...")
        grpc_server_task.cancel()
        try:
            await grpc_server_task
        except asyncio.CancelledError:
            logger.info("✅ gRPC server stopped")
        except Exception as e:
            logger.error(f"Error stopping gRPC server: {str(e)}")

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
app.include_router(a2a_serving_router)
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
