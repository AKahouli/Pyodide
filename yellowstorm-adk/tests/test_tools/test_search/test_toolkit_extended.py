"""Extended unit tests for SearchToolkit coverage."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.smart_rag.tools.search.toolkit import SearchToolkit, create_search_toolkit


def _sample_text_item(page_content="Revenue grew", source="report.pdf", page=1):
    document_data = {
        "page_content": page_content,
        "metadata": {"source": source, "page": page, "id": "doc-1"},
    }
    return (document_data, 0.9)


@pytest.fixture
def toolkit():
    return SearchToolkit(task_order="1", workspace_name=["ws-1"], user_id="user-1")


class TestSearchToolkitUtilities:
    def test_split_multi_page_content(self, toolkit):
        content = "<page number=1>First</page><page number=2>Second</page>"
        pages = toolkit.split_multi_page_content(content)
        assert len(pages) == 2
        assert pages[0]["page_number"] == 1
        assert pages[1]["page_number"] == 2

    def test_split_multi_page_content_no_markers(self, toolkit):
        assert toolkit.split_multi_page_content("plain text") == []

    def test_resolve_search_file_names_skips_unresolved_ids(self, toolkit):
        doc_id = "6a3153efd7d4c01f4ab2e4f6"
        resolved = toolkit._resolve_search_file_names([doc_id, "known.pdf"])
        assert resolved == ["known.pdf"]

    def test_get_search_stats_and_reset(self, toolkit):
        toolkit.sources_text.append({"reference": "[1]"})
        toolkit.ids.add("x")
        stats = toolkit.get_search_stats()
        assert stats["total_text_sources"] == 1
        assert stats["tracked_ids_count"] == 1
        toolkit.reset_search_state()
        assert toolkit.sources_text == []
        assert toolkit.ids == set()

    def test_clear_in_memory_documents(self, toolkit):
        toolkit.in_memory_documents = {"a": "/path/a"}
        toolkit.clear_in_memory_documents()
        assert toolkit.in_memory_documents == {}

    def test_create_search_toolkit_factory(self):
        tk = create_search_toolkit("2", brain_id=["b1"], top_k=8, user_id="u1")
        assert tk.workspace_name == ["b1"]
        assert tk.top_k == 8
        assert tk.user_id == "u1"

    def test_init_with_citation_manager(self):
        manager = MagicMock()
        tk = SearchToolkit(task_order="1", citation_manager=manager)
        assert tk.citation_manager is manager


class TestSearchToolkitFunctionGeneration:
    @pytest.mark.asyncio
    async def test_generate_search_function_with_filters(self, toolkit):
        toolkit.attribute_mapping = {"category": ["finance", "ops", "finance"]}
        schema = {
            "name": "search_docs",
            "description": "Search documents",
            "parameters": {
                "properties": {
                    "query": {"description": "query"},
                    "category": {"items": {"enum": ["finance", "ops"]}},
                },
                "required": ["query", "category"],
            },
        }

        async def retrieve_fn(query, **filters):
            return {"query": query, "filters": filters}

        wrapper, openai_fn = toolkit.generate_search_function(schema, retrieve_fn)
        result = await wrapper("revenue", category=["finance", "invalid"])
        assert result["query"] == "revenue"
        assert result["filters"]["category"] == ["finance"]
        assert openai_fn["function"]["name"] == "search_docs"

    @pytest.mark.asyncio
    async def test_generate_generic_function(self, toolkit):
        schema = {
            "name": "extract_file",
            "description": "Extract file",
            "parameters": {
                "properties": {
                    "file_name": {"type": "string", "description": "name"},
                },
                "required": ["file_name"],
            },
        }

        async def retrieve_fn(**kwargs):
            return kwargs

        wrapper, openai_fn = toolkit.generate_generic_function(schema, retrieve_fn)
        result = await wrapper(file_name="notes.pdf")
        assert result == {"file_name": "notes.pdf"}
        assert openai_fn["function"]["parameters"]["required"] == ["file_name"]

    def test_generate_function_routes_to_search(self, toolkit):
        schema = {"name": "search_docs", "parameters": {"properties": {"query": {}}}}

        async def retrieve_fn(query, **kwargs):
            return query

        wrapper, openai_fn = toolkit.generate_function(schema, retrieve_fn)
        assert callable(wrapper)
        assert openai_fn["function"]["name"] == "search_docs"


@pytest.mark.asyncio
class TestSearchToolkitProcessing:
    async def test_process_single_page_with_citation_manager(self, toolkit):
        text_obj = {"content": {"source": "report.pdf", "page": 1, "text": "Revenue grew"}}
        toolkit.common_helpers.create_text_object = MagicMock(return_value=text_obj)
        manager = AsyncMock()
        manager.cite_text_source.return_value = "[1]"
        toolkit.citation_manager = manager
        response = []
        await toolkit._process_single_page(_sample_text_item(), response)
        assert len(response) == 1
        assert response[0]["source_reference"] == "[1]"

    async def test_process_single_page_reuses_existing_reference(self, toolkit):
        text_obj = {"content": {"source": "report.pdf", "page": 1, "text": "Revenue grew"}}
        toolkit.common_helpers.create_text_object = MagicMock(return_value=text_obj)
        toolkit.sources_text.append({"reference": "[9]", "object": text_obj})
        response = []
        await toolkit._process_single_page(_sample_text_item(), response)
        assert response[0]["source_reference"] == "[9]"

    async def test_process_individual_page_tracks_page_map(self, toolkit):
        response = []
        document_data, _ = _sample_text_item("<page number=2>Page two</page>")
        await toolkit._process_individual_page(
            document_data, 2, "<page number=2>Page two</page>", response
        )
        assert len(response) == 1
        assert toolkit.page_reference_map

    async def test_cite_fallback_counters(self, toolkit):
        ref1 = await toolkit._cite_text_source_fallback({}, 1)
        ref2 = await toolkit._cite_image_source_fallback(1, "img.png")
        assert ref1 == "[1]"
        assert ref2 == "[2]"

    @patch("src.smart_rag.tools.search.toolkit.detect_pattern_and_extract_args")
    async def test_perform_csrd_search_known_function(self, mock_detect, toolkit):
        mock_detect.return_value = ("semantic_search", {"query": "E1-29"})
        with patch(
            "src.smart_rag.tools.search.toolkit.semantic_search",
            return_value="CSRD context",
        ):
            result = await toolkit.perform_csrd_search("E1-29")
        assert "CSRD context" in result

    @patch("src.smart_rag.tools.search.toolkit.detect_pattern_and_extract_args")
    async def test_perform_csrd_search_unknown_function(self, mock_detect, toolkit):
        mock_detect.return_value = ("unknown_fn", {})
        result = await toolkit.perform_csrd_search("bad query")
        assert "Unable to process" in result

    async def test_perform_filtered_search_fallback_to_standard(self, toolkit):
        with patch.object(toolkit, "perform_standard_search", new_callable=AsyncMock) as mock_std:
            mock_std.return_value = {"sources_text": [], "sources_image": [], "list_of_filenames": [], "response_id": 0}
            result = await toolkit.perform_filtered_search("q", [])
        mock_std.assert_awaited_once()

    async def test_perform_web_search_success(self, toolkit):
        toolkit.search_web = "standard"
        toolkit.web_search_tool = MagicMock()
        toolkit.web_search_tool.perform_web_search = AsyncMock(
            return_value={"text": "results", "sources": [{"title": "x"}]}
        )
        result = await toolkit.perform_web_search("climate")
        assert result["text"] == "results"
        assert len(result["sources"]) == 1

    async def test_preform_all_brain_search_with_brain_filter(self, toolkit):
        toolkit.brain_attribute_mapping = {
            "name": {"Finance": ["brain-id-1"]},
            "documents": {"annual-report": ["doc-id-1"]},
        }
        with patch.object(toolkit, "perform_standard_search", new_callable=AsyncMock) as mock_std:
            mock_std.return_value = {
                "sources_text": [],
                "sources_image": [],
                "list_of_filenames": [],
                "response_id": 0,
            }
            await toolkit.preform_all_brain_search("revenue", brain_name="Finance", document_filter="annual-report")
        mock_std.assert_awaited_once()

    async def test_perform_standard_search_exception_returns_empty(self, toolkit):
        with patch.object(toolkit, "_search_text_documents", side_effect=RuntimeError("fail")):
            result = await toolkit.perform_standard_search("q")
        assert result["sources_text"] == []

    async def test_perform_document_search_with_filtered_ids(self, toolkit):
        toolkit.common_helpers.filter_ids = MagicMock(return_value=["doc-a"])
        toolkit.common_helpers.create_search_payload = MagicMock(return_value={"filter": {}})
        toolkit.common_helpers.post_vectorstore = AsyncMock(return_value=[])
        toolkit.common_helpers.create_text_object = MagicMock(return_value={"content": {"source": "s", "page": 1}})
        result = await toolkit.perform_document_search("q", category="finance", chunks=1)
        assert "sources_text" in result

    async def test_search_image_documents_processes_results(self, toolkit):
        payload = {"filter": {}}
        toolkit.common_helpers.create_search_payload = MagicMock(return_value=payload)
        toolkit.common_helpers.post_vectorstore = AsyncMock(
            return_value=[[{
                "metadata": {
                    "id": "img-1",
                    "image_path": "folder/chart.png",
                    "source": "chart.png",
                    "page": 1,
                }
            }, 0.8]]
        )
        toolkit.common_helpers.process_image_downloads = AsyncMock(return_value=(["/tmp/chart.png"], ["chart.png"]))
        toolkit.common_helpers.process_downloaded_images = AsyncMock(return_value=[("image/png", b"bytes")])
        toolkit.common_helpers.wrap_images = MagicMock(return_value=[{"mime": "image/png", "data": "abc"}])
        toolkit.common_helpers.create_image_object = MagicMock(return_value={"type": "image", "content": {}})
        result = await toolkit._search_image_documents("chart")
        assert "wrapped_images" in result
        assert len(result["image_references"]) == 1
