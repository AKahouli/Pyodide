import uuid
from contextvars import ContextVar, copy_context
from email.policy import default

from fastapi import Request
from opentelemetry import trace
from opentelemetry.trace import Span
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

correlation_id_ctx: ContextVar[str | None] = ContextVar("correlation_id", default=None)
user_ctx: ContextVar[str | None] = ContextVar("user", default=None)


class UserContext:
    """
    Unified context manager for user information that works across both HTTP and gRPC requests.
    Uses contextvars (async-safe) to maintain user context within a request scope.
    """

    @classmethod
    def set_user(cls, user_id: str) -> None:
        """
        Set the current user ID in the context.
        Args:
            user_id (str): The user identifier (username, email, etc.)
        """
        user_ctx.set(user_id)

    @classmethod
    def get_user(cls) -> str:
        """
        Get the current user ID from the context.
        Returns:
            str: The user ID, or 'unknown' if not set.
        """
        return user_ctx.get() or 'unknown'

    @classmethod
    def clear(cls) -> None:
        """
        Clear the user context (called at the end of request processing).
        """
        token = user_ctx.set(None)













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
    """ Retrieve the user for the current request.
    Delegates to the unified UserContext which works for both HTTP and gRPC.
    Returns:
        str: The user ID, or 'unknown' if not set.
    """
    return UserContext.get_user()

class CorrelationIdMiddleware(BaseHTTPMiddleware):
    """Handle HTTP requests and set correlation ID + user context."""

    async def dispatch(self, request: Request, call_next) -> Response:
        # Set correlation ID from header if provided, otherwise leave as None
        # get_correlation_id() will generate UUID if needed
        corr_id = request.headers.get("correlation-id")
        # Get user from HTTP header
        user = request.headers.get("user")

        corr_token = correlation_id_ctx.set(corr_id)
        user_token = None
        # Set user in unified context if provided in HTTP header
        if user:
            user_token = user_ctx.set(user)

        # Get or generate the final correlation ID
        final_corr_id = get_correlation_id()

        span: Span = trace.get_current_span()
        if span and span.is_recording():
            span.set_attribute("correlationId", final_corr_id)
            if user:
                span.set_attribute("user", user)
            span.set_attribute("component", "API-metachatbot")
            # Track if correlation ID was generated vs provided
            span.set_attribute("correlation_id_source", "header" if corr_id else "generated")

        try:
            response = await call_next(request)
        finally:
            correlation_id_ctx.reset(corr_token)
            if user_token is not None:
                user_ctx.reset(user_token)

        response.headers["correlation-id"] = final_corr_id
        return response
