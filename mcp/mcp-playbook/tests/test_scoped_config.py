import pytest

from config import Settings


def test_generic_secret_is_not_a_backend_credential(monkeypatch):
    monkeypatch.delenv("PLAYBOOK_MCP_BACKEND_SERVICE_TOKEN", raising=False)
    monkeypatch.setenv("YELLOWSTORM_INTERNAL_SERVICE_TOKEN", "legacy-secret")
    with pytest.raises(ValueError, match="PLAYBOOK_MCP_BACKEND_SERVICE_TOKEN"):
        Settings.from_env().validate()


@pytest.mark.parametrize("secret", ["", " ", " short ", "short"])
def test_production_rejects_blank_padded_and_short_secrets(monkeypatch, secret):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("PLAYBOOK_MCP_BACKEND_SERVICE_TOKEN", secret)
    with pytest.raises(ValueError, match="PLAYBOOK_MCP_BACKEND_SERVICE_TOKEN"):
        Settings.from_env().validate()
