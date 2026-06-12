
from fastapi import FastAPI
import structlog
from ddtrace.contrib.asgi import TraceMiddleware


def add_tracing(app: FastAPI) -> None:
    """
    Add tracing middleware to FastAPI application.
    """
    tracing_middleware = next((m for m in app.user_middleware if m.cls == TraceMiddleware), None)
    if tracing_middleware is not None:
        app.user_middleware = [m for m in app.user_middleware if m.cls != TraceMiddleware]
        structlog.stdlib.get_logger("api.datadog_patch").info(
            "Patching Datadog tracing middleware to be the outermost middleware..."
        )
        app.user_middleware.insert(0, tracing_middleware)
        app.middleware_stack = app.build_middleware_stack()