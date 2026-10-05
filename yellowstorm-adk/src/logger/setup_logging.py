import logging

# Unified logging (plan P06/P11): the shared SDK owns the bootstrap — structlog bridge
# + bounded stderr writer. The legacy structlog/PostgreSQL sink was retired in P11;
# the historic application_logs table remains for its readers, nothing writes to it.


def _silence_noise_loggers() -> None:
    """Clear uvicorn handlers and quiet third-party noise."""
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
    # json_logs/color_logs are accepted for call-site compatibility; the SDK's stderr
    # JSON-lines contract replaces both knobs.
    from yellowmind_observability import setup_observability

    setup_observability(min_level=log_level)
    _silence_noise_loggers()
