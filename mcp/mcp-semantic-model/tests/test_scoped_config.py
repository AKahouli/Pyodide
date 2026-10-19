import pytest

from config import Settings


def test_generic_secret_is_not_a_backend_credential(monkeypatch):
    monkeypatch.delenv("SEMANTIC_MODEL_MCP_SERVICE_TOKEN", raising=False)
    monkeypatch.setenv("YELLOWSTORM_INTERNAL_SERVICE_TOKEN", "legacy-secret")
    monkeypatch.setenv("ENVIRONMENT", "development")
    with pytest.raises(ValueError, match="SEMANTIC_MODEL_MCP_SERVICE_TOKEN"):
        Settings.from_env().validate()


@pytest.mark.parametrize("secret", ["", " ", " short ", "short"])
def test_production_rejects_blank_padded_and_short_secrets(monkeypatch, secret):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("SEMANTIC_MODEL_MCP_AUTH_MODE", "Bearer")
    monkeypatch.setenv("SEMANTIC_MODEL_MCP_SERVICE_TOKEN", secret)
    with pytest.raises(ValueError, match="SEMANTIC_MODEL_MCP_SERVICE_TOKEN"):
        Settings.from_env().validate()


def test_generic_secret_is_not_loaded_when_scoped_secret_is_present(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "development")
    monkeypatch.setenv("YELLOWSTORM_INTERNAL_SERVICE_TOKEN", "legacy-secret")
    monkeypatch.setenv("SEMANTIC_MODEL_MCP_SERVICE_TOKEN", "scoped-secret")
    settings = Settings.from_env()
    assert not hasattr(settings, "internal_token")
    assert settings.service_token == "scoped-secret"
