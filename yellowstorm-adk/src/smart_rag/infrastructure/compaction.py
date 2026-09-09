"""Builds the chat Runner with ADK context compaction when the request enabled it.

The request's compaction config is resolved once into a RequestCompactionConfig
(see model_parameters.resolve_model_config) and read here to construct an ADK
`EventsCompactionConfig`. When compaction is off, we build the same plain
`Runner(agent=...)` the chat used before, so behavior is unchanged by default.
"""
from __future__ import annotations

import logging
import warnings
from typing import Any

from google.adk.apps import App
from google.adk.apps.app import EventsCompactionConfig
from google.adk.apps.llm_event_summarizer import LlmEventSummarizer
from google.adk.runners import Runner

from src.config.settings import get_settings
from src.smart_rag.infrastructure.model_parameters import get_request_compaction_config
from src.smart_rag.infrastructure.processing.plugin import CleanSessionPlugin

logger = logging.getLogger(__name__)

# Same literal used at the other runner sites (runner.py, session/manager.py).
APP_NAME = "manager_app"


def _summarizer_model(default_model: str) -> str:
    """Prefer an explicit fast summarizer model; env override wins over the
    per-request model so latency-sensitive deployments can pin a cheap model."""
    env_model = str(
        getattr(get_settings(), "SMART_RAG_COMPACTION_SUMMARIZER_MODEL", "") or ""
    ).strip()
    return env_model or default_model


def build_events_compaction_config() -> EventsCompactionConfig | None:
    """Construct an ADK EventsCompactionConfig from the request-scoped config, or
    None when compaction is disabled / no trigger pair is usable."""
    cfg = get_request_compaction_config()
    if cfg is None:
        return None

    kwargs: dict[str, Any] = {}
    if cfg.compaction_interval and cfg.compaction_interval > 0:
        kwargs["compaction_interval"] = cfg.compaction_interval
        kwargs["overlap_size"] = cfg.overlap_size or 0
    if cfg.token_threshold and cfg.token_threshold > 0:
        kwargs["token_threshold"] = cfg.token_threshold
        kwargs["event_retention_size"] = cfg.event_retention_size or 0
    if not kwargs:
        return None

    # Deferred import: llm_factory imports model_parameters, so a top-level import
    # here would create a cycle (model_parameters is imported above).
    from src.smart_rag.infrastructure.factories.llm_factory import LLMFactory

    summarizer = LlmEventSummarizer(
        llm=LLMFactory.create_no_tool_calls_llm(_summarizer_model(cfg.summarizer_model))
    )
    # ADK marks EventsCompactionConfig experimental and warns on every construction;
    # this runs per chat turn, so silence just that warning to avoid log spam.
    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", category=UserWarning, message=r".*EventsCompactionConfig.*")
        return EventsCompactionConfig(summarizer=summarizer, **kwargs)


def make_chat_runner(agent, session_service) -> Runner:
    """Chat Runner, with compaction wired in when the request enabled it. Falls
    back to the plain agent Runner (today's behavior) when it did not."""
    ecc = build_events_compaction_config()
    if ecc is None:
        return Runner(
            agent=agent,
            app_name=APP_NAME,
            session_service=session_service,
            plugins=[CleanSessionPlugin()],
        )
    logger.info(
        "[compaction] enabled: interval=%s overlap=%s token_threshold=%s retention=%s",
        ecc.compaction_interval,
        ecc.overlap_size,
        ecc.token_threshold,
        ecc.event_retention_size,
    )
    # Plugins move from the Runner arg into the App (they are mutually exclusive
    # with `app=`); root_agent + events_compaction_config drive the ADK loop.
    app = App(
        name=APP_NAME,
        root_agent=agent,
        plugins=[CleanSessionPlugin()],
        events_compaction_config=ecc,
    )
    return Runner(app=app, session_service=session_service)
