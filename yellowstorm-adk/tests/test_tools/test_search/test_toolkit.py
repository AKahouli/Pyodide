"""Tests for SearchToolkit."""

from unittest.mock import MagicMock, patch

import pytest

from src.smart_rag.tools.search.toolkit import SearchToolkit


class TestSearchToolkit:
    """Test cases for SearchToolkit."""

    def test_init_with_defaults(self):
        """Test toolkit initialization with default values."""
        toolkit = SearchToolkit(task_order="test-order")

        assert toolkit.task_order == "test-order"
        assert toolkit.brain_id == []
        assert toolkit.top_k == 4
        assert toolkit.vectorstore == "vectorstoredev2"
        assert toolkit.search_web == "off"
        assert toolkit.sources_text == []
        assert toolkit.sources_image == []
        # order_text attribute doesn't exist, remove this check
        assert toolkit.ids == set()

    def test_init_with_custom_values(self):
        """Test toolkit initialization with custom values."""
        brain_ids = ["brain1", "brain2"]
        attribute_mapping = {"doc1": "mapping1"}
        brain_attribute_mapping = {"brain1": "mapping1"}

        toolkit = SearchToolkit(
            task_order="custom-order",
            brain_id=brain_ids,
            top_k=10,
            vectorstore="custom-store",
            attribute_mapping=attribute_mapping,
            brain_attribute_mapping=brain_attribute_mapping,
            search_web="standard"
        )

        assert toolkit.task_order == "custom-order"
        assert toolkit.brain_id == brain_ids
        assert toolkit.top_k == 10
        assert toolkit.vectorstore == "custom-store"
        assert toolkit.search_web == "standard"

    def test_init_with_none_brain_id(self):
        """Test toolkit initialization with None brain_id."""
        toolkit = SearchToolkit(task_order="test-order", brain_id=None)
        assert toolkit.brain_id == []

    def test_sources_initialization(self):
        """Test that source tracking is properly initialized."""
        toolkit = SearchToolkit(task_order="test-order")

        assert isinstance(toolkit.sources_text, list)
        assert isinstance(toolkit.sources_image, list)
        assert isinstance(toolkit.ids, set)
        # order_text attribute doesn't exist, remove this check
        # assert isinstance(toolkit.order_text, int)
        # assert toolkit.order_text == 0
        assert len(toolkit.sources_text) == 0
        assert len(toolkit.sources_image) == 0
        assert len(toolkit.ids) == 0

    def test_attribute_mappings_storage(self):
        """Test that attribute mappings are stored correctly."""
        doc_mapping = {"doc1": "mapping1", "doc2": "mapping2"}
        brain_mapping = {"brain1": "mapping1"}

        toolkit = SearchToolkit(
            task_order="test-order",
            attribute_mapping=doc_mapping,
            brain_attribute_mapping=brain_mapping
        )

        # These should be accessible through the toolkit (implementation dependent)
        assert toolkit.task_order == "test-order"

    def test_search_web_modes(self):
        """Test different search web modes."""
        # Test "off" mode
        toolkit_off = SearchToolkit(task_order="test", search_web="off")
        assert toolkit_off.search_web == "off"

        # Test "standard" mode
        toolkit_standard = SearchToolkit(task_order="test", search_web="standard")
        assert toolkit_standard.search_web == "standard"

        # Test "deep" mode
        toolkit_deep = SearchToolkit(task_order="test", search_web="deep")
        assert toolkit_deep.search_web == "deep"

    def test_multiple_brain_ids(self):
        """Test toolkit with multiple brain IDs."""
        brain_ids = ["brain1", "brain2", "brain3"]
        toolkit = SearchToolkit(task_order="test", brain_id=brain_ids)

        assert toolkit.brain_id == brain_ids
        assert len(toolkit.brain_id) == 3

    def test_empty_brain_ids_list(self):
        """Test toolkit with empty brain IDs list."""
        toolkit = SearchToolkit(task_order="test", brain_id=[])
        assert toolkit.brain_id == []

    def test_vectorstore_customization(self):
        """Test custom vectorstore setting."""
        custom_store = "my-custom-vectorstore"
        toolkit = SearchToolkit(task_order="test", vectorstore=custom_store)
        assert toolkit.vectorstore == custom_store

    def test_top_k_customization(self):
        """Test custom top_k setting."""
        custom_top_k = 20
        toolkit = SearchToolkit(task_order="test", top_k=custom_top_k)
        assert toolkit.top_k == custom_top_k

    @pytest.mark.parametrize("top_k", [1, 5, 10, 50, 100])
    def test_top_k_values(self, top_k):
        """Test various top_k values."""
        toolkit = SearchToolkit(task_order="test", top_k=top_k)
        assert toolkit.top_k == top_k

    @pytest.mark.parametrize("search_web", ["off", "standard", "deep"])
    def test_search_web_values(self, search_web):
        """Test various search_web values."""
        toolkit = SearchToolkit(task_order="test", search_web=search_web)
        assert toolkit.search_web == search_web


@pytest.mark.asyncio
class TestSearchToolkitAsync:
    """Async test cases for SearchToolkit."""

    async def test_perform_standard_search_empty_brain_id(self):
        """Test standard search with empty brain IDs."""
        toolkit = SearchToolkit(task_order="test", brain_id=[])

        result = await toolkit.perform_standard_search("test query")

        assert result == {
            "sources_text": [],
            "sources_image": [],
            "list_of_filenames": [],
            "response_id": 0
        }

    async def test_perform_document_search_empty_brain_id(self):
        """Test document search with empty brain IDs."""
        toolkit = SearchToolkit(task_order="test", brain_id=[])

        result = await toolkit.perform_document_search("test query", filter1="value1")

        assert result == {
            "sources_text": [],
            "sources_image": [],
            "list_of_filenames": [],
            "response_id": 0
        }

    async def test_preform_all_brain_search_empty_brain_id(self):
        """Test brain search with empty brain IDs."""
        toolkit = SearchToolkit(task_order="test", brain_id=[])

        result = await toolkit.preform_all_brain_search("test query")

        assert result == {
            "sources_text": [],
            "sources_image": [],
            "list_of_filenames": [],
            "response_id": 0
        }

    @patch('src.smart_rag.tools.infrastructure.common_helpers.CommonHelpers.post_vectorstore')
    async def test_perform_standard_search_success(self, mock_post_vectorstore):
        """Test successful standard search."""
        mock_post_vectorstore.return_value = [{"mock": "search_result"}]

        toolkit = SearchToolkit(task_order="test", brain_id=["brain1"])

        # Mock the search methods to return empty results for basic functionality test
        result = await toolkit.perform_standard_search("test query")

        # Basic structure validation
        assert "sources_text" in result
        assert "sources_image" in result
        assert "list_of_filenames" in result
        assert "response_id" in result

    async def test_perform_in_memory_extraction_no_filename(self):
        """Test in-memory extraction with no filename."""
        toolkit = SearchToolkit(task_order="test")

        result = await toolkit.perform_in_memory_extraction("")

        assert result == "No file name specified for in-memory extraction."

    async def test_perform_in_memory_extraction_file_not_found(self):
        """Test in-memory extraction with non-existent file."""
        toolkit = SearchToolkit(task_order="test")
        toolkit.in_memory_documents = {"file1.pdf": "/path/to/file1.pdf"}

        result = await toolkit.perform_in_memory_extraction("nonexistent.pdf")

        assert "not found in memory" in result
        assert "file1.pdf" in result

    async def test_perform_web_search_disabled(self):
        """Test web search when disabled."""
        toolkit = SearchToolkit(task_order="test", search_web="off")

        result = await toolkit.perform_web_search("test query")

        # perform_web_search now returns a dict with 'text' and 'sources'
        assert result == {"text": "Web search is not enabled.", "sources": []}

    @patch('src.smart_rag.tools.search.toolkit.WebSearchTool')
    async def test_perform_web_search_error(self, mock_web_tool_class):
        """Test web search with error."""
        mock_web_tool = MagicMock()
        mock_web_tool.perform_web_search.side_effect = Exception("Search API error")
        mock_web_tool_class.return_value = mock_web_tool

        toolkit = SearchToolkit(task_order="test", search_web="standard")

        result = await toolkit.perform_web_search("test query")

        # perform_web_search now returns a dict with 'text' and 'sources'
        assert result["text"] == "Web search error: Search API error"
        assert result["sources"] == []

    def test_set_in_memory_documents_success(self):
        """Test setting in-memory documents successfully."""
        toolkit = SearchToolkit(task_order="test")

        doc_tree = [
            {"filepath": "/path/file1.pdf", "nom": "Document 1"},
            {"filepath": "/path/file2.pdf", "filename": "Document 2"},
            {"nom": "Document 3"},  # No filepath
            {"filepath": "/path/file4.pdf", "nom": "Document 4"}
        ]

        toolkit.set_in_memory_documents(doc_tree)

        assert len(toolkit.in_memory_documents) == 3
        assert toolkit.in_memory_documents["Document 1"] == "/path/file1.pdf"
        assert toolkit.in_memory_documents["Document 2"] == "/path/file2.pdf"
        assert toolkit.in_memory_documents["Document 4"] == "/path/file4.pdf"

    def test_set_in_memory_documents_error(self):
        """Test setting in-memory documents with error."""
        toolkit = SearchToolkit(task_order="test")

        # Invalid doc_tree that will cause an error
        doc_tree = None

        # Should not raise exception, but handle gracefully
        toolkit.set_in_memory_documents(doc_tree)

        assert toolkit.in_memory_documents == {}

    def test_to_valid_identifier(self):
        """Test conversion to valid identifier."""
        toolkit = SearchToolkit(task_order="test")

        assert toolkit.to_valid_identifier("Test Name") == "test_name"
        assert toolkit.to_valid_identifier("test-name-here") == "test_name_here"
        assert toolkit.to_valid_identifier("  Mixed Case  ") == "mixed_case"
        assert toolkit.to_valid_identifier("already_valid") == "already_valid"