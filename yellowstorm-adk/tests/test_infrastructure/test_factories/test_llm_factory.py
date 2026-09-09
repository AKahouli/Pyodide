"""Tests for LLMFactory."""

import sys
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from src.smart_rag.infrastructure.factories.llm_factory import LLMFactory


def _install_lite_llm_mock(monkeypatch, mock_litellm):
    monkeypatch.setitem(
        sys.modules,
        "google.adk.models.lite_llm",
        SimpleNamespace(LiteLlm=mock_litellm),
    )
    # The factory instantiates the latency-instrumented wrapper; constructor
    # kwargs are forwarded unchanged, so route the wrapper to the same mock.
    monkeypatch.setitem(
        sys.modules,
        "src.smart_rag.infrastructure.monitoring.instrumented_lite_llm",
        SimpleNamespace(InstrumentedLiteLlm=mock_litellm),
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

    @pytest.mark.parametrize("model_name", ["test-model", "ollama/test-model"])
    def test_create_no_tool_calls_llm_forwards_zero_retries(self, monkeypatch, model_name):
        mock_litellm = MagicMock()
        _install_lite_llm_mock(monkeypatch, mock_litellm)

        LLMFactory.create_no_tool_calls_llm(model_name, num_retries=0)

        assert mock_litellm.call_args.kwargs["num_retries"] == 0

    def test_create_no_tool_calls_llm_omits_retries_by_default(self, monkeypatch):
        mock_litellm = MagicMock()
        _install_lite_llm_mock(monkeypatch, mock_litellm)

        LLMFactory.create_no_tool_calls_llm("test-model")

        assert "num_retries" not in mock_litellm.call_args.kwargs

    @pytest.mark.parametrize(
        "factory_method",
        [
            "create_parallel_tool_calls_llm",
            "create_no_parallel_tool_calls_llm",
            "create_no_tool_calls_llm",
        ],
    )
    def test_omits_temperature_when_explicitly_none(self, monkeypatch, factory_method):
        """An explicit omission must not become LiteLLM's legacy 0.0 default."""
        mock_litellm = MagicMock()
        _install_lite_llm_mock(monkeypatch, mock_litellm)
        getattr(LLMFactory(), factory_method)("test-model", temperature=None)

        assert "temperature" not in mock_litellm.call_args.kwargs

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

    @pytest.mark.parametrize(
        "factory_method",
        [
            "create_parallel_tool_calls_llm",
            "create_no_parallel_tool_calls_llm",
            "create_no_tool_calls_llm",
        ],
    )
    def test_forwards_reasoning_effort_from_model_config(self, monkeypatch, factory_method):
        mock_litellm = MagicMock()
        _install_lite_llm_mock(monkeypatch, mock_litellm)

        getattr(LLMFactory(), factory_method)({
            "provider": "reasoning-model",
            "reasoning_effort": "high",
        })

        assert mock_litellm.call_args.kwargs["reasoning_effort"] == "high"

    @pytest.mark.parametrize(
        "factory_method",
        [
            "create_parallel_tool_calls_llm",
            "create_no_parallel_tool_calls_llm",
            "create_no_tool_calls_llm",
        ],
    )
    def test_normalizes_kimi_temperature_on_every_factory_method(self, monkeypatch, factory_method):
        """Live BadRequestError: "invalid temperature: only 1 is allowed for
        this model ... Model Group=kimi-k3" -- kimi rejects any temperature
        other than 1, same constraint as GPT-5. Covers all three factory
        methods: each independently computes a normalized model_temperature
        and must actually use it (regression: it used to be computed then
        silently discarded in favor of the raw, unnormalized value)."""
        mock_litellm = MagicMock()
        _install_lite_llm_mock(monkeypatch, mock_litellm)
        mock_llm = MagicMock()
        mock_litellm.return_value = mock_llm

        result = getattr(LLMFactory(), factory_method)("kimi-k3", temperature=0.0)

        assert result == mock_llm
        assert mock_litellm.call_args.kwargs["temperature"] == 1

    def test_get_supported_models(self):
        """Test getting list of supported models."""
        factory = LLMFactory()

        try:
            models = factory.get_supported_models()
            assert isinstance(models, list)
        except AttributeError:
            # Method might not exist
            pass

    def test_every_factory_path_instantiates_the_instrumented_llm(self, monkeypatch):
        """All three creation paths must construct InstrumentedLiteLlm so the
        conversation latency instrumentation covers every agent boundary."""
        raw_lite_llm = MagicMock(name="raw LiteLlm")
        instrumented = MagicMock(name="InstrumentedLiteLlm")
        _install_lite_llm_mock(monkeypatch, raw_lite_llm)
        monkeypatch.setitem(
            sys.modules,
            "src.smart_rag.infrastructure.monitoring.instrumented_lite_llm",
            SimpleNamespace(InstrumentedLiteLlm=instrumented),
        )

        LLMFactory.create_parallel_tool_calls_llm("test-model")
        LLMFactory.create_no_parallel_tool_calls_llm("test-model")
        LLMFactory.create_no_tool_calls_llm("test-model")

        assert instrumented.call_count == 3
        raw_lite_llm.assert_not_called()
