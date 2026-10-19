"""Profile session operations and combine state reads without caching history.

The joined read is verified against ADK 2.11.0; other versions and custom
subclasses retain the SDK lookup. Session-only PostgreSQL writes combine the
same required row reads while retaining SDK locks, revision checks and commit.
"""

from __future__ import annotations

import time
from datetime import datetime, timezone
from importlib.metadata import version
from typing import Optional

from google.adk.events import Event
from google.adk.sessions import DatabaseSessionService
from google.adk.sessions import database_session_service as adk_database
from google.adk.sessions.session import Session
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncEngine

from src.smart_rag.infrastructure.monitoring.latency_diagnostics import (
    SessionLookupProfile,
    _current_session_lookup_profile,
    _register_sqlalchemy_listeners,
    attribute_lookup_to_trace,
    current_latency_diag_phase,
    emit_session_lookup_log,
    get_current_conversation_latency_trace,
)

_JOINED_READ_SUPPORTED = (version("google-adk") == "2.11.0"
                          and callable(getattr(adk_database, "_merge_state", None)))


class InstrumentedDatabaseSessionService(DatabaseSessionService):
    """``DatabaseSessionService`` with request-scoped lookup diagnostics."""

    def __init__(
        self,
        db_url: Optional[str] = None,
        db_engine: Optional[AsyncEngine] = None,
        **kwargs,
    ) -> None:
        """Mirror the ADK 2.8 constructor, including engine injection.

        Exactly one of ``db_url`` or ``db_engine`` must be provided; ADK
        validates this and raises ``ValueError`` otherwise. Passing the
        process-wide shared engine lets callers keep one pooled engine and a
        single warmed ``prepare_tables()`` instead of per-request engines.
        """
        super().__init__(db_url=db_url, db_engine=db_engine, **kwargs)
        _register_sqlalchemy_listeners(self, self.db_engine.sync_engine)

    async def prepare_tables(self) -> None:
        """Time the lazy schema/table preparation into the active profile.

        Matches the ADK public ``prepare_tables()`` API (private
        ``_prepare_tables`` before ADK 2.8.0).
        """
        trace = get_current_conversation_latency_trace()
        if trace is None:
            await super().prepare_tables()
            return
        profile = _current_session_lookup_profile.get()
        if profile is None:
            await super().prepare_tables()
            return
        profile.tables_already_created = bool(getattr(self, "_tables_created", False))
        start_ns = time.perf_counter_ns()
        try:
            await super().prepare_tables()
        finally:
            profile.prepare_tables_ms += max((time.perf_counter_ns() - start_ns) / 1_000_000, 0.0)

    async def get_session(self, **kwargs) -> Optional[Session]:
        trace = get_current_conversation_latency_trace()
        if trace is None:
            return await self._read_session(**kwargs)

        profile = SessionLookupProfile(
            lookup_sequence=trace.next_session_lookup_sequence(),
            phase=current_latency_diag_phase.get(),
        )
        token = _current_session_lookup_profile.set(profile)
        start_ns = time.perf_counter_ns()
        try:
            session = await self._read_session(**kwargs)
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

    async def _read_session(self, *, app_name, user_id, session_id, config=None):
        # Never bypass custom/fenced service behavior or silently assume a new
        # SDK's storage/revision semantics. Upgrade checklist covers this gate.
        if not _JOINED_READ_SUPPORTED or type(self) is not InstrumentedDatabaseSessionService:
            return await super().get_session(
                app_name=app_name, user_id=user_id, session_id=session_id, config=config,
            )
        await self.prepare_tables()
        schema = self._get_schema_classes()
        S, A, U, E = (schema.StorageSession, schema.StorageAppState,
                      schema.StorageUserState, schema.StorageEvent)
        async with self._rollback_on_exception_session(read_only=True) as db:
            row = (await db.execute(
                select(S, A, U)
                .outerjoin(A, A.app_name == S.app_name)
                .outerjoin(U, and_(U.app_name == S.app_name, U.user_id == S.user_id))
                .where(S.app_name == app_name, S.user_id == user_id, S.id == session_id)
            )).one_or_none()
            if row is None:
                return None
            stored, app, user = row
            events = []
            if config is None or config.num_recent_events != 0:
                stmt = select(E).where(
                    E.app_name == app_name, E.user_id == user_id, E.session_id == session_id,
                )
                if config and config.after_timestamp:
                    after = datetime.fromtimestamp(config.after_timestamp, tz=timezone.utc)
                    if self._uses_naive_datetime():
                        after = after.replace(tzinfo=None)
                    stmt = stmt.where(E.timestamp >= after)
                stmt = stmt.order_by(E.timestamp.desc(), E.id.desc())
                if config and config.num_recent_events is not None:
                    stmt = stmt.limit(config.num_recent_events)
                events = (await db.execute(stmt)).scalars().all()
            return stored.to_session(
                state=adk_database._merge_state(app.state if app else {}, user.state if user else {}, stored.state),
                events=[event.to_event() for event in reversed(events)],
            )

    async def append_event(self, session: Session, event: Event) -> Event:
        # Aggregate pre-model session writes; first model call boundary ends
        # the "pre-model" window so later tool-cycle appends stay uncounted.
        trace = get_current_conversation_latency_trace()
        instrumented = bool(
            trace is not None and trace.llm_request_start_perf_ns is None
        )
        if not instrumented:
            return await self._append_durable_event(session, event)
        start_ns = time.perf_counter_ns()
        try:
            return await self._append_durable_event(session, event)
        finally:
            trace.diagnostics.pre_model_append_event_count += 1
            trace.diagnostics.pre_model_append_event_ms += max(
                (time.perf_counter_ns() - start_ns) / 1_000_000, 0.0
            )

    def _can_join_write(self, session: Session, event: Event) -> bool:
        # Global deltas retain SDK multi-row locking. Marker-less sessions,
        # upgrades, other dialects and custom/fenced services also use the SDK.
        return (_JOINED_READ_SUPPORTED
                and type(self) is InstrumentedDatabaseSessionService
                and self.db_engine.dialect.name == "postgresql"
                and not event.partial and session._storage_update_marker is not None
                and not any(key.startswith(("app:", "user:")) for key in (event.actions.state_delta or {})))

    async def _append_durable_event(self, session: Session, event: Event) -> Event:
        if not self._can_join_write(session, event):
            return await super().append_event(session, event)

        await self.prepare_tables()
        self._apply_temp_state(session, event)
        event = self._trim_temp_delta_state(event)
        deltas = adk_database._session_util.extract_json_safe_state_delta(event.actions.state_delta or {})
        schema = self._get_schema_classes()
        S, A, U = schema.StorageSession, schema.StorageAppState, schema.StorageUserState
        async with self._with_session_lock(
            app_name=session.app_name, user_id=session.user_id, session_id=session.id,
        ):
            async with self._rollback_on_exception_session() as db:
                row = (await db.execute(
                    select(S, A, U)
                    .outerjoin(A, A.app_name == S.app_name)
                    .outerjoin(U, and_(U.app_name == S.app_name, U.user_id == S.user_id))
                    .where(S.app_name == session.app_name, S.user_id == session.user_id, S.id == session.id)
                    # Only the session row is locked for session-only writes,
                    # exactly as in ADK. Nullable global rows are still required.
                    .with_for_update(of=S)
                )).one_or_none()
                if row is None:
                    raise adk_database.SessionNotFoundError(f"Session {session.id} not found.")
                stored, app, user = row
                if app is None:
                    raise ValueError(f"App state missing for app_name={session.app_name!r}. "
                                     "Session state tables should be initialized by create_session.")
                if user is None:
                    raise ValueError(f"User state missing for app_name={session.app_name!r}, "
                                     f"user_id={session.user_id!r}. Session state tables should be "
                                     "initialized by create_session.")
                marker = stored.get_update_marker()
                if session._storage_update_marker != marker:
                    raise adk_database.StaleSessionError(adk_database._STALE_SESSION_ERROR_MESSAGE)
                session.last_update_time = stored.get_update_timestamp()
                session._storage_update_marker = marker
                if deltas["session"]:
                    stored.state.update(deltas["session"])
                update_time = datetime.fromtimestamp(event.timestamp, timezone.utc)
                if self._uses_naive_datetime():
                    update_time = update_time.replace(tzinfo=None)
                stored.update_time = update_time
                db.add(schema.StorageEvent.from_event(session, event))
                # Capture before commit, as in ADK: expired ORM attributes must
                # not trigger async lazy reads. Publish memory only after commit.
                last_update_time = stored.get_update_timestamp()
                marker = stored.get_update_marker()
                await db.commit()
                session.last_update_time = last_update_time
                session._storage_update_marker = marker
        return self._commit_event_to_session(session, event)
