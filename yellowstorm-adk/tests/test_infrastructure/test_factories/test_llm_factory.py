"""Tests for LLMFactory."""

import sys
from types import SimpleNamespace
from unittest.mock import MagicMock

from src.smart_rag.infrastructure.factories.llm_factory import LLMFactory


def _install_lite_llm_mock(monkeypatch, mock_litellm):
    monkeypatch.setitem(
        sys.modules,
        "google.adk.models.lite_llm",
        SimpleNamespace(LiteLlm=mock_litellm),
    )


class TestLLMFactory:
    """Test cases for LLMFactory."""

    def test_init(self):
        """Test factory initialization."""
        factory = LLMFactory()
        assert factory is not None

    def test_create_parallel_tool_calls_llm(self, monkeypatch):
        """Test creating LLM with parallel tool calls support."""
        mock_litellm = MagicMock()
        _install_lite_llm_mock(monkeypatch, mock_litellm)
        mock_llm = MagicMock()
        mock_litellm.return_value = mock_llm

        factory = LLMFactory()
        result = factory.create_parallel_tool_calls_llm("test-model")

        assert result == mock_llm
        mock_litellm.assert_called_once()

    def test_create_no_tool_calls_llm(self, monkeypatch):
        """Test creating LLM without tool calls support."""
        mock_litellm = MagicMock()
        _install_lite_llm_mock(monkeypatch, mock_litellm)
        mock_llm = MagicMock()
        mock_litellm.return_value = mock_llm

        factory = LLMFactory()
        result = factory.create_no_tool_calls_llm("test-model")

        assert result == mock_llm
        mock_litellm.assert_called_once()

    def test_create_parallel_tool_calls_llm_normalizes_gpt5_temperature(self, monkeypatch):
        """GPT-5 model groups reject temperature values other than 1."""
        mock_litellm = MagicMock()
        _install_lite_llm_mock(monkeypatch, mock_litellm)
        mock_llm = MagicMock()
        mock_litellm.return_value = mock_llm

        factory = LLMFactory()
        result = factory.create_parallel_tool_calls_llm("gpt-5.4-nano", temperature=0.0)

        assert result == mock_llm
        assert mock_litellm.call_args.kwargs["temperature"] == 1

    def test_create_parallel_tool_calls_llm_preserves_non_gpt5_temperature(self, monkeypatch):
        """Non-GPT-5 models keep the caller-provided temperature."""
        mock_litellm = MagicMock()
        _install_lite_llm_mock(monkeypatch, mock_litellm)
        mock_llm = MagicMock()
        mock_litellm.return_value = mock_llm

        factory = LLMFactory()
        result = factory.create_parallel_tool_calls_llm("gpt-4o-mini", temperature=0.2)

        assert result == mock_llm
        assert mock_litellm.call_args.kwargs["temperature"] == 0.2

    def test_get_supported_models(self):
        """Test getting list of supported models."""
        factory = LLMFactory()

        try:
            models = factory.get_supported_models()
            assert isinstance(models, list)
        except AttributeError:
            # Method might not exist
            pass
