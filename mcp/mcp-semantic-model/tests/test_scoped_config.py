import pytest

from config import Settings


@pytest.mark.parametrize("secret", [None, "", " ", " short ", "short"])
def test_jwt_callback_settings_need_no_static_backend_secret(monkeypatch, secret):
    monkeypatch.delenv("SEMANTIC_MODEL_MCP_SERVICE_TOKEN", raising=False)
    monkeypatch.setenv("YELLOWSTORM_INTERNAL_SERVICE_TOKEN", "legacy-secret")
    if secret is not None:
        monkeypatch.setenv("SEMANTIC_MODEL_MCP_SERVICE_TOKEN", secret)
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("SEMANTIC_MODEL_MCP_AUTH_MODE", "JWT")
    monkeypatch.setenv("SEMANTIC_MODEL_MCP_JWT_PUBLIC_KEY_FILE", "public.pem")
    monkeypatch.setenv("SEMANTIC_MODEL_MCP_JWT_ISSUER", "issuer")
    settings = Settings.from_env()
    settings.validate()
    assert not hasattr(settings, "internal_token")
    assert not hasattr(settings, "service_token")


@pytest.mark.parametrize("field", ["jwt_public_key_file", "jwt_issuer", "jwt_audience"])
@pytest.mark.parametrize("invalid", ["", " "])
def test_jwt_startup_requires_each_trust_setting(field, invalid):
    from dataclasses import replace
    settings = Settings("http://backend", "", 120, 8027, 2097152,
                        jwt_public_key_file="public.pem", jwt_issuer="issuer")
    with pytest.raises(ValueError, match="JWT mode requires"):
        replace(settings, **{field: invalid}).validate()
