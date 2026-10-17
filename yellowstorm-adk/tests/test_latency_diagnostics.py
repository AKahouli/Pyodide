"""Tests for the log-only conversation latency diagnostics (session lookup +
runner pre-model). These must never touch protobuf/UI metrics and must gate
entirely on the request-scoped latency trace."""

import json
import logging

import pytest

from src.smart_rag.infrastructure.monitoring import latency_diagnostics as diag
from src.smart_rag.infrastructure.monitoring.conversation_latency import (
    ConversationLatencyTrace,
    start_conversation_latency_trace,
)
from src.smart_rag.infrastructure.monitoring.latency_diagnostics import (
    PHASE_GOOGLE_ADK_RUNNER,
    PHASE_OTHER,
    PHASE_YELLOWMIND_PRE_RUNNER,
    SessionLookupProfile,
    attribute_lookup_to_trace,
    build_runner_pre_model_fields,
    current_latency_diag_phase,
    emit_session_lookup_log,
    latency_diagnostics_enabled,
    reset_latency_diag_phase,
    set_latency_diag_phase,
)


def _make_trace() -> ConversationLatencyTrace:
    return ConversationLatencyTrace(
        request_id="req-1",
        assistant_message_id="msg-1",
        backend_received_epoch_ms=1000.0,
    )


class TestGating:
    def test_disabled_without_trace(self):
        token = current_latency_diag_phase.set(PHASE_OTHER)
        try:
            assert latency_diagnostics_enabled() is False
        finally:
            current_latency_diag_phase.reset(token)

    def test_enabled_with_trace(self):
        token = start_conversation_latency_trace("req-1", "msg-1", 1000.0)
        try:
            assert latency_diagnostics_enabled() is True
        finally:
            from src.smart_rag.infrastructure.monitoring.conversation_latency import (
                reset_conversation_latency_trace,
            )
            reset_conversation_latency_trace(token)


class TestPhaseAndSequence:
    def test_phase_set_and_reset(self):
        token = set_latency_diag_phase(PHASE_GOOGLE_ADK_RUNNER)
        try:
            assert current_latency_diag_phase.get() == PHASE_GOOGLE_ADK_RUNNER
        finally:
            reset_latency_diag_phase(token)
        assert current_latency_diag_phase.get() == PHASE_OTHER

    def test_lookup_sequence_increments_per_trace(self):
        trace = _make_trace()
        assert trace.next_session_lookup_sequence() == 1
        assert trace.next_session_lookup_sequence() == 2
        other = _make_trace()
        assert other.next_session_lookup_sequence() == 1


class TestLookupAttribution:
    def test_phases_aggregate_into_separate_buckets(self):
        trace = _make_trace()
        pre = SessionLookupProfile(lookup_sequence=1, phase=PHASE_YELLOWMIND_PRE_RUNNER)
        runner = SessionLookupProfile(lookup_sequence=2, phase=PHASE_GOOGLE_ADK_RUNNER)
        attribute_lookup_to_trace(trace, pre, 1300.0)
        attribute_lookup_to_trace(trace, runner, 800.0)
        assert trace.diagnostics.yellowmind_pre_runner_session_lookup_count == 1
        assert trace.diagnostics.yellowmind_pre_runner_session_lookup_ms == pytest.approx(1300.0)
        assert trace.diagnostics.runner_internal_session_lookup_count == 1
        assert trace.diagnostics.runner_internal_session_lookup_ms == pytest.approx(800.0)

    def test_unknown_phase_counts_as_yellowmind(self):
        trace = _make_trace()
        profile = SessionLookupProfile(lookup_sequence=1, phase=PHASE_OTHER)
        attribute_lookup_to_trace(trace, profile, 10.0)
        assert trace.diagnostics.yellowmind_pre_runner_session_lookup_count == 1
        assert trace.diagnostics.runner_internal_session_lookup_count == 0


class TestSessionLookupLog:
    def _capture(self, caplog, trace, profile, total_ms=1301.7, **kwargs):
        with caplog.at_level(logging.INFO, logger="conversation_latency_diag"):
            emit_session_lookup_log(trace, profile, session_id="conv-1", total_ms=total_ms,
                                    session_found=True, event_count=186, state_key_count=7,
                                    **kwargs)
        return caplog.records[-1]

    def test_event_contains_correlation_and_safe_counts(self, caplog):
        profile = SessionLookupProfile(lookup_sequence=1, phase=PHASE_YELLOWMIND_PRE_RUNNER)
        profile.sql_query_count = 4
        profile.sql_total_ms = 1178.3
        profile.events_sql_ms = 1152.4
        profile.prepare_tables_ms = 4.2
        profile.new_connection_count = 1
        profile.pool_checkout_count = 1
        record = self._capture(caplog, _make_trace(), profile)
        payload = json.loads(record.getMessage().split(" ", 1)[1])
        assert record.getMessage().startswith("conversation_latency_diag.session_lookup")
        assert payload["request_id"] == "req-1"
        assert payload["assistant_message_id"] == "msg-1"
        assert payload["lookup_sequence"] == 1
        assert payload["phase"] == PHASE_YELLOWMIND_PRE_RUNNER
        assert payload["event_count"] == 186
        assert payload["sql_query_count"] == 4
        assert payload["non_sql_overhead_ms"] >= 0

    def test_slow_lookup_logs_at_warning(self, caplog):
        profile = SessionLookupProfile(lookup_sequence=1, phase=PHASE_OTHER)
        record = self._capture(caplog, _make_trace(), profile, total_ms=900.0)
        assert record.levelno == logging.WARNING

    def test_fast_lookup_logs_at_info(self, caplog):
        profile = SessionLookupProfile(lookup_sequence=1, phase=PHASE_OTHER)
        record = self._capture(caplog, _make_trace(), profile, total_ms=12.0)
        assert record.levelno == logging.INFO

    def test_no_sensitive_payload_in_log_fields(self, caplog):
        profile = SessionLookupProfile(lookup_sequence=1, phase=PHASE_OTHER)
        record = self._capture(caplog, _make_trace(), profile)
        message = record.getMessage()
        for forbidden in ("SELECT", "INSERT", "postgresql://", "prompt", "sql="):
            assert forbidden.lower() not in message.lower().replace("sql_total_ms", "").replace(
                "session_row_sql_ms", ""
            ).replace("events_sql_ms", "").replace("app_state_sql_ms", "").replace(
                "user_state_sql_ms", ""
            ).replace("other_sql_ms", "").replace("prepare_tables_ms", "").replace(
                "non_sql_overhead_ms", ""
            )


class TestRunnerPreModelSummary:
    def _trace_with_milestones(self):
        trace = _make_trace()
        trace.note_session_id("conv-1")
        base = 1_000_000_000
        d = trace.diagnostics
        d.runner_iteration_start_perf_ns = base
        d.before_run_perf_ns = base + 5_000_000
        d.user_message_callback_start_perf_ns = base + 7_000_000
        d.user_message_callback_end_perf_ns = base + 20_000_000
        d.before_agent_perf_ns = base + 22_000_000
        d.before_model_perf_ns = base + 802_000_000
        d.clean_session_ms = 12.8
        d.image_processing_ms = 0.1
        d.agent_name = "testaga"
        d.runner_internal_session_lookup_count = 1
        d.runner_internal_session_lookup_ms = 603.2
        d.pre_model_append_event_count = 1
        d.pre_model_append_event_ms = 96.4
        trace.pre_provider.runner_invoked_perf_ns = base
        trace.llm_request_start_perf_ns = base + 883_000_000
        return trace

    def test_fields_are_derived_and_omitted_when_missing(self):
        trace = self._trace_with_milestones()
        fields = build_runner_pre_model_fields(trace, session_id="conv-1", agent_name="testaga")
        assert fields["agent_name"] == "testaga"
        assert fields["runner_to_before_run_ms"] == 5.0
        assert fields["user_message_callback_ms"] == 13.0
        assert fields["clean_session_ms"] == 12.8
        assert fields["before_agent_to_before_model_ms"] == 780.0
        assert fields["before_model_to_litellm_ms"] == 81.0
        assert fields["pre_model_session_lookup_count"] == 1
        assert fields["pre_model_append_event_ms"] == 96.4
        # Yellowmind-phase lookups never ran → absent, not zeroed.
        assert fields["yellowmind_pre_runner_session_lookup_count"] is None

    def test_missing_milestones_omitted_not_zeroed(self):
        trace = _make_trace()
        fields = build_runner_pre_model_fields(trace, session_id="conv-1", agent_name="a")
        assert fields["runner_to_before_run_ms"] is None
        assert fields["before_agent_to_before_model_ms"] is None

    def test_negative_intervals_omitted(self):
        trace = self._trace_with_milestones()
        trace.diagnostics.before_model_perf_ns = trace.llm_request_start_perf_ns + 1_000_000
        fields = build_runner_pre_model_fields(trace, session_id="conv-1", agent_name="a")
        assert fields["before_model_to_litellm_ms"] is None

    def test_emit_event_name_and_slow_level(self, caplog):
        trace = self._trace_with_milestones()
        with caplog.at_level(logging.INFO, logger="conversation_latency_diag"):
            diag.emit_runner_pre_model_log(
                trace, session_id="conv-1", agent_name="testaga",
                llm_counts=(9, 12, 0, True),
            )
        record = caplog.records[-1]
        assert record.getMessage().startswith("conversation_latency_diag.runner_pre_model")
        payload = json.loads(record.getMessage().split(" ", 1)[1])
        assert payload["llm_content_count"] == 9
        assert payload["llm_part_count"] == 12
        assert payload["llm_tool_count"] == 0
        assert payload["system_instruction_present"] is True
        assert record.levelno == logging.WARNING  # 883 ms >= 500 ms threshold


class TestStatementClassification:
    def test_known_adk_tables_are_classified(self):
        assert diag._classify_statement("SELECT * FROM app_states WHERE app_name = ?") == "app_state"
        assert diag._classify_statement("select state from user_states") == "user_state"
        assert diag._classify_statement("SELECT * FROM events WHERE session_id = ?") == "events"
        assert diag._classify_statement("SELECT * FROM sessions") == "session_row"
        assert diag._classify_statement("SELECT * FROM sessions LEFT JOIN app_states LEFT JOIN user_states") == "session_row"
        assert diag._classify_statement("CREATE TABLE alembic_version") == "metadata"
        assert diag._classify_statement("SELECT 1") == "other"


class TestInstrumentedServiceContract:
    def test_prepare_tables_override_tracks_adk_public_api(self):
        # ADK 2.8.0 renamed the private `_prepare_tables` to the public
        # `prepare_tables`. If the override drifts from the upstream name the
        # instrumentation silently stops recording `prepare_tables_ms`.
        from google.adk.sessions import DatabaseSessionService
        from src.smart_rag.infrastructure.monitoring.instrumented_database_session_service import (
            InstrumentedDatabaseSessionService,
        )

        assert "prepare_tables" in vars(InstrumentedDatabaseSessionService)
        assert "_prepare_tables" not in vars(DatabaseSessionService)

    @pytest.mark.asyncio
    async def test_constructor_accepts_injected_engine_and_validates_exclusivity(self):
        import pytest as _pytest
        from sqlalchemy.ext.asyncio import create_async_engine

        from src.smart_rag.infrastructure.monitoring.instrumented_database_session_service import (
            InstrumentedDatabaseSessionService,
        )

        engine = create_async_engine("sqlite+aiosqlite://")
        try:
            service = InstrumentedDatabaseSessionService(db_engine=engine)
            assert service.db_engine is engine
            assert service._owns_db_engine is False
            assert getattr(
                engine.sync_engine, "_yellowmind_latency_listeners_registered", False
            )

            with _pytest.raises(ValueError):
                InstrumentedDatabaseSessionService()
            with _pytest.raises(ValueError):
                InstrumentedDatabaseSessionService(
                    db_url="sqlite+aiosqlite://", db_engine=engine
                )
        finally:
            await engine.dispose()


@pytest.mark.asyncio
@pytest.mark.parametrize("config", [None, {"num_recent_events": 0}, {"num_recent_events": 2},
                                     {"after_timestamp": 101}, {"after_timestamp": 101, "num_recent_events": 1}])
async def test_joined_read_matches_sdk_history_state_and_revision(config):
    from google.adk.events import Event
    from google.adk.sessions import DatabaseSessionService
    from google.adk.sessions.base_session_service import GetSessionConfig
    from google.genai import types
    from sqlalchemy.ext.asyncio import create_async_engine
    from src.smart_rag.infrastructure.monitoring.instrumented_database_session_service import InstrumentedDatabaseSessionService

    engine = create_async_engine("sqlite+aiosqlite://")
    try:
        sdk = DatabaseSessionService(db_engine=engine)
        service = InstrumentedDatabaseSessionService(db_engine=engine)
        session = await sdk.create_session(app_name="app", user_id="owner", session_id="same",
                                          state={"app:shared": 1, "user:private": 2, "local": 3})
        for event_id, timestamp in [("b", 100), ("a", 100), ("c", 101)]:
            await sdk.append_event(session, Event(id=event_id, author="user", timestamp=timestamp,
                content=types.Content(role="user", parts=[types.Part(text=event_id)])))
        await sdk.create_session(app_name="other", user_id="owner", session_id="same", state={"app:shared": "wrong"})
        await sdk.create_session(app_name="app", user_id="other", session_id="same", state={"user:private": "wrong"})
        config = GetSessionConfig(**config) if config else None
        expected = await sdk.get_session(app_name="app", user_id="owner", session_id="same", config=config)
        await service.prepare_tables()
        profile = SessionLookupProfile()
        token = diag._current_session_lookup_profile.set(profile)
        try:
            actual = await service.get_session(app_name="app", user_id="owner", session_id="same", config=config)
        finally:
            diag._current_session_lookup_profile.reset(token)
        assert actual.model_dump() == expected.model_dump()
        assert actual._storage_update_marker == expected._storage_update_marker
        assert actual.state == {"app:shared": 1, "user:private": 2, "local": 3}
        assert profile.sql_query_count == (1 if config and config.num_recent_events == 0 else 2)
        assert await service.get_session(app_name="app", user_id="missing", session_id="same") is None
        assert await service.get_session(app_name="missing", user_id="owner", session_id="same") is None
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_joined_read_missing_global_state_matches_sdk():
    from google.adk.sessions import DatabaseSessionService
    from sqlalchemy import delete
    from sqlalchemy.ext.asyncio import create_async_engine
    from src.smart_rag.infrastructure.monitoring.instrumented_database_session_service import InstrumentedDatabaseSessionService
    engine = create_async_engine("sqlite+aiosqlite://")
    try:
        sdk = DatabaseSessionService(db_engine=engine)
        service = InstrumentedDatabaseSessionService(db_engine=engine)
        await sdk.create_session(app_name="app", user_id="owner", session_id="id", state={"local": 1})
        schema = sdk._get_schema_classes()
        async with sdk._rollback_on_exception_session() as db:
            await db.execute(delete(schema.StorageUserState))
            await db.execute(delete(schema.StorageAppState))
            await db.commit()
        actual = await service.get_session(app_name="app", user_id="owner", session_id="id")
        expected = await sdk.get_session(app_name="app", user_id="owner", session_id="id")
        assert actual.model_dump() == expected.model_dump()
        assert actual._storage_update_marker == expected._storage_update_marker
    finally:
        await engine.dispose()


@pytest.mark.asyncio
@pytest.mark.parametrize("fallback", ["custom", "version"])
async def test_joined_read_falls_back_to_public_sdk(monkeypatch, fallback):
    from unittest.mock import AsyncMock
    from google.adk.sessions import DatabaseSessionService
    from sqlalchemy.ext.asyncio import create_async_engine
    from src.smart_rag.infrastructure.monitoring import instrumented_database_session_service as module
    class CustomService(module.InstrumentedDatabaseSessionService):
        pass
    engine = create_async_engine("sqlite+aiosqlite://")
    try:
        if fallback == "version":
            monkeypatch.setattr(module, "_JOINED_READ_SUPPORTED", False)
        service = (CustomService if fallback == "custom" else module.InstrumentedDatabaseSessionService)(db_engine=engine)
        original = AsyncMock(return_value=None)
        monkeypatch.setattr(DatabaseSessionService, "get_session", original)
        assert await service.get_session(app_name="app", user_id="owner", session_id="id") is None
        original.assert_awaited_once_with(app_name="app", user_id="owner", session_id="id", config=None)
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_joined_session_keeps_durable_scoped_writes_stale_rejection_and_rollback():
    from google.adk.events import Event, EventActions
    from google.genai import types
    from sqlalchemy import event
    from sqlalchemy.ext.asyncio import create_async_engine
    from src.smart_rag.infrastructure.monitoring.instrumented_database_session_service import InstrumentedDatabaseSessionService
    engine = create_async_engine("sqlite+aiosqlite://")
    service = InstrumentedDatabaseSessionService(db_engine=engine)
    try:
        await service.create_session(app_name="app", user_id="owner", session_id="id")
        kwargs = dict(app_name="app", user_id="owner", session_id="id")
        current = await service.get_session(**kwargs)
        stale = await service.get_session(**kwargs)
        def message(event_id, state):
            return Event(id=event_id, author="user", actions=EventActions(state_delta=state),
                         content=types.Content(role="user", parts=[types.Part(text=event_id)]))
        await service.append_event(current, message("durable", {"app:a": 1, "user:u": 2, "s": 3}))
        persisted = await service.get_session(**kwargs)
        assert [e.id for e in persisted.events] == ["durable"]
        assert persisted.state == {"app:a": 1, "user:u": 2, "s": 3}
        with pytest.raises(ValueError, match="[Ss]tale|last_update_time|storage"):
            await service.append_event(stale, message("stale", {"s": "wrong"}))
        def fail_insert(conn, cursor, statement, parameters, context, executemany):
            if statement.lstrip().upper().startswith("INSERT INTO EVENTS"):
                raise RuntimeError("simulated event insert failure")
        event.listen(engine.sync_engine, "before_cursor_execute", fail_insert)
        try:
            with pytest.raises(RuntimeError, match="simulated"):
                await service.append_event(persisted, message("rollback", {"app:a": 4, "user:u": 5, "s": 6}))
        finally:
            event.remove(engine.sync_engine, "before_cursor_execute", fail_insert)
        reloaded = await service.get_session(**kwargs)
        assert reloaded.state == {"app:a": 1, "user:u": 2, "s": 3}
        assert [e.id for e in reloaded.events] == ["durable"]
        assert reloaded._storage_update_marker == current._storage_update_marker
    finally:
        await engine.dispose()

@pytest.mark.asyncio
async def test_listener_registration_is_idempotent_per_engine():
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import create_async_engine

    from src.smart_rag.infrastructure.monitoring.instrumented_database_session_service import (
        InstrumentedDatabaseSessionService,
    )
    from src.smart_rag.infrastructure.monitoring.latency_diagnostics import (
        SessionLookupProfile,
        _current_session_lookup_profile,
    )

    engine = create_async_engine("sqlite+aiosqlite://")
    try:
        # Second construction on the same engine must not duplicate
        # listeners (shared-engine deployments construct once, tests and
        # hot reload may construct more).
        InstrumentedDatabaseSessionService(db_engine=engine)
        InstrumentedDatabaseSessionService(db_engine=engine)

        profile = SessionLookupProfile()
        token = _current_session_lookup_profile.set(profile)
        try:
            async with engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
        finally:
            _current_session_lookup_profile.reset(token)

        assert profile.sql_query_count == 1
    finally:
        await engine.dispose()
