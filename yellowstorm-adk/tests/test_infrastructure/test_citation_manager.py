"""Unit tests for SessionCitationManager and registry helpers."""

import pytest

from src.smart_rag.infrastructure.session import citation_manager as cm_mod
from src.smart_rag.infrastructure.session.citation_manager import (
    SessionCitationManager,
    clear_all_citation_managers,
    clone_citation_manager_state,
    get_citation_manager,
    get_citation_registry_stats,
    remove_citation_manager,
)


@pytest.fixture(autouse=True)
async def reset_citation_registry():
    await clear_all_citation_managers()
    yield
    await clear_all_citation_managers()


@pytest.fixture
def mock_db_pool(monkeypatch):
    async def fake_get_engine():
        return object()

    monkeypatch.setattr(SessionCitationManager, "_get_engine", staticmethod(fake_get_engine))


class TestSessionCitationManager:
    @pytest.mark.asyncio
    async def test_register_source_returns_numeric_citation(self, mock_db_pool):
        manager = await SessionCitationManager.create("sess-a")
        number = await manager.register_source("tag-1", {"title": "doc"})
        assert number == 1
        assert await manager.register_source("tag-1", {"title": "doc"}) == 1

    @pytest.mark.asyncio
    async def test_cite_text_source_returns_bracket_format(self, mock_db_pool):
        manager = await SessionCitationManager.create("sess-b")
        citation = await manager.cite_text_source({"content": {"text": "hello"}})
        assert citation == "[1]"

    @pytest.mark.asyncio
    async def test_cite_image_source_includes_task_order(self, mock_db_pool):
        manager = await SessionCitationManager.create("sess-c")
        citation = await manager.cite_image_source(2, "/tmp/image.png")
        assert citation == "[1]"

    @pytest.mark.asyncio
    async def test_get_cited_sources_returns_reference(self, mock_db_pool):
        manager = await SessionCitationManager.create("sess-d")
        await manager.register_source("tag", {"title": "source"})
        sources = await manager.get_cited_sources()
        assert sources[0]["title"] == "source"
        assert sources[0]["reference"] == "[1]"

    @pytest.mark.asyncio
    async def test_process_search_results_registers_text_sources(self, mock_db_pool):
        manager = await SessionCitationManager.create("sess-e")
        await manager.process_search_results(
            [{"page_content": "chunk", "metadata": {"page": 1}}],
            task_order=1,
            source_type="text",
        )
        cited = await manager.get_cited_sources()
        assert len(cited) == 1
        assert cited[0]["type"] == "text"


class TestCitationRegistry:
    @pytest.mark.asyncio
    async def test_get_citation_manager_reuses_cached_instance(self, mock_db_pool):
        first = await get_citation_manager("shared")
        second = await get_citation_manager("shared")
        assert first is second

    @pytest.mark.asyncio
    async def test_remove_citation_manager_evicts_cache(self, mock_db_pool):
        await get_citation_manager("to-remove")
        await remove_citation_manager("to-remove")
        stats = get_citation_registry_stats()
        assert "to-remove" not in stats["session_ids"]

    @pytest.mark.asyncio
    async def test_clone_citation_manager_state_copies_numbers(self, mock_db_pool):
        source = await get_citation_manager("source-sess")
        await source.register_source("tag", {"title": "shared"})
        cloned = await clone_citation_manager_state("source-sess", "target-sess")
        assert cloned.global_manager.next_citation_number == 2
        assert cloned.citation_cache["tag"] == 1

    @pytest.mark.asyncio
    async def test_clone_requires_non_empty_ids(self, mock_db_pool):
        with pytest.raises(ValueError, match="source_session_id"):
            await clone_citation_manager_state("", "target")
        with pytest.raises(ValueError, match="target_session_id"):
            await clone_citation_manager_state("source", "")

    @pytest.mark.asyncio
    async def test_clone_same_session_returns_existing(self, mock_db_pool):
        manager = await get_citation_manager("same")
        cloned = await clone_citation_manager_state("same", "same")
        assert cloned is manager
