"""Request-scoped latency diagnostic helpers (log only).

Supports the temporary ``conversation_latency_diag.*`` structured logs used to
profile ``DatabaseSessionService.get_session()`` and the Google ADK Runner
pre-model window. Everything here is gated by the presence of the request
:class:`~src.smart_rag.infrastructure.monitoring.conversation_latency.ConversationLatencyTrace`
(its ``ContextVar`` is only populated when the backend Admin latency
instrumentation toggle is enabled), so no new toggle is introduced.

Rules enforced by this module:
- ``time.perf_counter_ns()`` for all process-local timings.
- No prompts, event text, tool payloads, LLM requests, SQL statements, or
  connection URLs ever reach log fields — statements are only classified by
  known ADK table name.
- One summary log per ``get_session()`` call and one ``runner_pre_model``
  summary per turn (first model call only).
"""

from __future__ import annotations

import json
import time
from contextvars import ContextVar, Token
from dataclasses import dataclass, field
from typing import Any, Dict, Optional, Tuple

from src.logger.logging import get_logger
from src.smart_rag.infrastructure.monitoring.conversation_latency import (
    ConversationLatencyTrace,
    get_current_conversation_latency_trace,
)

logger = get_logger("conversation_latency_diag")

SESSION_LOOKUP_EVENT = "conversation_latency_diag.session_lookup"
RUNNER_PRE_MODEL_EVENT = "conversation_latency_diag.runner_pre_model"

# Slow-call warning thresholds (constants by design — no new Admin setting).
SLOW_SESSION_LOOKUP_MS = 500.0
SLOW_RUNNER_PRE_MODEL_MS = 500.0

PHASE_YELLOWMIND_PRE_RUNNER = "yellowmind_pre_runner"
PHASE_GOOGLE_ADK_RUNNER = "google_adk_runner"
PHASE_OTHER = "other"

_current_session_lookup_profile: ContextVar[Optional["SessionLookupProfile"]] = ContextVar(
    "current_session_lookup_profile",
    default=None,
)

current_latency_diag_phase: ContextVar[str] = ContextVar(
    "current_latency_diag_phase",
    default=PHASE_OTHER,
)


def set_latency_diag_phase(phase: str) -> Token:
    return current_latency_diag_phase.set(phase)


def reset_latency_diag_phase(token: Token) -> None:
    current_latency_diag_phase.reset(token)


def latency_diagnostics_enabled() -> bool:
    return get_current_conversation_latency_trace() is not None


@dataclass
class SessionLookupProfile:
    """Per-call accumulator fed by the SQLAlchemy event listeners while one
    ``get_session()`` runs. Counts and durations only — never statement text."""

    started_perf_ns: int = field(default_factory=time.perf_counter_ns)
    lookup_sequence: int = 0
    phase: str = PHASE_OTHER

    prepare_tables_ms: float = 0.0
    tables_already_created: bool = False

    sql_query_count: int = 0
    sql_total_ms: float = 0.0

    session_row_sql_ms: float = 0.0
    events_sql_ms: float = 0.0
    app_state_sql_ms: float = 0.0
    user_state_sql_ms: float = 0.0
    other_sql_ms: float = 0.0

    sql_started_perf_ns: Optional[int] = None

    new_connection_count: int = 0
    pool_checkout_count: int = 0


def _classify_statement(statement: str) -> str:
    stmt = (statement or "").lower()
    # app_states/user_states must be tested before the bare table names they contain.
    if "app_states" in stmt:
        return "app_state"
    if "user_states" in stmt:
        return "user_state"
    if "events" in stmt:
        return "events"
    if "sessions" in stmt:
        return "session_row"
    if any(token in stmt for token in ("alembic", "information_schema", "pragma", "pg_catalog", "adk_internal_metadata")):
        return "metadata"
    return "other"


def _register_sqlalchemy_listeners(profile_target, sync_engine) -> None:
    """Attach request-attributed query/pool counters to one engine.

    Listeners only accumulate into the ContextVar-active profile, so stale
    registrations on a long-lived engine stay inert outside instrumented calls.

    Registration is idempotent per engine: the shared process-wide engine
    outlives many services (and tests), and duplicate listeners would multiply
    the SQL/pool counters for every statement.
    """
    if getattr(sync_engine, "_yellowmind_latency_listeners_registered", False):
        return

    from sqlalchemy import event

    def _before_cursor_execute(conn, cursor, statement, parameters, context, executemany):
        profile = _current_session_lookup_profile.get()
        if profile is None:
            return
        if profile.sql_started_perf_ns is None:
            profile.sql_started_perf_ns = time.perf_counter_ns()

    def _after_cursor_execute(conn, cursor, statement, parameters, context, executemany):
        profile = _current_session_lookup_profile.get()
        if profile is None or profile.sql_started_perf_ns is None:
            return
        duration_ms = (time.perf_counter_ns() - profile.sql_started_perf_ns) / 1_000_000
        profile.sql_started_perf_ns = None
        profile.sql_query_count += 1
        profile.sql_total_ms += max(duration_ms, 0.0)
        category = _classify_statement(statement)
        if category == "session_row":
            profile.session_row_sql_ms += duration_ms
        elif category == "events":
            profile.events_sql_ms += duration_ms
        elif category == "app_state":
            profile.app_state_sql_ms += duration_ms
        elif category == "user_state":
            profile.user_state_sql_ms += duration_ms
        else:
            profile.other_sql_ms += duration_ms

    def _on_connect(dbapi_connection, connection_record):
        profile = _current_session_lookup_profile.get()
        if profile is not None:
            profile.new_connection_count += 1

    def _on_checkout(dbapi_connection, connection_record, connection_proxy):
        profile = _current_session_lookup_profile.get()
        if profile is not None:
            profile.pool_checkout_count += 1

    event.listen(sync_engine, "before_cursor_execute", _before_cursor_execute)
    event.listen(sync_engine, "after_cursor_execute", _after_cursor_execute)
    event.listen(sync_engine, "connect", _on_connect)
    event.listen(sync_engine, "checkout", _on_checkout)
    sync_engine._yellowmind_latency_listeners_registered = True


def _emit(event_name: str, level: int, fields: Dict[str, Any]) -> None:
    payload = {key: value for key, value in fields.items() if value is not None}
    logger.log(level, "%s %s", event_name, json.dumps(payload, separators=(",", ":"), default=str))


def emit_session_lookup_log(
    trace: ConversationLatencyTrace,
    profile: SessionLookupProfile,
    *,
    session_id: str,
    total_ms: float,
    session_found: bool,
    event_count: int,
    state_key_count: int,
) -> None:
    """One structured summary per ``get_session()`` call. WARN on slow calls."""
    assistant_message_id = trace.assistant_message_id
    non_sql_overhead_ms = max(
        total_ms - profile.prepare_tables_ms - profile.sql_total_ms,
        0.0,
    )
    fields = {
        "request_id": trace.request_id,
        "assistant_message_id": assistant_message_id,
        "session_id": session_id,
        "lookup_sequence": profile.lookup_sequence,
        "phase": profile.phase,
        "total_ms": round(total_ms, 1),
        "prepare_tables_ms": round(profile.prepare_tables_ms, 1) if profile.prepare_tables_ms else None,
        "tables_already_created": profile.tables_already_created,
        "sql_query_count": profile.sql_query_count,
        "sql_total_ms": round(profile.sql_total_ms, 1),
        "session_row_sql_ms": round(profile.session_row_sql_ms, 1),
        "events_sql_ms": round(profile.events_sql_ms, 1),
        "app_state_sql_ms": round(profile.app_state_sql_ms, 1),
        "user_state_sql_ms": round(profile.user_state_sql_ms, 1),
        "other_sql_ms": round(profile.other_sql_ms, 1),
        "non_sql_overhead_ms": round(non_sql_overhead_ms, 1),
        "pool_checkout_count": profile.pool_checkout_count,
        "new_connection_count": profile.new_connection_count,
        "session_found": session_found,
        "event_count": event_count,
        "state_key_count": state_key_count,
    }
    level = 30 if total_ms >= SLOW_SESSION_LOOKUP_MS else 20  # logging.WARNING / INFO
    _emit(SESSION_LOOKUP_EVENT, level, fields)


def attribute_lookup_to_trace(
    trace: ConversationLatencyTrace,
    profile: SessionLookupProfile,
    total_ms: float,
) -> None:
    """Aggregate one completed lookup into the runner pre-model summary."""
    if profile.phase == PHASE_GOOGLE_ADK_RUNNER:
        trace.diagnostics.runner_internal_session_lookup_count += 1
        trace.diagnostics.runner_internal_session_lookup_ms += max(total_ms, 0.0)
    else:
        trace.diagnostics.yellowmind_pre_runner_session_lookup_count += 1
        trace.diagnostics.yellowmind_pre_runner_session_lookup_ms += max(total_ms, 0.0)


def _pair_ms(start_ns: Optional[int], end_ns: Optional[int]) -> Optional[float]:
    if start_ns is None or end_ns is None:
        return None
    duration_ms = (end_ns - start_ns) / 1_000_000
    if duration_ms < 0:
        return None
    return duration_ms


def build_runner_pre_model_fields(
    trace: ConversationLatencyTrace,
    *,
    session_id: str,
    agent_name: str,
) -> Dict[str, Any]:
    """Derive the ``runner_pre_model`` summary fields; missing milestones are
    omitted rather than written as fake zeros."""
    diag = trace.diagnostics
    runtime_ms = trace.build_pre_provider_breakdown().get("adk_runtime_pre_model_ms")

    def pair(start: Optional[int], end: Optional[int]) -> Optional[float]:
        value = _pair_ms(start, end)
        return round(value, 1) if value is not None else None

    def rounded(value: Optional[float]) -> Optional[float]:
        return round(value, 1) if value is not None else None

    return {
        "request_id": trace.request_id,
        "assistant_message_id": trace.assistant_message_id,
        "session_id": session_id,
        "agent_name": agent_name,
        "adk_runtime_pre_model_ms": round(runtime_ms, 1) if runtime_ms is not None else None,
        "runner_to_before_run_ms": pair(diag.runner_iteration_start_perf_ns, diag.before_run_perf_ns),
        "before_run_to_user_message_callback_ms": pair(
            diag.before_run_perf_ns, diag.user_message_callback_start_perf_ns
        ),
        "user_message_callback_ms": pair(
            diag.user_message_callback_start_perf_ns, diag.user_message_callback_end_perf_ns
        ),
        "clean_session_ms": rounded(diag.clean_session_ms),
        "image_processing_ms": rounded(diag.image_processing_ms),
        "user_message_to_before_agent_ms": pair(
            diag.user_message_callback_end_perf_ns, diag.before_agent_perf_ns
        ),
        "before_agent_to_before_model_ms": pair(diag.before_agent_perf_ns, diag.before_model_perf_ns),
        "before_model_to_litellm_ms": pair(diag.before_model_perf_ns, trace.llm_request_start_perf_ns),
        "pre_model_session_lookup_count": diag.runner_internal_session_lookup_count or None,
        "pre_model_session_lookup_ms": round(diag.runner_internal_session_lookup_ms, 1) or None,
        "yellowmind_pre_runner_session_lookup_count": diag.yellowmind_pre_runner_session_lookup_count or None,
        "yellowmind_pre_runner_session_lookup_ms": round(
            diag.yellowmind_pre_runner_session_lookup_ms, 1
        ) or None,
        "pre_model_append_event_count": diag.pre_model_append_event_count or None,
        "pre_model_append_event_ms": round(diag.pre_model_append_event_ms, 1) or None,
    }


def emit_runner_pre_model_log(
    trace: ConversationLatencyTrace,
    *,
    session_id: str,
    agent_name: str,
    llm_counts: Optional[Tuple[int, int, int, bool]] = None,
) -> None:
    """Emit the one-per-turn Runner pre-model summary. ``llm_counts`` carries
    ``(content_count, part_count, tool_count, system_instruction_present)``."""
    fields = build_runner_pre_model_fields(trace, session_id=session_id, agent_name=agent_name)
    if llm_counts is not None:
        content_count, part_count, tool_count, system_present = llm_counts
        fields["llm_content_count"] = content_count
        fields["llm_part_count"] = part_count
        fields["llm_tool_count"] = tool_count
        fields["system_instruction_present"] = system_present
    runtime_ms = fields.get("adk_runtime_pre_model_ms")
    level = 30 if runtime_ms is not None and runtime_ms >= SLOW_RUNNER_PRE_MODEL_MS else 20
    _emit(RUNNER_PRE_MODEL_EVENT, level, fields)
