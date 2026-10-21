import pytest
from dataclasses import replace

from config import Settings


def pyodide_settings(**overrides) -> Settings:
    base = Settings("http://backend", 100, 8027, 524288, 30, 90, 65536, 2097152,
                    262144, 524288, 3, 5, 5, "public.pem")
    return replace(base, **overrides)


def test_retired_static_tokens_are_dropped(monkeypatch):
    monkeypatch.setenv("YELLOWSTORM_INTERNAL_SERVICE_TOKEN", "legacy-secret")
    monkeypatch.setenv("PYODIDE_MCP_INGRESS_TOKEN", "legacy-ingress-secret")
    monkeypatch.setenv("MCP_JWT_PUBLIC_KEY_FILE", "public.pem")
    settings = Settings.from_env()
    settings.validate()
    assert not any(hasattr(settings, name) for name in ("internal_token", "ingress_token", "auth_mode"))


def test_defaults(monkeypatch):
    for name in ("MCP_JWT_PUBLIC_KEY_FILE", "MCP_JWT_ISSUER", "MCP_JWT_AUDIENCE",
                 "MCP_PORT", "YELLOWSTORM_BACKEND_URL", "PYODIDE_MCP_TIMEOUT_SECONDS"):
        monkeypatch.delenv(name, raising=False)
    settings = Settings.from_env()
    assert settings.jwt_issuer == "yellowstorm"
    assert settings.jwt_audience == "mcp-pyodide"
    assert settings.port == 8027
    assert settings.timeout_seconds == 100
    with pytest.raises(ValueError, match="JWT authentication requires"):
        settings.validate()


@pytest.mark.parametrize("field", ["jwt_public_key_file", "jwt_issuer", "jwt_audience"])
@pytest.mark.parametrize("invalid", ["", " "])
def test_jwt_startup_requires_each_trust_setting(field, invalid):
    with pytest.raises(ValueError, match="JWT authentication requires"):
        pyodide_settings(**{field: invalid}).validate()


def test_other_limits_are_still_validated():
    with pytest.raises(ValueError, match="HTTP\\(S\\)"):
        pyodide_settings(backend_url="ftp://backend").validate()
    with pytest.raises(ValueError, match="MCP_PORT"):
        pyodide_settings(port=0).validate()
    with pytest.raises(ValueError, match="PYODIDE_MCP_TIMEOUT_SECONDS"):
        pyodide_settings(timeout_seconds=0).validate()
    with pytest.raises(ValueError, match="PYODIDE_MCP_MAX_RESPONSE_BYTES"):
        pyodide_settings(max_response_bytes=1023).validate()
    with pytest.raises(ValueError, match="PYODIDE_MCP_MAX_CODE_BYTES"):
        pyodide_settings(max_code_bytes=1023).validate()
    with pytest.raises(ValueError, match="timeouts"):
        pyodide_settings(default_timeout_seconds=91).validate()
    with pytest.raises(ValueError, match="PYODIDE_MCP_MAX_QUEUE"):
        pyodide_settings(max_queue=0).validate()
    with pytest.raises(ValueError, match="PYODIDE_MCP_MAX_INPUT_FILES"):
        pyodide_settings(max_input_files=0).validate()
    with pytest.raises(ValueError, match="PYODIDE_MCP_MAX_OUTPUT_FILES"):
        pyodide_settings(max_output_files=0).validate()
