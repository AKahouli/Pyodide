"""Tests for Settings configuration."""

from types import SimpleNamespace

import pytest

import src.config.settings as settings_module
from src.config.settings import get_settings as real_get_settings


@pytest.mark.parametrize(
    ("process_value", "setting_value", "expected"),
    [(None, False, "false"), ("true", False, "true")],
)
def test_get_settings_exports_google_client_certificate_setting(
    monkeypatch, process_value, setting_value, expected
):
    monkeypatch.setenv("ENVIRONMENT", "prod")
    if process_value is None:
        monkeypatch.delenv("GOOGLE_API_USE_CLIENT_CERTIFICATE", raising=False)
    else:
        monkeypatch.setenv("GOOGLE_API_USE_CLIENT_CERTIFICATE", process_value)
    monkeypatch.setattr(
        settings_module,
        "Settings",
        lambda **_kwargs: SimpleNamespace(
            GOOGLE_API_USE_CLIENT_CERTIFICATE=setting_value
        ),
    )
    real_get_settings.cache_clear()

    try:
        real_get_settings()
        assert settings_module.os.environ["GOOGLE_API_USE_CLIENT_CERTIFICATE"] == expected
    finally:
        real_get_settings.cache_clear()
