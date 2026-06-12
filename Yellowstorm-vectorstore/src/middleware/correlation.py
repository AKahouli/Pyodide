from contextvars import ContextVar
from fastapi import Request
from opentelemetry import trace
from opentelemetry.trace import Span
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

correlation_id_ctx: ContextVar[str] = ContextVar("correlation_id", default=None)
user_ctx: ContextVar[str] = ContextVar("user", default="unknown")

def get_correlation_id() -> str:
    """Retrieve the correlation ID for the current request."""
    return correlation_id_ctx.get()

def get_user() -> str:
    """Retrieve the user for the current request."""
    return user_ctx.get()

class CorrelationIdMiddleware(BaseHTTPMiddleware):
    """Middleware that attaches a correlation ID and user to each request and span."""

    async def dispatch(self, request: Request, call_next) -> Response:
        corr_id = request.headers.get("correlation-id", "unknown")
        user = request.headers.get("user", "unknown")
        
        corr_token = correlation_id_ctx.set(corr_id)
        user_token = user_ctx.set(user)

        span: Span = trace.get_current_span()
        if span and span.is_recording():
            span.set_attribute("correlationId", corr_id)
            span.set_attribute("user", user)
            span.set_attribute("component", "API-metachatbot")
        try:
            response = await call_next(request)
        finally:
            correlation_id_ctx.reset(corr_token)
            user_ctx.reset(user_token)

        response.headers["correlation-id"] = corr_id
        return response
