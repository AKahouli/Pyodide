import pytest
from dataclasses import replace

from config import Settings


def platform_settings(**overrides) -> Settings:
    base = Settings("http://backend", 190, 2097152, 25, 8030, "0.0.0.0", "streamable-http", "public.pem",
                    jwt_issuer="issuer", jwt_audience="mcp-platform")
    return replace(base, **overrides)


@pytest.mark.parametrize("secret", [None, "", " ", " short ", "short"])
def test_jwt_callback_settings_need_no_static_backend_secret(monkeypatch, secret):
    for retired in ("MCP_INGRESS_TOKEN", "PLAYBOOK_MCP_INGRESS_TOKEN",
                    "YELLOWSTORM_INTERNAL_SERVICE_TOKEN", "PLAYBOOK_MCP_BACKEND_SERVICE_TOKEN"):
        monkeypatch.delenv(retired, raising=False)
    monkeypatch.setenv("YELLOWSTORM_INTERNAL_SERVICE_TOKEN", "legacy-secret")
    monkeypatch.setenv("MCP_INGRESS_TOKEN", "legacy-ingress-secret")
    monkeypatch.setenv("MCP_JWT_PUBLIC_KEY_FILE", "public.pem")
    monkeypatch.setenv("MCP_JWT_ISSUER", "issuer")
    if secret is not None:
        monkeypatch.setenv("PLAYBOOK_MCP_BACKEND_SERVICE_TOKEN", secret)
    settings = Settings.from_env()
    settings.validate()
    assert not any(hasattr(settings, name) for name in
                   ("ingress_token", "internal_token", "backend_service_token", "auth_mode"))


def test_platform_defaults(monkeypatch):
    for name in ("MCP_JWT_PUBLIC_KEY_FILE", "MCP_JWT_ISSUER", "MCP_JWT_AUDIENCE", "PORT", "HOST",
                 "MCP_TRANSPORT", "MCP_TIMEOUT_SECONDS", "MCP_MAX_RESPONSE_BYTES",
                 "PLAYBOOK_MCP_SEARCH_LIMIT_MAX", "YELLOWSTORM_BACKEND_URL"):
        monkeypatch.delenv(name, raising=False)
    settings = Settings.from_env()
    assert settings.jwt_issuer == "yellowstorm"
    assert settings.jwt_audience == "mcp-platform"
    assert settings.port == 8030
    assert settings.transport == "streamable-http"
    assert settings.timeout_seconds == 190
    with pytest.raises(ValueError, match="JWT authentication requires"):
        settings.validate()


@pytest.mark.parametrize("field", ["jwt_public_key_file", "jwt_issuer", "jwt_audience"])
@pytest.mark.parametrize("invalid", ["", " "])
def test_jwt_startup_requires_each_trust_setting(field, invalid):
    with pytest.raises(ValueError, match="JWT authentication requires"):
        platform_settings(**{field: invalid}).validate()


@pytest.mark.parametrize("transport", ["sse", "stdio", ""])
def test_transport_is_stateless_streamable_http_only(transport):
    with pytest.raises(ValueError, match="streamable-http"):
        platform_settings(transport=transport).validate()


def test_other_settings_are_validated():
    with pytest.raises(ValueError, match="HTTP\\(S\\)"):
        platform_settings(backend_url="ftp://backend").validate()
    with pytest.raises(ValueError, match="PORT"):
        platform_settings(port=0).validate()
    with pytest.raises(ValueError, match="MCP_TIMEOUT_SECONDS"):
        platform_settings(timeout_seconds=0).validate()
    with pytest.raises(ValueError, match="MCP_MAX_RESPONSE_BYTES"):
        platform_settings(max_response_bytes=1023).validate()
    with pytest.raises(ValueError, match="PLAYBOOK_MCP_SEARCH_LIMIT_MAX"):
        platform_settings(search_limit_max=26).validate()
