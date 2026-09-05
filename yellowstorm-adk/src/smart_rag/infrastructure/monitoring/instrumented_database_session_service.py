"""DatabaseSessionService wrapper that profiles session lookups (log only).

Observes ``get_session()`` externally — no upstream ADK implementation is
copied or forked — and classifies SQL durations by ADK table name through
SQLAlchemy event listeners. All behavior is identical to the parent service;
when no conversation latency trace is active the overrides are transparent
pass-throughs, so this is inert when the Admin latency toggle is off.
"""

from __future__ import annotations

import time
from typing import Optional

from google.adk.events import Event
from google.adk.sessions import DatabaseSessionService
from google.adk.sessions.session import Session

from src.smart_rag.infrastructure.monitoring.latency_diagnostics import (
    SessionLookupProfile,
    _current_session_lookup_profile,
    _register_sqlalchemy_listeners,
    attribute_lookup_to_trace,
    current_latency_diag_phase,
    emit_session_lookup_log,
    get_current_conversation_latency_trace,
)


class InstrumentedDatabaseSessionService(DatabaseSessionService):
    """``DatabaseSessionService`` with request-scoped lookup diagnostics."""

    def __init__(self, db_url: str, **kwargs) -> None:
        super().__init__(db_url, **kwargs)
        _register_sqlalchemy_listeners(self, self.db_engine.sync_engine)

    async def _prepare_tables(self) -> None:
        """Time the lazy schema/table preparation into the active profile.

        Named ``prepare_tables`` in log fields to match the diagnostic plan;
        ADK 2.3.0 exposes this phase as the private ``_prepare_tables``.
        """
        trace = get_current_conversation_latency_trace()
        if trace is None:
            await super()._prepare_tables()
            return
        profile = _current_session_lookup_profile.get()
        if profile is None:
            await super()._prepare_tables()
            return
        profile.tables_already_created = bool(getattr(self, "_tables_created", False))
        start_ns = time.perf_counter_ns()
        try:
            await super()._prepare_tables()
        finally:
            profile.prepare_tables_ms += max((time.perf_counter_ns() - start_ns) / 1_000_000, 0.0)

    async def get_session(self, **kwargs) -> Optional[Session]:
        trace = get_current_conversation_latency_trace()
        if trace is None:
            return await super().get_session(**kwargs)

        profile = SessionLookupProfile(
            lookup_sequence=trace.next_session_lookup_sequence(),
            phase=current_latency_diag_phase.get(),
        )
        token = _current_session_lookup_profile.set(profile)
        start_ns = time.perf_counter_ns()
        try:
            session = await super().get_session(**kwargs)
        finally:
            _current_session_lookup_profile.reset(token)
        total_ms = (time.perf_counter_ns() - start_ns) / 1_000_000

        event_count = len(getattr(session, "events", None) or [])
        state_key_count = len(getattr(session, "state", None) or {})
        emit_session_lookup_log(
            trace,
            profile,
            session_id=str(kwargs.get("session_id") or ""),
            total_ms=total_ms,
            session_found=session is not None,
            event_count=event_count,
            state_key_count=state_key_count,
        )
        attribute_lookup_to_trace(trace, profile, total_ms)
        return session

    async def append_event(self, session: Session, event: Event) -> Event:
        # Aggregate pre-model session writes; first model call boundary ends
        # the "pre-model" window so later tool-cycle appends stay uncounted.
        trace = get_current_conversation_latency_trace()
        instrumented = bool(
            trace is not None and trace.llm_request_start_perf_ns is None
        )
        if not instrumented:
            return await super().append_event(session, event)
        start_ns = time.perf_counter_ns()
        try:
            return await super().append_event(session, event)
        finally:
            trace.diagnostics.pre_model_append_event_count += 1
            trace.diagnostics.pre_model_append_event_ms += max(
                (time.perf_counter_ns() - start_ns) / 1_000_000, 0.0
            )
