"""Tests for Settings configuration."""

from types import SimpleNamespace

import pytest
from pydantic import ValidationError

import src.config.settings as settings_module
from src.config.settings import get_settings as real_get_settings


@pytest.fixture
def settings_env_file(tmp_path, monkeypatch):
    for name in list(settings_module.os.environ):
        monkeypatch.delenv(name)
    env_file = tmp_path / ".env"
    env_file.write_text(
        "AZURE_DATALAKE_CONNECTION_STRING=test\n"
        "AZURE_DATALAKE_FILE_SYSTEM_NAME=test\n"
        "DATABASE_URL=postgresql://localhost/test\n"
        "LINKUP_API_KEY=test\n"
        "WEB_SEARCH_PROMPT=test\n"
        "API_URL=http://localhost:3000\n"
        "LITELLM_API_BASE_URL=http://localhost:4000\n"
        "LITELLM_API_SECRET_KEY=test\n"
        "REDIS_HOST=localhost\n"
        "REDIS_PORT=6379\n"
        "ADK_API_KEY=test\n"
        "VECTORSTORE_API_KEY=test\n"
        "EMBEDDING_MODEL=test\n"
        "API_ADK_URL=http://localhost:8001\n",
        encoding="utf-8",
    )
    return env_file


@pytest.mark.parametrize(
    ("dotenv_port", "process_port", "expected"),
    [("PORT=8100", None, 8100), ("PORT=8100", "8200", 8200),
     ("ADK_PORT=8300", None, 8300)],
)
def test_settings_accepts_shared_dotenv_keys(
    settings_env_file, monkeypatch, dotenv_port, process_port, expected
):
    with settings_env_file.open("a", encoding="utf-8") as env_file:
        env_file.write(f"{dotenv_port}\n")
    if process_port is not None:
        monkeypatch.setenv("PORT", process_port)

    settings = settings_module.Settings(_env_file=settings_env_file)

    assert settings.PORT == expected
    assert settings.lINKUP_API_KEY == "test"
    assert not hasattr(settings, "API_ADK_URL")


def test_settings_still_validates_known_dotenv_fields(settings_env_file):
    with settings_env_file.open("a", encoding="utf-8") as env_file:
        env_file.write("PORT=invalid\n")

    with pytest.raises(ValidationError) as error:
        settings_module.Settings(_env_file=settings_env_file)

    assert [(item["loc"], item["type"]) for item in error.value.errors()] == [
        (("PORT",), "int_parsing")
    ]


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
