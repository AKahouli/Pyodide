"""Extended unit tests for search tools module."""

from unittest.mock import MagicMock

import pytest

from src.smart_rag.tools.search.tools import (
    SearchResultProcessor,
    SearchToolADK,
    create_search_schema,
    get_attribute_mapping_info,
    get_transformed_ids_by_names,
    validate_search_parameters,
)


class TestSearchToolsHelpers:
    def test_get_transformed_ids_by_names_single_and_all(self):
        mapping = {"name": {"brain1": ["id1", "id2"], "brain2": ["id3"]}}
        assert get_transformed_ids_by_names(mapping, "brain1") == ["id1", "id2"]
        assert get_transformed_ids_by_names(mapping, ["brain1", "brain2"]) == ["id1", "id2", "id3"]
        assert sorted(get_transformed_ids_by_names(mapping)) == ["id1", "id2", "id3"]

    def test_create_search_schema(self):
        schema = create_search_schema(
            "search_docs",
            "Search",
            {"query": {"type": "string"}},
            ["query"],
        )
        assert schema["function"]["name"] == "search_docs"
        assert schema["function"]["strict"] is True

    def test_validate_search_parameters(self):
        schema = {"function": {"parameters": {"required": ["query"]}}}
        assert validate_search_parameters({"query": "x"}, schema) is True
        assert validate_search_parameters({}, schema) is False
        assert validate_search_parameters({"query": "x"}, {"function": {}}) is True

    def test_get_attribute_mapping_info(self):
        mapping = {"category": {"finance": ["d1"], "ops": ["d2", "d3"]}}
        info = get_attribute_mapping_info(mapping)
        assert info["total_attributes"] == 1
        assert info["total_ids"] == 3


class TestSearchResultProcessor:
    def test_deduplicate_by_id(self):
        results = [
            {"id": "1", "page_content": "a"},
            {"id": "1", "page_content": "dup"},
            {"page_content": "no-id"},
        ]
        deduped = SearchResultProcessor.deduplicate_by_id(results)
        assert len(deduped) == 2

    def test_format_search_response(self):
        response = SearchResultProcessor.format_search_response([{"id": "1"}], "q")
        assert response["query"] == "q"
        assert response["total_results"] == 1

    def test_extract_metadata_fields(self):
        results = [{"page_content": "text", "metadata": {"source": "a.pdf", "page": 1}}]
        extracted = SearchResultProcessor.extract_metadata_fields(results, ["source", "missing"])
        assert extracted[0]["metadata"] == {"source": "a.pdf"}


class TestSearchToolADK:
    def test_get_declaration_uses_custom_schema(self):
        async def search_fn(query: str):
            return query

        schema = create_search_schema(
            "search_docs",
            "Search documents",
            {"query": {"type": "string"}},
            ["query"],
        )
        tool = SearchToolADK(search_fn, schema)
        assert tool.custom_schema["name"] == "search_docs"
        assert tool.custom_schema["description"] == "Search documents"
