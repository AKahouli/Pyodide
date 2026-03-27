import time
import uuid

import structlog
from fastapi import FastAPI, Request, Response
from uvicorn.protocols.utils import get_path_with_query_string


def add_logging(app: FastAPI) -> None:
    """
    Add logging middleware to FastAPI application.
    """

    @app.middleware("http")
    async def logging_middleware(request: Request, call_next) -> Response:
        """
        Middleware to log HTTP requests and responses with structured logging.

        Binds request context (correlation ID, HTTP method, URL, client info) to all logs
        generated during the request lifecycle, and logs access information after response.
        """
        access_logger = structlog.stdlib.get_logger("api.access")
        structlog.contextvars.clear_contextvars()

        # Extract request information
        # Extract correlation-id from header (with hyphen), or generate new UUID
        request_id = request.headers.get("correlation-id") or str(uuid.uuid4())
        client_host = request.client.host if request.client else None  # type: ignore
        client_port = request.client.port if request.client else None  # type: ignore
        http_method = request.method
        url = get_path_with_query_string(request.scope)  # type: ignore
        http_version = request.scope["http_version"]

        # Extract user email from headers for username column
        user_mail = request.headers.get("user", "unknown")
        # Bind context vars that will be added to ALL log entries during the request
        structlog.contextvars.bind_contextvars(
            request_id=request_id,
            user_mail=user_mail,
            http_method=http_method,
            http_url=str(request.url),
            client_ip=client_host,
            client_port=client_port,
        )

        start_time = time.perf_counter_ns()
        response = Response(status_code=500)  # Default error response

        try:
            response = await call_next(request)
        except Exception:
            structlog.stdlib.get_logger("api.error").exception("Uncaught exception")
            raise
        finally:
            # Calculate request duration and get final status
            process_time = time.perf_counter_ns() - start_time
            status_code = response.status_code

            # Bind status_code and duration to contextvars for PostgreSQL logging
            structlog.contextvars.bind_contextvars(
                http_status_code=status_code,
                duration_ns=process_time,
            )

            # Log access information in Uvicorn format
            access_logger.info(
                f"""{client_host}:{client_port} - "{http_method} {url} HTTP/{http_version}" {status_code}""",
                http={
                    "url": str(request.url),
                    "status_code": status_code,
                    "method": http_method,
                    "request_id": request_id,
                    "version": http_version,
                },
                network={"client": {"ip": client_host, "port": client_port}},
                duration=process_time,
            )

            # Add process time header to response
            response.headers["X-Process-Time"] = str(process_time / 10**9)

        return response

