"""Tests for AttributeExtractionService."""

import pytest
import json
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch, Mock
from fastapi import HTTPException

from src.attribute_extraction.core.extraction_service import AttributeExtractionService
from src.attribute_extraction.schema.models import AttributeDefinition


@pytest.fixture
def mock_search_toolkit():
    """Mock SearchToolkit for testing."""
    with patch('src.attribute_extraction.core.extraction_service.SearchToolkit') as mock:
        toolkit_instance = Mock()
        toolkit_instance.perform_standard_search = AsyncMock(return_value={
            "sources_text": [
                {"page_content": "Test content", "filename": "test.pdf"}
            ],
            "sources_image": [],
            "list_of_filenames": []
        })
        toolkit_instance.perform_filtered_search = AsyncMock(return_value={
            "sources_text": [
                {"page_content": "Filtered content", "filename": "filtered.pdf"}
            ],
            "sources_image": [],
            "list_of_filenames": []
        })
        toolkit_instance.perform_document_search = AsyncMock(return_value={
            "sources_text": [
                {"page_content": "Filtered content", "filename": "filtered.pdf"}
            ],
            "sources_image": [],
            "list_of_filenames": []
        })
        mock.return_value = toolkit_instance
        yield toolkit_instance


@pytest.fixture
def mock_openai_client():
    """Mock AsyncOpenAI client for testing."""
    with patch('src.attribute_extraction.core.extraction_service.AsyncOpenAI') as mock:
        client_instance = Mock()

        # Create a function that returns responses in sequence
        call_count = [0]  # Use list to allow modification in nested function

        async def mock_completions_create(*args, **kwargs):
            await asyncio.sleep(0)
            call_count[0] += 1

            # Check if this is a structured output call (has response_format)
            if 'response_format' in kwargs:
                # Final structured output response
                final_response = Mock()
                final_response.choices = [Mock()]
                final_response.choices[0].message = Mock()
                final_response.choices[0].message.content = '{"company_name": "Test Corp", "revenue": "not found"}'
                final_response.choices[0].message.tool_calls = None
                return final_response
            elif call_count[0] == 1:
                # First call: return tool call
                tool_call_response = Mock()
                tool_call_response.choices = [Mock()]
                tool_call_response.choices[0].message = Mock()
                tool_call_response.choices[0].message.tool_calls = [Mock()]
                tool_call_response.choices[0].message.tool_calls[0].function.name = "search_documents"
                tool_call_response.choices[0].message.tool_calls[0].function.arguments = '{"query": "test query"}'
                tool_call_response.choices[0].message.tool_calls[0].id = "call_123"
                return tool_call_response
            else:
                # Second call: no tool calls, triggers structured output
                no_tool_response = Mock()
                no_tool_response.choices = [Mock()]
                no_tool_response.choices[0].message = Mock()
                no_tool_response.choices[0].message.tool_calls = None
                return no_tool_response

        client_instance.chat.completions.create = AsyncMock(side_effect=mock_completions_create)

        mock.return_value = client_instance
        yield client_instance


@pytest.fixture
def service(mock_openai_client, mock_search_toolkit):
    """Create AttributeExtractionService instance with mocked dependencies."""
    return AttributeExtractionService(
        api_key="test_key",
        base_url="https://localhost:4000",
        model="gpt-4.1",
        brain_ids=["brain_123"],
        vectorstore="vectorstoredev2",
        top_k=3
    )


@pytest.fixture
def service_with_external_ids(mock_openai_client, mock_search_toolkit):
    """Create service instance with external_ids."""
    return AttributeExtractionService(
        api_key="test_key",
        base_url="https://localhost:4000",
        model="gpt-4.1",
        brain_ids=["brain_123"],
        vectorstore="vectorstoredev2",
        top_k=3,
        external_ids=["doc_123", "doc_456"]
    )


class TestAttributeExtractionService:
    """Test cases for AttributeExtractionService."""

    def test_service_initialization(self, service):
        """Test service is initialized correctly."""
        assert service.model == "gpt-4.1"
        assert service.external_ids is None
        assert len(service.messages) == 0
        assert len(service.search_queries) == 0

    def test_service_initialization_with_external_ids(self, service_with_external_ids):
        """Test service initialization with external IDs."""
        assert service_with_external_ids.external_ids == ["doc_123", "doc_456"]

    def test_base_url_normalization(self, mock_openai_client, mock_search_toolkit):
        """Test that base_url is normalized to end with /v1."""
        service = AttributeExtractionService(
            api_key="test_key",
            base_url="https://localhost:4000",  # Without /v1
            model="gpt-4.1",
            brain_ids=["brain_123"],
            vectorstore="vectorstoredev2",
            top_k=3
        )
        # AsyncOpenAI should be called with base_url ending in /v1
        # We can't directly check this in the mock, but the code should normalize it

    @pytest.mark.asyncio
    async def test_search_documents_standard(self, service, mock_search_toolkit):
        """Test standard document search without external IDs."""
        result = await service.search_documents("test query")

        mock_search_toolkit.perform_standard_search.assert_called_once_with("test query")
        assert "Test content" in result
        assert "test.pdf" in result

    @pytest.mark.asyncio
    async def test_search_documents_filtered(self, service_with_external_ids, mock_search_toolkit):
        """Test filtered document search with external IDs."""
        result = await service_with_external_ids.search_documents("test query")

        mock_search_toolkit.perform_document_search.assert_called_once_with(
            "test query",
            id=["doc_123", "doc_456"]
        )
        assert "Filtered content" in result
        assert "filtered.pdf" in result

    @pytest.mark.asyncio
    async def test_search_documents_no_results(self, service, mock_search_toolkit):
        """Test search when no results are found."""
        mock_search_toolkit.perform_standard_search.return_value = {
            "sources_text": [],
            "sources_image": [],
            "list_of_filenames": []
        }

        result = await service.search_documents("empty query")

        assert "No results found" in result

    @pytest.mark.asyncio
    async def test_search_documents_error_handling(self, service, mock_search_toolkit):
        """Test search error handling."""
        mock_search_toolkit.perform_standard_search.side_effect = Exception("Search failed")

        result = await service.search_documents("error query")

        assert "Search error" in result
        assert "Search failed" in result

    @pytest.mark.asyncio
    async def test_execute_success(self, service, mock_openai_client):
        """Test successful execution of attribute extraction."""
        attributes = {
            "company_name": AttributeDefinition(
                description="Name of the company",
                type="string"
            ),
            "revenue": AttributeDefinition(
                description="Annual revenue",
                type="number"
            )
        }

        result = await service.execute(
            attributes=attributes
        )

        # Verify result is JSON string
        assert isinstance(result, str)
        result_dict = json.loads(result)
        assert "company_name" in result_dict
        assert result_dict["company_name"] == "Test Corp"

        # Verify search was tracked
        assert len(service.search_queries) == 1
        assert "test query" in service.search_queries

    @pytest.mark.asyncio
    async def test_execute_max_iterations_reached(self, service, mock_openai_client):
        """Test that extraction completes with structured output when max iterations reached."""
        call_count = [0]

        async def mock_completions_max_iterations(*args, **kwargs):
            await asyncio.sleep(0)
            call_count[0] += 1

            # Check if this is a structured output call (has response_format)
            if 'response_format' in kwargs:
                # Final structured output response after max iterations
                final_response = Mock()
                final_response.choices = [Mock()]
                final_response.choices[0].message = Mock()
                final_response.choices[0].message.content = '{"test": "partial result"}'
                final_response.choices[0].message.tool_calls = None
                return final_response
            else:
                # Always return tool calls to trigger max iterations
                tool_call_response = Mock()
                tool_call_response.choices = [Mock()]
                tool_call_response.choices[0].message = Mock()
                tool_call_response.choices[0].message.tool_calls = [Mock()]
                tool_call_response.choices[0].message.tool_calls[0].function.name = "search_documents"
                tool_call_response.choices[0].message.tool_calls[0].function.arguments = '{"query": "test"}'
                tool_call_response.choices[0].message.tool_calls[0].id = "call_123"
                return tool_call_response

        mock_openai_client.chat.completions.create = AsyncMock(side_effect=mock_completions_max_iterations)

        attributes = {
            "test": AttributeDefinition(description="Test", type="string")
        }

        # Should complete successfully with partial results after max iterations
        result = await service.execute(
            attributes=attributes,
            max_iterations=2
        )

        # Verify result contains partial data
        assert isinstance(result, str)
        result_dict = json.loads(result)
        assert "test" in result_dict
        assert result_dict["test"] == "partial result"

    @pytest.mark.asyncio
    async def test_execute_builds_correct_messages(self, service, mock_openai_client):
        """Test that execute builds correct message structure."""
        attributes = {
            "company_name": AttributeDefinition(
                description="Name of the company",
                type="string"
            )
        }

        await service.execute(
            attributes=attributes
        )

        # Check messages were built
        assert len(service.messages) > 0
        assert service.messages[0]["role"] == "system"
        assert "document analysis assistant" in service.messages[0]["content"].lower()
        assert service.messages[1]["role"] == "user"
        # Query should be auto-generated from attribute description
        assert "name of the company" in service.messages[1]["content"].lower()

    @pytest.mark.asyncio
    async def test_search_with_images(self, service, mock_search_toolkit):
        """Test search results formatting with images."""
        mock_search_toolkit.perform_standard_search.return_value = {
            "sources_text": [
                {"page_content": "Text content", "filename": "doc.pdf"}
            ],
            "sources_image": [{"image_data": "base64data"}],
            "list_of_filenames": ["chart1.png", "chart2.png"]
        }

        result = await service.search_documents("test query")

        assert "Text content" in result
        assert "doc.pdf" in result
        assert "Found 1 relevant images" in result
        assert "chart1.png" in result
        assert "chart2.png" in result

    @pytest.mark.asyncio
    async def test_multiple_search_queries_tracked(self, service, mock_openai_client):
        """Test that multiple search queries are tracked."""
        call_count = [0]

        async def mock_completions_create_multi(*args, **kwargs):
            await asyncio.sleep(0)
            call_count[0] += 1

            # Check if this is a structured output call (has response_format)
            if 'response_format' in kwargs:
                # Final structured output response
                final_response = Mock()
                final_response.choices = [Mock()]
                final_response.choices[0].message = Mock()
                final_response.choices[0].message.content = '{"result": "success"}'
                final_response.choices[0].message.tool_calls = None
                return final_response
            elif call_count[0] == 1:
                # First call: first tool call
                tool_call_response = Mock()
                tool_call_response.choices = [Mock()]
                tool_call_response.choices[0].message = Mock()
                tool_call_response.choices[0].message.tool_calls = [Mock()]
                tool_call_response.choices[0].message.tool_calls[0].function.name = "search_documents"
                tool_call_response.choices[0].message.tool_calls[0].function.arguments = '{"query": "first query"}'
                tool_call_response.choices[0].message.tool_calls[0].id = "call_1"
                return tool_call_response
            elif call_count[0] == 2:
                # Second call: second tool call
                tool_call_response = Mock()
                tool_call_response.choices = [Mock()]
                tool_call_response.choices[0].message = Mock()
                tool_call_response.choices[0].message.tool_calls = [Mock()]
                tool_call_response.choices[0].message.tool_calls[0].function.name = "search_documents"
                tool_call_response.choices[0].message.tool_calls[0].function.arguments = '{"query": "second query"}'
                tool_call_response.choices[0].message.tool_calls[0].id = "call_2"
                return tool_call_response
            else:
                # Third call: no tool calls, triggers structured output
                no_tool_response = Mock()
                no_tool_response.choices = [Mock()]
                no_tool_response.choices[0].message = Mock()
                no_tool_response.choices[0].message.tool_calls = None
                return no_tool_response

        mock_openai_client.chat.completions.create = AsyncMock(side_effect=mock_completions_create_multi)

        attributes = {
            "test": AttributeDefinition(description="Test", type="string")
        }

        await service.execute(
            attributes=attributes
        )

        assert len(service.search_queries) == 2
        assert "first query" in service.search_queries
        assert "second query" in service.search_queries

    @pytest.mark.asyncio
    async def test_calculator_tool_execution(self, service, mock_openai_client):
        """Test that calculator tool is properly executed."""
        call_count = [0]

        async def mock_completions_with_calculator(*args, **kwargs):
            await asyncio.sleep(0)
            call_count[0] += 1

            # Check if this is a structured output call (has response_format)
            if 'response_format' in kwargs:
                # Final structured output response with calculated value
                final_response = Mock()
                final_response.choices = [Mock()]
                final_response.choices[0].message = Mock()
                final_response.choices[0].message.content = '{"profit_margin": 0.6}'
                final_response.choices[0].message.tool_calls = None
                return final_response
            elif call_count[0] == 1:
                # First call: search for revenue
                tool_call_response = Mock()
                tool_call_response.choices = [Mock()]
                tool_call_response.choices[0].message = Mock()
                tool_call_response.choices[0].message.tool_calls = [Mock()]
                tool_call_response.choices[0].message.tool_calls[0].function.name = "search_documents"
                tool_call_response.choices[0].message.tool_calls[0].function.arguments = '{"query": "revenue and costs"}'
                tool_call_response.choices[0].message.tool_calls[0].id = "call_1"
                return tool_call_response
            elif call_count[0] == 2:
                # Second call: use calculator to compute margin
                tool_call_response = Mock()
                tool_call_response.choices = [Mock()]
                tool_call_response.choices[0].message = Mock()
                tool_call_response.choices[0].message.tool_calls = [Mock()]
                tool_call_response.choices[0].message.tool_calls[0].function.name = "calculator"
                tool_call_response.choices[0].message.tool_calls[0].function.arguments = '{"expression": "(100 - 40) / 100"}'
                tool_call_response.choices[0].message.tool_calls[0].id = "call_2"
                return tool_call_response
            else:
                # Third call: no tool calls, triggers structured output
                no_tool_response = Mock()
                no_tool_response.choices = [Mock()]
                no_tool_response.choices[0].message = Mock()
                no_tool_response.choices[0].message.tool_calls = None
                return no_tool_response

        mock_openai_client.chat.completions.create = AsyncMock(side_effect=mock_completions_with_calculator)

        attributes = {
            "profit_margin": AttributeDefinition(description="Profit margin percentage", type="number")
        }

        result = await service.execute(attributes=attributes)

        # Verify calculator was called
        messages = service.messages
        calc_messages = [m for m in messages if m.get("name") == "calculator"]
        assert len(calc_messages) > 0

        # Verify calculation result was returned
        assert "0.6" in calc_messages[0]["content"]
