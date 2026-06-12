import os
import uvicorn
from fastapi import FastAPI
from src.routers import vectorstores
from src.mcp_sever.router import mcp_starlette_app
from src.middleware.middleware import add_middleware
from logging import WARNING, getLogger
from azure.monitor.opentelemetry import configure_azure_monitor
# from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from pydantic import TypeAdapter
from os import getenv
from src.config.settings import get_settings
from src.logger.setup_logging import setup_logging
from src.logger.logging import configure_logging, CorrelationIdFilter
from src.logger.logging import get_logger
from contextlib import asynccontextmanager
from fastapi.exceptions import RequestValidationError
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.status import HTTP_422_UNPROCESSABLE_ENTITY
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

app_settings = get_settings()
logger = get_logger("vectorstores-api.main")

config_path = app_settings.APPLICATION_INSIGHTS_LOG_CONFIG_PATH if app_settings.APPLICATION_INSIGHTS_LOG else app_settings.LOG_CONFIG_PATH

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting vectorstores API (UP)...")
    async with mcp_starlette_app.router.lifespan_context(mcp_starlette_app):
        if app_settings.APPLICATION_INSIGHTS_LOG:
            # logging in application insights
            configure_logging()
            logger.addFilter(CorrelationIdFilter())
            configure_azure_monitor(
                connection_string=app_settings.APPLICATIONINSIGHTS_CONNECTION_STRING,
                logger_name="vectorstores-api.main"
            )
            getLogger("azure.core.pipeline.policies.http_logging_policy").setLevel(WARNING)
            getLogger('azure.monitor.opentelemetry.exporter.export._base').setLevel(WARNING)
        else:
            # logging in elastic search or locally
            LOG_JSON_FORMAT = TypeAdapter(bool).validate_python(getenv("LOG_JSON_FORMAT", False))
            COLOR_LOGS = TypeAdapter(bool).validate_python(getenv("COLOR_LOGS", True))
            LOG_LEVEL = getenv("LOG_LEVEL", "INFO")
            setup_logging(json_logs=LOG_JSON_FORMAT, log_level=LOG_LEVEL, color_logs=COLOR_LOGS)
        yield
    logger.info("Finished vectorstores API (DOWN)")
    logger.info("Exiting...")


app = FastAPI(
    title="YellowStorm Vectorstores API",
    description="Standalone API for vector store operations, document indexing, and similarity search",
    version="1.0.0",
    lifespan=lifespan,
)

# Initialize rate limiter with Redis as storage backend
limiter = Limiter(
    key_func=get_remote_address,
    storage_uri=f"redis://{app_settings.REDIS_HOST}:{app_settings.REDIS_PORT}/{app_settings.REDIS_DB}",
    default_limits=["100/minute"],  # Default rate limit for all endpoints
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Add middleware
add_middleware(app, app_settings)

# Include routers
app.include_router(vectorstores.router)
app.mount("/mcp", mcp_starlette_app)  # MCP info + transport endpoints at /mcp

# Add health check endpoint
@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "vectorstores-api"}


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    # Convert any non-serializable objects in the body to strings
    body = exc.body
    if body is not None:
        # Handle nested objects that might not be JSON serializable
        try:
            import json
            json.dumps(body)  # Test if serializable
        except (TypeError, ValueError):
            # If not serializable, convert to string representation
            body = str(body)

    return JSONResponse(
        status_code=HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "error": "Validation Error",
            "details": exc.errors(),
            "body": body
        }
    )


if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        log_config=config_path,
        host=app_settings.HOST,
        port=app_settings.PORT,
        ssl_keyfile=app_settings.SSL_KEYFILE,
        ssl_certfile=app_settings.SSL_CERTFILE,
        timeout_keep_alive=app_settings.TIMEOUT_KEEP_ALIVE,
        workers=app_settings.UVICORN_WORKERS
    )
