import logging
import os
from typing import Any, TYPE_CHECKING

from logging import Filter, LogRecord
from pydantic import parse_obj_as

from src.config.settings import get_settings
from src.logger.setup_logging import setup_logging

if TYPE_CHECKING:
    from elasticsearch import Elasticsearch

try:
    from src.logger.elastic_search import elastic_search_logging
except Exception:  # pragma: no cover - optional dependency
    def elastic_search_logging(*args: Any, **kwargs: Any) -> None:  # type: ignore[no-redef]
        return None

class CorrelationIdFilter(Filter):
    """
    Logging filter that enriches log records with correlation and context data.

    Adds correlation ID, user info, and contextual fields from structlog contextvars
    (request_id, user_id, session_id, HTTP metadata, network info, trace IDs).
    """

    # Fields to copy from structlog contextvars to LogRecord
    _CONTEXT_FIELDS = [
        'request_id',
        'user_id',
        'session_id',
        'http_method',
        'http_url',
        'http_status_code',
        'client_ip',
        'client_port',
        'duration_ns',
        'user_mail',
    ]

    def filter(self, record: LogRecord) -> bool:
        """
        Enrich the log record with correlation and context information.

        Args:
            record: The log record to enrich

        Returns:
            True (always allows the record to be logged)
        """
        from src.middleware.correlation import get_user
        import structlog

        # Add basic correlation fields
        record.user = get_user()
        record.component = "API-metachatbot"

        # Extract and bind contextvars from structlog
        try:
            context = structlog.contextvars.get_contextvars()

            # Get correlation ID from structlog (bound as request_id in middleware)
            record.correlationId = context.get('request_id', 'unknown')

            # Copy standard context fields to record
            for field in self._CONTEXT_FIELDS:
                if field in context and not hasattr(record, field):
                    setattr(record, field, context[field])

            # Handle Datadog trace IDs (special case with fallback)
            self._bind_trace_ids(record, context)

        except Exception:
            # If structlog contextvars not available, continue without them
            record.correlationId = 'unknown'

        return True

    def _bind_trace_ids(self, record: LogRecord, context: dict) -> None:
        """
        Bind Datadog trace and span IDs to the log record.

        Attempts to get IDs from context first, then falls back to the active tracer span.

        Args:
            record: The log record to enrich
            context: The structlog context dictionary
        """
        # Try to get trace_id from context or tracer
        if 'trace_id' in context:
            setattr(record, 'dd.trace_id', context['trace_id'])
        elif not hasattr(record, 'dd.trace_id'):
            setattr(record, 'dd.trace_id', self._get_current_trace_id())

        # Try to get span_id from context or tracer
        if 'span_id' in context:
            setattr(record, 'dd.span_id', context['span_id'])
        elif not hasattr(record, 'dd.span_id'):
            setattr(record, 'dd.span_id', self._get_current_span_id())

    @staticmethod
    def _get_current_trace_id() -> str | None:
        """Get the current Datadog trace ID from the active span."""
        try:
            from ddtrace import tracer
            span = tracer.current_span()
            return str(span.trace_id) if span else None
        except Exception:
            return None

    @staticmethod
    def _get_current_span_id() -> str | None:
        """Get the current Datadog span ID from the active span."""
        try:
            from ddtrace import tracer
            span = tracer.current_span()
            return str(span.span_id) if span else None
        except Exception:
            return None

def configure_logging():
    """
        Configures logging for the application.

        This function sets up a logging configuration with the following features:
        - Adds a stream handler to output logs to the console.
        - Applies a custom filter to ensure that all log records include a correlation ID.
        - Sets the log level to INFO.
        - Defines a log format that includes the log level, timestamp, logger name, line number,
          correlation ID, and the log message.

        Example of a log entry:
            INFO:     2024-08-02 10:25:24,263 api.main:54 [d218756bb3e44f0090f8699f0bedc4e5] Log message

        Returns:
            None
        """


    cid_filter = CorrelationIdFilter()
    console_handler = logging.StreamHandler()
    console_handler.addFilter(cid_filter)
    logging.basicConfig(
        handlers=[console_handler],
        level=logging.INFO,
        format='%(levelname)s: \t  %(asctime)s %(name)s:%(lineno)d [%(correlationId)s] [%(user)s] %(message)s')



def get_logger(name: str, setup_logger: bool = False) -> logging.Logger:
    """
    Get a logger with the given name.

    Args:
        name (str): The name of the logger.
        setup_logger (bool, optional): Whether to setup the logger. Defaults to False.

    Returns:
        logging.Logger: The logger with the given name.
    """
    app_settings = get_settings()
    if setup_logger:
        LOG_JSON_FORMAT = parse_obj_as(bool, os.getenv("LOG_JSON_FORMAT", False))
        COLOR_LOGS = parse_obj_as(bool, os.getenv("COLOR_LOGS", True))
        LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
        setup_logging(json_logs=LOG_JSON_FORMAT, log_level=LOG_LEVEL, color_logs=COLOR_LOGS)
    logger = logging.getLogger(name)
    return logger
