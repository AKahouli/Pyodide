"""
Tracing context management utilities.

This module provides utilities to bind Datadog trace IDs and span IDs to the
structlog context, ensuring all logs generated during request processing
contain distributed tracing information.
"""

from typing import Optional
import structlog
from src.config.settings import get_settings


def bind_trace_context() -> Optional[dict]:
    """
    Bind current Datadog trace_id and span_id to structlog context.

    This ensures all subsequent logs in the current request will include
    the trace_id and span_id for distributed tracing.

    Returns:
        dict with trace_id and span_id if a span is active, None otherwise

    Example:
        ```python
        @app.post("/endpoint")
        async def my_endpoint():
            bind_trace_context()  # All logs will have trace_id and span_id
            logger.info("Processing request")
        ```
    """
    settings = get_settings()

    # Only use ddtrace if enabled
    if not settings.DD_TRACE_ENABLED:
        return None

    try:
        from ddtrace import tracer

        current_span = tracer.current_span()
        if current_span:
            trace_context = {
                'trace_id': str(current_span.trace_id),
                'span_id': str(current_span.span_id)
            }
            structlog.contextvars.bind_contextvars(**trace_context)
            return trace_context
    except ImportError:
        pass

    return None


def update_trace_context_with_span(span) -> None:
    """
    Update structlog context with a new span's IDs.

    This should be called when creating a new custom span to ensure
    logs use the new span_id while keeping the same trace_id.

    Args:
        span: The Datadog span to bind to context

    Example:
        ```python
        with tracer.trace("my_operation") as span:
            update_trace_context_with_span(span)
            logger.info("Operation started")  # Will use new span_id
        ```
    """
    settings = get_settings()

    # Only use ddtrace if enabled
    if not settings.DD_TRACE_ENABLED:
        return

    if span:
        structlog.contextvars.bind_contextvars(
            trace_id=str(span.trace_id),
            span_id=str(span.span_id)
        )


def create_traced_span(name: str, service: str = "api-metachatbot-adk", resource: str = None, **tags):
    """
    Context manager to create a traced span with automatic context binding.

    This creates a new Datadog span, binds it to structlog context, and allows
    setting custom tags for better observability.

    Args:
        name: Name of the span (e.g., "llm.openai_call")
        service: Service name for Datadog (default: "api-metachatbot-adk")
        resource: Resource name (e.g., "POST /endpoint")
        **tags: Additional tags to set on the span

    Returns:
        Context manager for the span

    Example:
        ```python
        with create_traced_span("llm.call", model="gpt-4", user_id="123"):
            response = await llm.generate()
            # All logs here have the span context
        ```
    """
    settings = get_settings()

    # If ddtrace is disabled, return a no-op context manager
    if not settings.DD_TRACE_ENABLED:
        class NoOpContext:
            def __enter__(self):
                return None

            def __exit__(self, exc_type, exc_val, exc_tb):
                return False

        return NoOpContext()

    # If ddtrace is enabled, create the actual traced span
    try:
        from ddtrace import tracer

        class TracedSpanContext:
            def __init__(self, span_name, span_service, span_resource, span_tags):
                self.span_name = span_name
                self.span_service = span_service
                self.span_resource = span_resource
                self.span_tags = span_tags
                self.span = None

            def __enter__(self):
                self.span = tracer.trace(
                    self.span_name,
                    service=self.span_service,
                    resource=self.span_resource or self.span_name
                ).__enter__()

                # Set custom tags
                for key, value in self.span_tags.items():
                    self.span.set_tag(key, value)

                # Bind to structlog context
                update_trace_context_with_span(self.span)

                return self.span

            def __exit__(self, exc_type, exc_val, exc_tb):
                if exc_type:
                    # Mark span as error
                    self.span.set_tag("error", True)
                    self.span.set_tag("error.type", exc_type.__name__)
                    self.span.set_tag("error.message", str(exc_val))

                return self.span.__exit__(exc_type, exc_val, exc_tb)

        return TracedSpanContext(name, service, resource, tags)

    except ImportError:
        # If ddtrace is not installed, return no-op context manager
        class NoOpContext:
            def __enter__(self):
                return None

            def __exit__(self, exc_type, exc_val, exc_tb):
                return False

        return NoOpContext()