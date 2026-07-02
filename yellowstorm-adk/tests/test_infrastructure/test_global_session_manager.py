"""Unit tests for GlobalSessionManager."""

from datetime import datetime, timedelta

import pytest

from src.smart_rag.infrastructure.session import global_session_manager as gsm_mod
from src.smart_rag.infrastructure.session.global_session_manager import GlobalSessionManager


@pytest.fixture(autouse=True)
def clear_session_cache():
    gsm_mod._session_cache.clear()
    gsm_mod._cache_timestamps.clear()
    yield
    gsm_mod._session_cache.clear()
    gsm_mod._cache_timestamps.clear()


class TestGlobalSessionManager:
    @pytest.mark.asyncio
    async def test_add_citation_assigns_sequential_numbers(self):
        manager = await GlobalSessionManager.create("sess-1")
        n1 = await manager.add_citation("tag-1", {"title": "a"})
        n2 = await manager.add_citation("tag-2", {"title": "b"})
        assert n1 == 1
        assert n2 == 2

    @pytest.mark.asyncio
    async def test_add_citation_idempotent_for_same_tag(self):
        manager = await GlobalSessionManager.create("sess-2")
        first = await manager.add_citation("same-tag", {"title": "a"})
        second = await manager.add_citation("same-tag", {"title": "b"})
        assert first == second
        assert manager.next_citation_number == 2

    @pytest.mark.asyncio
    async def test_load_state_restores_from_cache(self):
        gsm_mod._session_cache["sess-3"] = {
            "next_citation_number": 5,
            "citation_mapping": {"t": 4},
            "sources": {4: {"x": 1}},
        }
        gsm_mod._cache_timestamps["sess-3"] = datetime.now()
        manager = await GlobalSessionManager.create("sess-3")
        assert manager.next_citation_number == 5
        assert manager.get_citation_number("t") == 4

    def test_get_next_task_order_increments(self):
        manager = GlobalSessionManager("sess-4")
        assert manager.get_next_task_order() == 1
        assert manager.get_next_task_order() == 2

    @pytest.mark.asyncio
    async def test_reset_citations_clears_state(self):
        manager = await GlobalSessionManager.create("sess-5")
        await manager.add_citation("tag", {"k": "v"})
        await manager.reset_citations()
        assert manager.next_citation_number == 1
        assert manager.citation_mapping == {}

    @pytest.mark.asyncio
    async def test_get_cited_sources_summary(self):
        manager = await GlobalSessionManager.create("sess-6")
        await manager.add_citation("tag", {"title": "doc"})
        summary = manager.get_cited_sources_summary()
        assert summary[0]["number"] == 1
        assert summary[0]["title"] == "doc"

    @pytest.mark.asyncio
    async def test_clear_session_from_cache(self):
        manager = await GlobalSessionManager.create("sess-7")
        await manager.add_citation("tag", {"title": "x"})
        await manager.clear_session_from_cache()
        assert "sess-7" not in gsm_mod._session_cache

    def test_get_cache_stats_counts_active_sessions(self):
        gsm_mod._session_cache["active"] = {}
        gsm_mod._cache_timestamps["active"] = datetime.now()
        gsm_mod._session_cache["expired"] = {}
        gsm_mod._cache_timestamps["expired"] = datetime.now() - timedelta(hours=30)
        stats = GlobalSessionManager.get_cache_stats()
        assert stats["total_cached_sessions"] == 2
        assert stats["active_sessions"] == 1

    def test_get_session_stats(self):
        manager = GlobalSessionManager("sess-8")
        stats = manager.get_session_stats()
        assert stats["session_id"] == "sess-8"
        assert stats["next_task_order"] == 1
