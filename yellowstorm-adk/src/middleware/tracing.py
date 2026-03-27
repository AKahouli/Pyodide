
from fastapi import FastAPI
import structlog
from src.config.settings import get_settings


def add_tracing(app: FastAPI) -> None:
    """
    Add tracing middleware to FastAPI application.
    Only loads ddtrace if DD_TRACE_ENABLED is True.
    """
    settings = get_settings()

    # Only import and use ddtrace if enabled
    if not settings.DD_TRACE_ENABLED:
        return

    try:
        from ddtrace.contrib.asgi.middleware import TraceMiddleware

        tracing_middleware = next((m for m in app.user_middleware if m.cls == TraceMiddleware), None)
        if tracing_middleware is not None:
            app.user_middleware = [m for m in app.user_middleware if m.cls != TraceMiddleware]
            structlog.stdlib.get_logger("api.datadog_patch").info(
                "Patching Datadog tracing middleware to be the outermost middleware..."
            )
            app.user_middleware.insert(0, tracing_middleware)
            app.middleware_stack = app.build_middleware_stack()
    except ImportError:
        structlog.stdlib.get_logger("api.datadog_patch").warning(
            "ddtrace not installed, skipping tracing middleware"
        )