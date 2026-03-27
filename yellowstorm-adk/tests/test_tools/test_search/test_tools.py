"""Tests for Search Tools."""

import pytest
from unittest.mock import MagicMock

from src.smart_rag.tools.search.tools import SearchToolADK


class TestSearchToolADK:
    """Test cases for SearchToolADK."""

    def test_init(self):
        """Test search tool initialization."""
        mock_func = MagicMock()
        mock_schema = {
            "function": {
                "name": "test_search",
                "description": "Test search function",
                "parameters": {
                    "type": "object",
                    "properties": {},
                    "required": []
                }
            }
        }

        tool = SearchToolADK(mock_func, mock_schema)
        assert tool is not None

    def test_function_tool_inheritance(self):
        """Test that SearchToolADK inherits from FunctionTool."""
        from google.adk.tools import FunctionTool

        mock_func = MagicMock()
        mock_schema = {
            "function": {
                "name": "test_search",
                "description": "Test search function",
                "parameters": {
                    "type": "object",
                    "properties": {},
                    "required": []
                }
            }
        }

        tool = SearchToolADK(mock_func, mock_schema)
        assert isinstance(tool, FunctionTool)

    def test_init_with_custom_schema(self):
        """Test initialization with custom schema."""
        mock_func = MagicMock()
        custom_schema = {
            "function": {
                "name": "custom_search",
                "description": "Custom search functionality",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "Search query"}
                    },
                    "required": ["query"]
                }
            }
        }

        tool = SearchToolADK(mock_func, custom_schema)
        assert tool is not None

    def test_schema_validation_error(self):
        """Test schema parameter validation with errors."""
        mock_func = MagicMock()

        # Test with None schema (should raise error)
        with pytest.raises(TypeError):
            tool = SearchToolADK(mock_func, None)

        # Test with invalid schema structure (should raise error)
        with pytest.raises(KeyError):
            tool = SearchToolADK(mock_func, {"invalid": "schema"})

    def test_get_declaration_method(self):
        """Test the _get_declaration method."""
        mock_func = MagicMock()
        mock_schema = {
            "function": {
                "name": "test_search",
                "description": "Test search function",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string"}
                    },
                    "required": ["query"]
                }
            }
        }

        tool = SearchToolADK(mock_func, mock_schema)
        declaration = tool._get_declaration()

        assert declaration.name == "test_search"
        assert declaration.description == "Test search function"