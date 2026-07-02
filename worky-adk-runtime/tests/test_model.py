"""Tests for the LiteLLM-backed model factory."""
from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from app.agents import model as model_module
from app.agents.model import build_model
from app.config import Settings


def _patched_settings(monkeypatch: pytest.MonkeyPatch, **overrides) -> None:
    """Force `get_settings()` to return a deterministic Settings object."""
    defaults = dict(
        port=8011,
        backend_base_url="http://localhost:3000",
        service_token="t",
        request_timeout_seconds=15.0,
        adk_version="2.2.0",
        log_level="INFO",
        litellm_api_base_url=None,
        litellm_api_secret_key=None,
    )
    defaults.update(overrides)
    monkeypatch.setattr(
        model_module,
        "get_settings",
        lambda: Settings(**defaults),
    )


def test_build_model_with_explicit_id_and_env_endpoint_forwards_kwargs(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`build_model('gpt-4o-mini')` with env base+key forwards all three kwargs."""
    fake = MagicMock()
    original = model_module.LiteLlm
    model_module.LiteLlm = fake  # type: ignore[assignment]
    _patched_settings(
        monkeypatch,
        litellm_api_base_url="https://litellm.example.com",
        litellm_api_secret_key="sk-test",
    )
    try:
        build_model("gpt-4o-mini")
    finally:
        model_module.LiteLlm = original  # type: ignore[assignment]
    assert fake.called
    _, kwargs = fake.call_args
    assert kwargs.get("model") == "gpt-4o-mini"
    assert kwargs.get("api_base") == "https://litellm.example.com"
    assert kwargs.get("api_key") == "sk-test"


def test_build_model_with_id_and_no_env_does_not_forward_endpoint_kwargs(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When env is unset, the factory must not invent an empty string."""
    fake = MagicMock()
    original = model_module.LiteLlm
    model_module.LiteLlm = fake  # type: ignore[assignment]
    _patched_settings(monkeypatch)
    try:
        build_model("gpt-4o-mini")
    finally:
        model_module.LiteLlm = original  # type: ignore[assignment]
    _, kwargs = fake.call_args
    assert kwargs.get("model") == "gpt-4o-mini"
    assert "api_base" not in kwargs
    assert "api_key" not in kwargs


def test_build_model_without_id_and_no_env_constructs_minimal_wrapper(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No model + no env → still constructs a LiteLlm() (ADK surfaces the error at call time)."""
    fake = MagicMock()
    original = model_module.LiteLlm
    model_module.LiteLlm = fake  # type: ignore[assignment]
    _patched_settings(monkeypatch)
    try:
        build_model(None)
    finally:
        model_module.LiteLlm = original  # type: ignore[assignment]
    _, kwargs = fake.call_args
    assert "model" not in kwargs
    assert "api_base" not in kwargs
    assert "api_key" not in kwargs


def test_build_model_without_id_but_with_env_endpoint_constructs_litellm(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No model id but env base+key set → LiteLlm(endpoint only) is acceptable."""
    fake = MagicMock()
    original = model_module.LiteLlm
    model_module.LiteLlm = fake  # type: ignore[assignment]
    _patched_settings(
        monkeypatch,
        litellm_api_base_url="https://litellm.example.com",
        litellm_api_secret_key="sk-test",
    )
    try:
        build_model(None)
    finally:
        model_module.LiteLlm = original  # type: ignore[assignment]
    _, kwargs = fake.call_args
    assert "model" not in kwargs
    assert kwargs.get("api_base") == "https://litellm.example.com"
    assert kwargs.get("api_key") == "sk-test"


def test_build_model_raises_when_adk_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    """When `google.adk.models.lite_llm` is not importable, raise a clear error."""
    monkeypatch.setattr("app.agents.model.LiteLlm", None)
    with pytest.raises(RuntimeError, match="google-adk is not installed"):
        build_model("any-model")

