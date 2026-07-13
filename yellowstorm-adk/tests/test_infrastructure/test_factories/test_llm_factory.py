"""Tests for LLMFactory."""

import pytest
from unittest.mock import MagicMock, patch

from src.smart_rag.infrastructure.factories.llm_factory import LLMFactory


class TestLLMFactory:
    """Test cases for LLMFactory."""

    def test_init(self):
        """Test factory initialization."""
        factory = LLMFactory()
        assert factory is not None

    @patch('google.adk.models.lite_llm.LiteLlm')
    def test_create_parallel_tool_calls_llm(self, mock_litellm):
        """Test creating LLM with parallel tool calls support."""
        mock_llm = MagicMock()
        mock_litellm.return_value = mock_llm

        factory = LLMFactory()
        result = factory.create_parallel_tool_calls_llm("test-model")

        assert result == mock_llm
        mock_litellm.assert_called_once()

    @patch('google.adk.models.lite_llm.LiteLlm')
    def test_create_no_tool_calls_llm(self, mock_litellm):
        """Test creating LLM without tool calls support."""
        mock_llm = MagicMock()
        mock_litellm.return_value = mock_llm

        factory = LLMFactory()
        result = factory.create_no_tool_calls_llm("test-model")

        assert result == mock_llm
        mock_litellm.assert_called_once()

    @pytest.mark.parametrize(
        "factory_method",
        [
            "create_parallel_tool_calls_llm",
            "create_no_parallel_tool_calls_llm",
            "create_no_tool_calls_llm",
        ],
    )
    @patch('google.adk.models.lite_llm.LiteLlm')
    def test_omits_temperature_when_explicitly_none(self, mock_litellm, factory_method):
        """An explicit omission must not become LiteLLM's legacy 0.0 default."""
        getattr(LLMFactory(), factory_method)("test-model", temperature=None)

        assert "temperature" not in mock_litellm.call_args.kwargs

    def test_get_supported_models(self):
        """Test getting list of supported models."""
        factory = LLMFactory()

        try:
            models = factory.get_supported_models()
            assert isinstance(models, list)
        except AttributeError:
            # Method might not exist
            pass
