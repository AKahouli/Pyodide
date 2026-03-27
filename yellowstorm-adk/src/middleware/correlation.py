import uuid
from contextvars import ContextVar
from email.policy import default

from fastapi import Request
from opentelemetry import trace
from opentelemetry.trace import Span
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

correlation_id_ctx: ContextVar[str | None] = ContextVar("correlation_id", default=None)
user_ctx: ContextVar[str | None] = ContextVar("user", default=None)

def get_correlation_id() -> str:
    """Retrieve the correlation ID for the current request.

    If no correlation ID exists in the current context, generates a new UUID.
    """
    corr_id = correlation_id_ctx.get()
    if not corr_id:
        corr_id = str(uuid.uuid4())
        correlation_id_ctx.set(corr_id)
    return corr_id

def get_user() -> str:
    """Retrieve the user for the current request.

    Returns 'unknown' if no user is set in the current context.
    """
    user = user_ctx.get()
    return user if user else "unknown"

class CorrelationIdMiddleware(BaseHTTPMiddleware):
    """Middleware that attaches a correlation ID and user to each request and span."""

    async def dispatch(self, request: Request, call_next) -> Response:
        # Set correlation ID from header if provided, otherwise leave as None
        # get_correlation_id() will generate UUID if needed
        corr_id = request.headers.get("correlation-id")
        user = request.headers.get("user", "unknown")

        corr_token = correlation_id_ctx.set(corr_id)
        user_token = user_ctx.set(user)

        # Get or generate the final correlation ID
        final_corr_id = get_correlation_id()

        span: Span = trace.get_current_span()
        if span and span.is_recording():
            span.set_attribute("correlationId", final_corr_id)
            span.set_attribute("user", user)
            span.set_attribute("component", "API-metachatbot")
            # Track if correlation ID was generated vs provided
            span.set_attribute("correlation_id_source", "header" if corr_id else "generated")

        try:
            response = await call_next(request)
        finally:
            correlation_id_ctx.reset(corr_token)
            user_ctx.reset(user_token)

        response.headers["correlation-id"] = final_corr_id
        return response
