"""Tests for the LiteLLM-backed model factory."""
from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from app.agents import model as model_module
from app.agents.model import build_model


def test_build_model_with_explicit_id_constructs_litellm() -> None:
    """`build_model('foo')` returns a `LiteLlm(model='foo')` wrapper."""
    fake = MagicMock()
    original = model_module.LiteLlm
    model_module.LiteLlm = fake  # type: ignore[assignment]
    try:
        instance = build_model("gpt-4o-mini")
    finally:
        model_module.LiteLlm = original  # type: ignore[assignment]
    assert fake.called
    _, kwargs = fake.call_args
    assert kwargs.get("model") == "gpt-4o-mini"
    assert instance is fake.return_value


def test_build_model_without_id_uses_environment_defaults() -> None:
    """`build_model(None)` constructs a `LiteLlm()` with no override."""
    fake = MagicMock()
    original = model_module.LiteLlm
    model_module.LiteLlm = fake  # type: ignore[assignment]
    try:
        build_model(None)
    finally:
        model_module.LiteLlm = original  # type: ignore[assignment]
    assert fake.called
    _, kwargs = fake.call_args
    assert "model" not in kwargs


def test_build_model_raises_when_adk_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    """When `google.adk.models.lite_llm` is not importable, raise a clear error."""
    monkeypatch.setattr("app.agents.model.LiteLlm", None)
    with pytest.raises(RuntimeError, match="google-adk is not installed"):
        build_model("any-model")

