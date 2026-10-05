import logging
import os
import sys

import structlog
from structlog.types import EventDict, Processor

from src.config.settings import get_settings

try:
    from ddtrace import tracer
except Exception:  # pragma: no cover - optional dependency
    tracer = None

#app_settings = get_settings()


# https://github.com/hynek/structlog/issues/35#issuecomment-591321744
def rename_event_key(_, __, event_dict: EventDict) -> EventDict:
    """
    Log entries keep the text message in the `event` field, but Datadog
    uses the `message` field. This processor moves the value from one field to
    the other.
    See https://github.com/hynek/structlog/issues/35#issuecomment-591321744
    """
    event_dict["message"] = event_dict.pop("event")
    return event_dict


def drop_color_message_key(_, __, event_dict: EventDict) -> EventDict:
    """
    Uvicorn logs the message a second time in the extra `color_message`, but we don't
    need it. This processor drops the key from the event dict if it exists.
    """
    event_dict.pop("color_message", None)
    return event_dict


def tracer_injection(_, __, event_dict: EventDict) -> EventDict:
    # get correlation ids from current tracer context
    span = tracer.current_span() if tracer is not None else None
    trace_id, span_id = (span.trace_id, span.span_id) if span else (None, None)

    # add ids to structlog event dictionary
    event_dict["dd.trace_id"] = str(trace_id or 0)
    event_dict["dd.span_id"] = str(span_id or 0)

    return event_dict


def _silence_noise_loggers() -> None:
    """Clear uvicorn handlers and quiet third-party noise (shared by both bootstrap paths)."""
    for _log in ["uvicorn", "uvicorn.error"]:
        logging.getLogger(_log).handlers.clear()
        logging.getLogger(_log).propagate = True
    logging.getLogger("uvicorn.access").handlers.clear()
    logging.getLogger("uvicorn.access").propagate = False
    logging.getLogger("elastic_transport").setLevel(logging.CRITICAL)
    logging.getLogger("azure.core.pipeline.policies.http_logging_policy").setLevel(logging.CRITICAL)
    logging.getLogger("litellm").setLevel(logging.CRITICAL)
    logging.getLogger("LiteLLM").setLevel(logging.CRITICAL)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("adk").setLevel(logging.WARNING)
    logging.getLogger("google_adk").setLevel(logging.WARNING)
    logging.getLogger("google.adk.sessions").setLevel(logging.WARNING)
    logging.getLogger("mem0").setLevel(logging.WARNING)
    logging.getLogger("mem0.memory.main").setLevel(logging.WARNING)


def setup_logging(json_logs: bool = False, log_level: str = "INFO", color_logs: bool = True):
    # Unified-logging cutover (plan P06): when enabled, the shared SDK owns the bootstrap —
    # structlog bridge + bounded stderr writer instead of the PostgreSQL sink.
    if os.getenv("USE_YELLOWMIND_OBSERVABILITY", "true").strip().lower() not in ("0", "false", "no", "off"):
        from yellowmind_observability import setup_observability

        setup_observability(min_level=log_level)
        _silence_noise_loggers()
        return

    app_settings = get_settings()
    timestamper = structlog.processors.TimeStamper(fmt="iso")
    shared_processors: list[Processor] = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.stdlib.ExtraAdder(),
        drop_color_message_key,
        tracer_injection,
        timestamper,
        structlog.processors.StackInfoRenderer(),
    ]

    if json_logs:
        # We rename the `event` key to `message` only in JSON logs, as Datadog looks for the
        # `message` key but the pretty ConsoleRenderer looks for `event`
        shared_processors.append(rename_event_key)
        # Format the exception only for JSON logs, as we want to pretty-print them when
        # using the ConsoleRenderer
        shared_processors.append(structlog.processors.format_exc_info)

    structlog.configure(
        processors=shared_processors
        + [
            # Prepare event dict for `ProcessorFormatter`.
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )

    log_renderer: structlog.types.Processor
    if json_logs:
        log_renderer = structlog.processors.JSONRenderer()
    else:
        # The default rich traceback prints frame locals, which leaks settings
        # secrets (API keys, DB passwords) whenever a traceback is logged.
        log_renderer = structlog.dev.ConsoleRenderer(
            colors=color_logs,
            exception_formatter=structlog.dev.RichTracebackFormatter(show_locals=False),
        )

    formatter = structlog.stdlib.ProcessorFormatter(
        # These run ONLY on `logging` entries that do NOT originate within
        # structlog.
        foreign_pre_chain=shared_processors,
        # These run on ALL entries after the pre_chain is done.
        processors=[
            # Remove _record & _from_structlog.
            structlog.stdlib.ProcessorFormatter.remove_processors_meta,
            log_renderer,
        ],
    )

    handler = logging.StreamHandler()
    # Use OUR `ProcessorFormatter` to format all `logging` entries.
    handler.setFormatter(formatter)
    root_logger = logging.getLogger()
    root_logger.addHandler(handler)
    root_logger.setLevel(log_level.upper())

    # Add PostgreSQL handler if enabled
    if app_settings.ENABLE_POSTGRESQL_LOGGING:
        try:
            from src.logger.postgresql_handler import PostgreSQLHandler
            from src.logger.logging import CorrelationIdFilter

            pg_handler = PostgreSQLHandler(
                batch_size=app_settings.POSTGRESQL_LOG_BATCH_SIZE,
                flush_interval=app_settings.POSTGRESQL_LOG_FLUSH_INTERVAL,
                pool_size=app_settings.POSTGRESQL_LOG_POOL_SIZE,
                max_overflow=app_settings.POSTGRESQL_LOG_MAX_OVERFLOW,
            )
            pg_handler.setFormatter(formatter)

            # Add correlation ID filter to enrich logs with custom fields
            correlation_filter = CorrelationIdFilter()
            pg_handler.addFilter(correlation_filter)

            root_logger.addHandler(pg_handler)
            root_logger.info("PostgreSQL logging handler enabled")
        except Exception as e:
            root_logger.error(f"Failed to initialize PostgreSQL logging handler: {e}")

    _silence_noise_loggers()

    def handle_exception(exc_type, exc_value, exc_traceback):
        """
        Log any uncaught exception instead of letting it be printed by Python
        (but leave KeyboardInterrupt untouched to allow users to Ctrl+C to stop)
        See https://stackoverflow.com/a/16993115/3641865
        """
        if issubclass(exc_type, KeyboardInterrupt):
            sys.__excepthook__(exc_type, exc_value, exc_traceback)
            return

        root_logger.error("Uncaught exception", exc_info=(exc_type, exc_value, exc_traceback))

    sys.excepthook = handle_exception
