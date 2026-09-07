"""Phase-1 shared session-service provider tests.

One warmed ``InstrumentedDatabaseSessionService`` per process, built on the
shared engine with ``prepare_tables()`` paid once. Covers singleton
concurrency, reuse, shutdown/reset, ContextVar isolation, and listener
single-registration (plan sections 6, 9, 13).
"""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy.ext.asyncio import create_async_engine

import src.smart_rag.infrastructure.session.manager as manager_mod
from src.smart_rag.infrastructure.session.manager import (
    dispose_shared_database_session_service,
    dispose_shared_engine,
    get_shared_database_session_service,
)
from src.smart_rag.infrastructure.monitoring.latency_diagnostics import (
    SessionLookupProfile,
    _current_session_lookup_profile,
)

INSTRUMENTED_SERVICE_PATH = (
    "src.smart_rag.infrastructure.monitoring."
    "instrumented_database_session_service.InstrumentedDatabaseSessionService"
)


@pytest.fixture(autouse=True)
def reset_shared_state():
    manager_mod._shared_engine = None
    manager_mod._shared_session_service = None
    yield
    manager_mod._shared_engine = None
    manager_mod._shared_session_service = None


def _mock_provider_deps(engine):
    """Patch engine + service construction; return (engine_spy, built, cls).

    ``built`` collects one fresh mock service per construction call so
    re-initialization tests can distinguish instances.
    """
    engine_spy = AsyncMock(return_value=engine)
    built = []

    def _build_service(**kwargs):
        service = MagicMock()
        service.db_engine = engine
        service.prepare_tables = AsyncMock()
        service.close = AsyncMock()
        built.append(service)
        return service

    service_cls = MagicMock(side_effect=_build_service)
    return engine_spy, built, service_cls


class TestSingletonProvider:
    @pytest.mark.asyncio
    async def test_concurrent_acquisition_returns_one_warmed_service(self):
        """20 concurrent acquisitions: one service, one construction, one
        prepare_tables, one engine acquisition."""
        engine = MagicMock()
        engine_spy, built, service_cls = _mock_provider_deps(engine)

        with patch.object(manager_mod, "get_shared_engine", new=engine_spy), patch(
            INSTRUMENTED_SERVICE_PATH, service_cls
        ):
            services = await asyncio.gather(
                *[get_shared_database_session_service() for _ in range(20)]
            )

        assert len(built) == 1
        assert all(s is built[0] for s in services)
        assert service_cls.call_args.kwargs["db_engine"] is engine
        built[0].prepare_tables.assert_awaited_once()
        engine_spy.assert_awaited_once()
        assert manager_mod._shared_session_service is built[0]

    @pytest.mark.asyncio
    async def test_sequential_acquisition_reuses_service_and_engine(self):
        engine = MagicMock()
        engine_spy, built, service_cls = _mock_provider_deps(engine)

        with patch.object(manager_mod, "get_shared_engine", new=engine_spy), patch(
            INSTRUMENTED_SERVICE_PATH, service_cls
        ):
            first = await get_shared_database_session_service()
            second = await get_shared_database_session_service()

        assert first is second
        assert first.db_engine is engine
        # Fast path must not even reach the engine helper on reuse.
        assert engine_spy.await_count == 1
        first.prepare_tables.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_prepare_tables_runs_before_service_is_published(self):
        engine = MagicMock()
        engine_spy, built, service_cls = _mock_provider_deps(engine)
        published_during_construction = []

        original_build = service_cls.side_effect

        def _recording_build(**kwargs):
            published_during_construction.append(manager_mod._shared_session_service)
            return original_build(**kwargs)

        service_cls.side_effect = _recording_build

        with patch.object(manager_mod, "get_shared_engine", new=engine_spy), patch(
            INSTRUMENTED_SERVICE_PATH, service_cls
        ):
            await get_shared_database_session_service()

        # A failure between construction and warmup must not publish a cold
        # service: the global stays None until prepare_tables succeeded.
        assert published_during_construction == [None]
        assert manager_mod._shared_session_service is built[0]


class TestRealServiceWarmup:
    @pytest.mark.asyncio
    async def test_real_service_on_shared_engine_prepares_tables_once(self):
        """Real ADK service + sqlite: warm provider, then re-acquisition is
        the same instance and the shared engine keeps one listener
        registration."""
        engine = create_async_engine("sqlite+aiosqlite://")
        try:
            with patch.object(
                manager_mod, "get_shared_engine", new=AsyncMock(return_value=engine)
            ):
                service = await get_shared_database_session_service()
                assert service.db_engine is engine
                assert service._owns_db_engine is False
                assert service._tables_created is True

                # Re-acquisition is the same warmed instance.
                again = await get_shared_database_session_service()
                assert again is service

                assert getattr(
                    engine.sync_engine,
                    "_yellowmind_latency_listeners_registered",
                    False,
                )
        finally:
            await engine.dispose()


class TestShutdownReset:
    @pytest.mark.asyncio
    async def test_dispose_clears_service_and_reinitializes_cleanly(self):
        engine = MagicMock()
        engine_spy, built, service_cls = _mock_provider_deps(engine)

        with patch.object(manager_mod, "get_shared_engine", new=engine_spy), patch(
            INSTRUMENTED_SERVICE_PATH, service_cls
        ):
            first = await get_shared_database_session_service()
            await dispose_shared_database_session_service()
            assert manager_mod._shared_session_service is None
            built[0].close.assert_awaited_once()

            second = await get_shared_database_session_service()

        assert second is not first
        assert service_cls.call_count == 2

    @pytest.mark.asyncio
    async def test_service_close_does_not_dispose_shared_engine(self):
        """The injected-engine contract: close() releases no engine
        resources; only dispose_shared_engine() touches the engine."""
        engine = MagicMock()
        engine.dispose = AsyncMock()
        manager_mod._shared_engine = engine
        engine_spy, built, service_cls = _mock_provider_deps(engine)

        with patch.object(manager_mod, "get_shared_engine", new=engine_spy), patch(
            INSTRUMENTED_SERVICE_PATH, service_cls
        ):
            await get_shared_database_session_service()
            await dispose_shared_database_session_service()

        engine.dispose.assert_not_awaited()

        await dispose_shared_engine()
        engine.dispose.assert_awaited_once()
        assert manager_mod._shared_engine is None


class TestContextVarIsolation:
    @pytest.mark.asyncio
    async def test_profiles_do_not_mix_across_lookups(self):
        """Each get_session accumulates only into its own active profile;
        counts freeze once the profile ContextVar is reset."""
        engine = create_async_engine("sqlite+aiosqlite://")
        try:
            with patch.object(
                manager_mod, "get_shared_engine", new=AsyncMock(return_value=engine)
            ):
                service = await get_shared_database_session_service()

            async def _lookup_with_own_profile(session_id):
                profile = SessionLookupProfile(
                    lookup_sequence=1, phase="yellowmind_pre_runner"
                )
                token = _current_session_lookup_profile.set(profile)
                try:
                    await service.get_session(
                        app_name="manager_app",
                        user_id="user-1",
                        session_id=session_id,
                    )
                finally:
                    _current_session_lookup_profile.reset(token)
                return profile

            first, second = await asyncio.gather(
                _lookup_with_own_profile("sess-a"),
                _lookup_with_own_profile("sess-b"),
            )

            assert first is not second
            assert first.sql_query_count > 0
            assert second.sql_query_count > 0

            frozen_first_count = first.sql_query_count
            frozen_first_total = first.sql_total_ms
            await _lookup_with_own_profile("sess-a")

            # The completed request's profile must not absorb later requests'
            # SQL work — request diagnostics stay isolated.
            assert first.sql_query_count == frozen_first_count
            assert first.sql_total_ms == frozen_first_total
        finally:
            await engine.dispose()
