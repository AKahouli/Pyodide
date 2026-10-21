import pytest

from config import Settings


@pytest.mark.parametrize("secret", [None, "", " ", " short ", "short"])
def test_jwt_callback_settings_need_no_static_backend_secret(monkeypatch, secret):
    monkeypatch.delenv("AGENT_MCP_BACKEND_SERVICE_TOKEN", raising=False)
    monkeypatch.setenv("YELLOWSTORM_INTERNAL_SERVICE_TOKEN", "legacy-secret")
    if secret is not None:
        monkeypatch.setenv("AGENT_MCP_BACKEND_SERVICE_TOKEN", secret)
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("AGENT_MCP_AUTH_MODE", "JWT")
    monkeypatch.setenv("AGENT_MCP_JWT_PUBLIC_KEY_FILE", "public.pem")
    monkeypatch.setenv("AGENT_MCP_JWT_ISSUER", "issuer")
    settings = Settings.from_env()
    settings.validate()
    assert not hasattr(settings, "internal_token")


@pytest.mark.parametrize("mode", [None, "JWT", "Bearer", "", "jwt"])
def test_startup_requires_jwt_in_every_environment(monkeypatch, mode):
    monkeypatch.setenv("AGENT_MCP_JWT_PUBLIC_KEY_FILE", "public.pem")
    monkeypatch.setenv("AGENT_MCP_JWT_ISSUER", "issuer")
    monkeypatch.setenv("AGENT_MCP_INGRESS_TOKEN", "legacy-static-secret")
    if mode is None:
        monkeypatch.delenv("AGENT_MCP_AUTH_MODE", raising=False)
    else:
        monkeypatch.setenv("AGENT_MCP_AUTH_MODE", mode)
    settings = Settings.from_env()
    if mode in (None, "JWT"):
        settings.validate()
        assert settings.auth_mode == "JWT"
        assert settings.ingress_token == ""
    else:
        with pytest.raises(ValueError, match="must be JWT"):
            settings.validate()


@pytest.mark.parametrize("field", ["jwt_public_key_file", "jwt_issuer", "jwt_audience"])
@pytest.mark.parametrize("invalid", ["", " "])
def test_jwt_startup_requires_each_trust_setting(field, invalid):
    from dataclasses import replace
    settings = Settings("http://backend", "", 60, 8026, 2097152,
                        jwt_public_key_file="public.pem", jwt_issuer="issuer")
    with pytest.raises(ValueError, match="JWT mode requires"):
        replace(settings, **{field: invalid}).validate()
