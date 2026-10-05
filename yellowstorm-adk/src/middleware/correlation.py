import re
import uuid
from contextvars import ContextVar

from fastapi import Request
from opentelemetry import trace
from opentelemetry.trace import Span
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

# Unified-logging bridge (P05): ADK context flows into the observability SDK through
# structlog contextvars, which it merges on the emitting thread at log time.
from structlog.contextvars import bind_contextvars, unbind_contextvars

_CORRELATION_FIELDS = ("request_id", "username", "user_id")

correlation_id_ctx: ContextVar[str | None] = ContextVar("correlation_id", default=None)
# Holds the display user (username/email) — used for the [%(user)s] log column.
# Bound only after authentication (get_current_user), never from a raw header here.
user_ctx: ContextVar[str | None] = ContextVar("user", default=None)
# Holds the stable user identifier (user_id) — used for logs/metadata (e.g. LiteLLM).
user_id_ctx: ContextVar[str | None] = ContextVar("user_id", default=None)

# W3C traceparent: 00-<32 hex trace id>-<16 hex span id>-<2 hex flags>.
_TRACEPARENT_RE = re.compile(r"^00-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$", re.IGNORECASE)


def trace_id_from_header(value: str | None) -> str:
    """Reuse an inbound W3C traceparent's trace id, else start a fresh trace."""
    if value:
        match = _TRACEPARENT_RE.match(value.strip())
        if match:
            return match.group(1)
    return uuid.uuid4().hex


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
    def set_user_id(cls, user_id: str) -> None:
        """
        Set the current stable user identifier (user_id) in the context.
        Args:
            user_id (str): The stable user identifier.
        """
        user_id_ctx.set(user_id)

    @classmethod
    def get_user_id(cls) -> str:
        """
        Get the current stable user identifier (user_id) from the context.
        Returns:
            str: The user_id, or 'unknown' if not set.
        """
        return user_id_ctx.get() or 'unknown'

    @classmethod
    def clear(cls) -> None:
        """
        Clear the user context (called at the end of request processing).
        """
        user_ctx.set(None)
        user_id_ctx.set(None)













def get_correlation_id() -> str:
    """Retrieve the correlation ID for the current request.

    If no correlation ID exists in the current context, generates a new UUID.
    """
    corr_id = correlation_id_ctx.get()
    if not corr_id:
        corr_id = str(uuid.uuid4())
        correlation_id_ctx.set(corr_id)
    bind_contextvars(request_id=corr_id)
    return corr_id

def get_user() -> str:
    """ Retrieve the user for the current request.
    Delegates to the unified UserContext which works for both HTTP and gRPC.
    Returns:
        str: The user ID, or 'unknown' if not set.
    """
    return UserContext.get_user()

def get_user_id() -> str:
    """ Retrieve the stable user identifier (user_id) for the current request.
    Returns:
        str: The user_id, or 'unknown' if not set.
    """
    return UserContext.get_user_id()

def get_user_label() -> str:
    """Build a combined "username (user_id)" label for external systems.

    Used as the LiteLLM ``user`` (end_user) field so its logs show both the
    human-readable name and the stable user_id in a single column. Falls back
    gracefully when either part is missing.

    Returns:
        str: ``"username (user_id)"``, or whichever part is available, or 'unknown'.
    """
    username = get_user()
    user_id = get_user_id()
    if username == 'unknown' and user_id == 'unknown':
        return 'unknown'
    if username == 'unknown':
        return user_id
    if user_id == 'unknown':
        return username
    return f"{username} ({user_id})"

def set_user_context(user_id: str | None, username: str | None):
    """Bind both the user_id and the display username to the request context.

    Sets the stable user_id (used for logs/metadata) and returns the token for the
    display username contextvar so callers can reset it exactly like before.

    Args:
        user_id (str | None): The stable user identifier.
        username (str | None): The display username (or email).

    Returns:
        Token for the username contextvar (pass to ``user_ctx.reset``).
    """
    user_id_ctx.set(user_id or None)
    bind_contextvars(user_id=user_id or "", username=username or "")
    return user_ctx.set(username or None)

class CorrelationIdMiddleware(BaseHTTPMiddleware):
    """Handle HTTP requests and set correlation ID + user context."""

    async def dispatch(self, request: Request, call_next) -> Response:
        # Set correlation ID from header if provided, otherwise leave as None
        # get_correlation_id() will generate UUID if needed
        corr_id = request.headers.get("correlation-id")
        # Acting-user identity is NOT trusted here: it is bound by the
        # authenticated dependency (get_current_user) after the API key check
        # (plan P05 trusted-identity re-binding).

        corr_token = correlation_id_ctx.set(corr_id)

        # Get or generate the final correlation ID
        final_corr_id = get_correlation_id()
        trace_id = trace_id_from_header(request.headers.get("traceparent"))
        bind_contextvars(trace_id=trace_id)

        span: Span = trace.get_current_span()
        if span and span.is_recording():
            span.set_attribute("correlationId", final_corr_id)
            span.set_attribute("component", "API-metachatbot")
            # Track if correlation ID was generated vs provided
            span.set_attribute("correlation_id_source", "header" if corr_id else "generated")

        try:
            response = await call_next(request)
        finally:
            correlation_id_ctx.reset(corr_token)
            unbind_contextvars(*_CORRELATION_FIELDS, "trace_id")

        response.headers["correlation-id"] = final_corr_id
        return response
