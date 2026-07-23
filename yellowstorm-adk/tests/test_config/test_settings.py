"""Tests for Settings configuration."""

from types import SimpleNamespace

import pytest
from pydantic import ValidationError

import src.config.settings as settings_module
from src.config.settings import get_settings as real_get_settings
from src.config.settings import Settings


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


class TestSettingsValidators:
    """Test cases for Settings validators."""

    def test_snowflake_mcp_url_valid_http(self, monkeypatch):
        """Test SNOWFLAKE_MCP_URL validator with valid HTTP URL."""
        # Set minimal required environment variables
        monkeypatch.setenv("AZURE_STORAGE_ACCOUNT", "test_account")
        monkeypatch.setenv("AZURE_STORAGE_ACCOUNT_KEY", "test_key")
        monkeypatch.setenv("AZURE_DATALAKE_CONNECTION_STRING", "test_connection")
        monkeypatch.setenv("AZURE_DATALAKE_FILE_SYSTEM_NAME", "test_filesystem")
        monkeypatch.setenv("DATABASE_URL", "postgresql://user:pass@localhost/db")
        monkeypatch.setenv("lINKUP_API_KEY", "test_api_key")
        monkeypatch.setenv("WEB_SEARCH_PROMPT", "test_prompt")
        monkeypatch.setenv("API_URL", "https://example.com")
        monkeypatch.setenv("LITELLM_API_BASE_URL", "https://litellm.com")
        monkeypatch.setenv("LITELLM_API_SECRET_KEY", "secret")
        monkeypatch.setenv("EXCEL_MCP_URL", "https://excel.com")
        monkeypatch.setenv("LANGFUSE_HOST", "https://langfuse.com")
        monkeypatch.setenv("LANGFUSE_SECRET_KEY", "secret")
        monkeypatch.setenv("LANGFUSE_PUBLIC_KEY", "public")
        monkeypatch.setenv("AUTH_USERNAME", "user")
        monkeypatch.setenv("AUTH_PASSWORD", "pass")
        monkeypatch.setenv("REDIS_HOST", "localhost")
        monkeypatch.setenv("REDIS_PORT", "6379")
        monkeypatch.setenv("SECRET_KEY", "secret")
        monkeypatch.setenv("EMBEDDING_MODEL", "text-embedding-3-small")
        monkeypatch.setenv("SNOWFLAKE_MCP_URL", "https://snowflake.example.com")

        settings = Settings()
        assert settings.SNOWFLAKE_MCP_URL == "https://snowflake.example.com"

    def test_snowflake_mcp_url_valid_https(self, monkeypatch):
        """Test SNOWFLAKE_MCP_URL validator with valid HTTPS URL."""
        # Set minimal required environment variables
        monkeypatch.setenv("AZURE_STORAGE_ACCOUNT", "test_account")
        monkeypatch.setenv("AZURE_STORAGE_ACCOUNT_KEY", "test_key")
        monkeypatch.setenv("AZURE_DATALAKE_CONNECTION_STRING", "test_connection")
        monkeypatch.setenv("AZURE_DATALAKE_FILE_SYSTEM_NAME", "test_filesystem")
        monkeypatch.setenv("DATABASE_URL", "postgresql://user:pass@localhost/db")
        monkeypatch.setenv("lINKUP_API_KEY", "test_api_key")
        monkeypatch.setenv("WEB_SEARCH_PROMPT", "test_prompt")
        monkeypatch.setenv("API_URL", "https://example.com")
        monkeypatch.setenv("LITELLM_API_BASE_URL", "https://litellm.com")
        monkeypatch.setenv("LITELLM_API_SECRET_KEY", "secret")
        monkeypatch.setenv("EXCEL_MCP_URL", "https://excel.com")
        monkeypatch.setenv("LANGFUSE_HOST", "https://langfuse.com")
        monkeypatch.setenv("LANGFUSE_SECRET_KEY", "secret")
        monkeypatch.setenv("LANGFUSE_PUBLIC_KEY", "public")
        monkeypatch.setenv("AUTH_USERNAME", "user")
        monkeypatch.setenv("AUTH_PASSWORD", "pass")
        monkeypatch.setenv("REDIS_HOST", "localhost")
        monkeypatch.setenv("REDIS_PORT", "6379")
        monkeypatch.setenv("SECRET_KEY", "secret")
        monkeypatch.setenv("EMBEDDING_MODEL", "text-embedding-3-small")
        monkeypatch.setenv("SNOWFLAKE_MCP_URL", "https://snowflake.example.com:8080/api")

        settings = Settings()
        assert settings.SNOWFLAKE_MCP_URL == "https://snowflake.example.com:8080/api"

    def test_snowflake_mcp_url_empty_returns_none(self, monkeypatch):
        """Test SNOWFLAKE_MCP_URL validator with empty string returns None."""
        # Set minimal required environment variables
        monkeypatch.setenv("AZURE_STORAGE_ACCOUNT", "test_account")
        monkeypatch.setenv("AZURE_STORAGE_ACCOUNT_KEY", "test_key")
        monkeypatch.setenv("AZURE_DATALAKE_CONNECTION_STRING", "test_connection")
        monkeypatch.setenv("AZURE_DATALAKE_FILE_SYSTEM_NAME", "test_filesystem")
        monkeypatch.setenv("DATABASE_URL", "postgresql://user:pass@localhost/db")
        monkeypatch.setenv("lINKUP_API_KEY", "test_api_key")
        monkeypatch.setenv("WEB_SEARCH_PROMPT", "test_prompt")
        monkeypatch.setenv("API_URL", "https://example.com")
        monkeypatch.setenv("LITELLM_API_BASE_URL", "https://litellm.com")
        monkeypatch.setenv("LITELLM_API_SECRET_KEY", "secret")
        monkeypatch.setenv("EXCEL_MCP_URL", "https://excel.com")
        monkeypatch.setenv("LANGFUSE_HOST", "https://langfuse.com")
        monkeypatch.setenv("LANGFUSE_SECRET_KEY", "secret")
        monkeypatch.setenv("LANGFUSE_PUBLIC_KEY", "public")
        monkeypatch.setenv("AUTH_USERNAME", "user")
        monkeypatch.setenv("AUTH_PASSWORD", "pass")
        monkeypatch.setenv("REDIS_HOST", "localhost")
        monkeypatch.setenv("REDIS_PORT", "6379")
        monkeypatch.setenv("SECRET_KEY", "secret")
        monkeypatch.setenv("EMBEDDING_MODEL", "text-embedding-3-small")
        monkeypatch.setenv("SNOWFLAKE_MCP_URL", "")

        settings = Settings()
        assert settings.SNOWFLAKE_MCP_URL is None

    def test_snowflake_mcp_url_not_set_returns_none(self, monkeypatch):
        """Test SNOWFLAKE_MCP_URL validator when not set returns None."""
        # Set minimal required environment variables
        monkeypatch.setenv("AZURE_STORAGE_ACCOUNT", "test_account")
        monkeypatch.setenv("AZURE_STORAGE_ACCOUNT_KEY", "test_key")
        monkeypatch.setenv("AZURE_DATALAKE_CONNECTION_STRING", "test_connection")
        monkeypatch.setenv("AZURE_DATALAKE_FILE_SYSTEM_NAME", "test_filesystem")
        monkeypatch.setenv("DATABASE_URL", "postgresql://user:pass@localhost/db")
        monkeypatch.setenv("lINKUP_API_KEY", "test_api_key")
        monkeypatch.setenv("WEB_SEARCH_PROMPT", "test_prompt")
        monkeypatch.setenv("API_URL", "https://example.com")
        monkeypatch.setenv("LITELLM_API_BASE_URL", "https://litellm.com")
        monkeypatch.setenv("LITELLM_API_SECRET_KEY", "secret")
        monkeypatch.setenv("EXCEL_MCP_URL", "https://excel.com")
        monkeypatch.setenv("LANGFUSE_HOST", "https://langfuse.com")
        monkeypatch.setenv("LANGFUSE_SECRET_KEY", "secret")
        monkeypatch.setenv("LANGFUSE_PUBLIC_KEY", "public")
        monkeypatch.setenv("AUTH_USERNAME", "user")
        monkeypatch.setenv("AUTH_PASSWORD", "pass")
        monkeypatch.setenv("REDIS_HOST", "localhost")
        monkeypatch.setenv("REDIS_PORT", "6379")
        monkeypatch.setenv("SECRET_KEY", "secret")
        monkeypatch.setenv("EMBEDDING_MODEL", "text-embedding-3-small")

        settings = Settings()
        assert settings.SNOWFLAKE_MCP_URL is None

    def test_snowflake_mcp_url_invalid_no_scheme(self, monkeypatch):
        """Test SNOWFLAKE_MCP_URL validator with invalid URL (no scheme)."""
        # Set minimal required environment variables
        monkeypatch.setenv("AZURE_STORAGE_ACCOUNT", "test_account")
        monkeypatch.setenv("AZURE_STORAGE_ACCOUNT_KEY", "test_key")
        monkeypatch.setenv("AZURE_DATALAKE_CONNECTION_STRING", "test_connection")
        monkeypatch.setenv("AZURE_DATALAKE_FILE_SYSTEM_NAME", "test_filesystem")
        monkeypatch.setenv("DATABASE_URL", "postgresql://user:pass@localhost/db")
        monkeypatch.setenv("lINKUP_API_KEY", "test_api_key")
        monkeypatch.setenv("WEB_SEARCH_PROMPT", "test_prompt")
        monkeypatch.setenv("API_URL", "https://example.com")
        monkeypatch.setenv("LITELLM_API_BASE_URL", "https://litellm.com")
        monkeypatch.setenv("LITELLM_API_SECRET_KEY", "secret")
        monkeypatch.setenv("EXCEL_MCP_URL", "https://excel.com")
        monkeypatch.setenv("LANGFUSE_HOST", "https://langfuse.com")
        monkeypatch.setenv("LANGFUSE_SECRET_KEY", "secret")
        monkeypatch.setenv("LANGFUSE_PUBLIC_KEY", "public")
        monkeypatch.setenv("AUTH_USERNAME", "user")
        monkeypatch.setenv("AUTH_PASSWORD", "pass")
        monkeypatch.setenv("REDIS_HOST", "localhost")
        monkeypatch.setenv("REDIS_PORT", "6379")
        monkeypatch.setenv("SECRET_KEY", "secret")
        monkeypatch.setenv("EMBEDDING_MODEL", "text-embedding-3-small")
        monkeypatch.setenv("SNOWFLAKE_MCP_URL", "snowflake.example.com")

        with pytest.raises(ValidationError) as exc_info:
            Settings()

        assert "SNOWFLAKE_MCP_URL" in str(exc_info.value)

    def test_snowflake_mcp_url_invalid_wrong_scheme(self, monkeypatch):
        """Test SNOWFLAKE_MCP_URL validator with invalid URL (wrong scheme)."""
        # Set minimal required environment variables
        monkeypatch.setenv("AZURE_STORAGE_ACCOUNT", "test_account")
        monkeypatch.setenv("AZURE_STORAGE_ACCOUNT_KEY", "test_key")
        monkeypatch.setenv("AZURE_DATALAKE_CONNECTION_STRING", "test_connection")
        monkeypatch.setenv("AZURE_DATALAKE_FILE_SYSTEM_NAME", "test_filesystem")
        monkeypatch.setenv("DATABASE_URL", "postgresql://user:pass@localhost/db")
        monkeypatch.setenv("lINKUP_API_KEY", "test_api_key")
        monkeypatch.setenv("WEB_SEARCH_PROMPT", "test_prompt")
        monkeypatch.setenv("API_URL", "https://example.com")
        monkeypatch.setenv("LITELLM_API_BASE_URL", "https://litellm.com")
        monkeypatch.setenv("LITELLM_API_SECRET_KEY", "secret")
        monkeypatch.setenv("EXCEL_MCP_URL", "https://excel.com")
        monkeypatch.setenv("LANGFUSE_HOST", "https://langfuse.com")
        monkeypatch.setenv("LANGFUSE_SECRET_KEY", "secret")
        monkeypatch.setenv("LANGFUSE_PUBLIC_KEY", "public")
        monkeypatch.setenv("AUTH_USERNAME", "user")
        monkeypatch.setenv("AUTH_PASSWORD", "pass")
        monkeypatch.setenv("REDIS_HOST", "localhost")
        monkeypatch.setenv("REDIS_PORT", "6379")
        monkeypatch.setenv("SECRET_KEY", "secret")
        monkeypatch.setenv("EMBEDDING_MODEL", "text-embedding-3-small")
        monkeypatch.setenv("SNOWFLAKE_MCP_URL", "sftp://snowflake.example.com")

        with pytest.raises(ValidationError) as exc_info:
            Settings()

        assert "SNOWFLAKE_MCP_URL" in str(exc_info.value)

    def test_dataviz_mcp_url_valid_http(self, monkeypatch):
        """Test DATAVIZ_MCP_URL validator with valid HTTP URL."""
        # Set minimal required environment variables
        monkeypatch.setenv("AZURE_STORAGE_ACCOUNT", "test_account")
        monkeypatch.setenv("AZURE_STORAGE_ACCOUNT_KEY", "test_key")
        monkeypatch.setenv("AZURE_DATALAKE_CONNECTION_STRING", "test_connection")
        monkeypatch.setenv("AZURE_DATALAKE_FILE_SYSTEM_NAME", "test_filesystem")
        monkeypatch.setenv("DATABASE_URL", "postgresql://user:pass@localhost/db")
        monkeypatch.setenv("lINKUP_API_KEY", "test_api_key")
        monkeypatch.setenv("WEB_SEARCH_PROMPT", "test_prompt")
        monkeypatch.setenv("API_URL", "https://example.com")
        monkeypatch.setenv("LITELLM_API_BASE_URL", "https://litellm.com")
        monkeypatch.setenv("LITELLM_API_SECRET_KEY", "secret")
        monkeypatch.setenv("EXCEL_MCP_URL", "https://excel.com")
        monkeypatch.setenv("LANGFUSE_HOST", "https://langfuse.com")
        monkeypatch.setenv("LANGFUSE_SECRET_KEY", "secret")
        monkeypatch.setenv("LANGFUSE_PUBLIC_KEY", "public")
        monkeypatch.setenv("AUTH_USERNAME", "user")
        monkeypatch.setenv("AUTH_PASSWORD", "pass")
        monkeypatch.setenv("REDIS_HOST", "localhost")
        monkeypatch.setenv("REDIS_PORT", "6379")
        monkeypatch.setenv("SECRET_KEY", "secret")
        monkeypatch.setenv("EMBEDDING_MODEL", "text-embedding-3-small")
        monkeypatch.setenv("DATAVIZ_MCP_URL", "https://dataviz.example.com")

        settings = Settings()
        assert settings.DATAVIZ_MCP_URL == "https://dataviz.example.com"

    def test_dataviz_mcp_url_valid_https(self, monkeypatch):
        """Test DATAVIZ_MCP_URL validator with valid HTTPS URL."""
        # Set minimal required environment variables
        monkeypatch.setenv("AZURE_STORAGE_ACCOUNT", "test_account")
        monkeypatch.setenv("AZURE_STORAGE_ACCOUNT_KEY", "test_key")
        monkeypatch.setenv("AZURE_DATALAKE_CONNECTION_STRING", "test_connection")
        monkeypatch.setenv("AZURE_DATALAKE_FILE_SYSTEM_NAME", "test_filesystem")
        monkeypatch.setenv("DATABASE_URL", "postgresql://user:pass@localhost/db")
        monkeypatch.setenv("lINKUP_API_KEY", "test_api_key")
        monkeypatch.setenv("WEB_SEARCH_PROMPT", "test_prompt")
        monkeypatch.setenv("API_URL", "https://example.com")
        monkeypatch.setenv("LITELLM_API_BASE_URL", "https://litellm.com")
        monkeypatch.setenv("LITELLM_API_SECRET_KEY", "secret")
        monkeypatch.setenv("EXCEL_MCP_URL", "https://excel.com")
        monkeypatch.setenv("LANGFUSE_HOST", "https://langfuse.com")
        monkeypatch.setenv("LANGFUSE_SECRET_KEY", "secret")
        monkeypatch.setenv("LANGFUSE_PUBLIC_KEY", "public")
        monkeypatch.setenv("AUTH_USERNAME", "user")
        monkeypatch.setenv("AUTH_PASSWORD", "pass")
        monkeypatch.setenv("REDIS_HOST", "localhost")
        monkeypatch.setenv("REDIS_PORT", "6379")
        monkeypatch.setenv("SECRET_KEY", "secret")
        monkeypatch.setenv("EMBEDDING_MODEL", "text-embedding-3-small")
        monkeypatch.setenv("DATAVIZ_MCP_URL", "https://dataviz.example.com:8080/api")

        settings = Settings()
        assert settings.DATAVIZ_MCP_URL == "https://dataviz.example.com:8080/api"

    def test_dataviz_mcp_url_empty_returns_none(self, monkeypatch):
        """Test DATAVIZ_MCP_URL validator with empty string returns None."""
        # Set minimal required environment variables
        monkeypatch.setenv("AZURE_STORAGE_ACCOUNT", "test_account")
        monkeypatch.setenv("AZURE_STORAGE_ACCOUNT_KEY", "test_key")
        monkeypatch.setenv("AZURE_DATALAKE_CONNECTION_STRING", "test_connection")
        monkeypatch.setenv("AZURE_DATALAKE_FILE_SYSTEM_NAME", "test_filesystem")
        monkeypatch.setenv("DATABASE_URL", "postgresql://user:pass@localhost/db")
        monkeypatch.setenv("lINKUP_API_KEY", "test_api_key")
        monkeypatch.setenv("WEB_SEARCH_PROMPT", "test_prompt")
        monkeypatch.setenv("API_URL", "https://example.com")
        monkeypatch.setenv("LITELLM_API_BASE_URL", "https://litellm.com")
        monkeypatch.setenv("LITELLM_API_SECRET_KEY", "secret")
        monkeypatch.setenv("EXCEL_MCP_URL", "https://excel.com")
        monkeypatch.setenv("LANGFUSE_HOST", "https://langfuse.com")
        monkeypatch.setenv("LANGFUSE_SECRET_KEY", "secret")
        monkeypatch.setenv("LANGFUSE_PUBLIC_KEY", "public")
        monkeypatch.setenv("AUTH_USERNAME", "user")
        monkeypatch.setenv("AUTH_PASSWORD", "pass")
        monkeypatch.setenv("REDIS_HOST", "localhost")
        monkeypatch.setenv("REDIS_PORT", "6379")
        monkeypatch.setenv("SECRET_KEY", "secret")
        monkeypatch.setenv("EMBEDDING_MODEL", "text-embedding-3-small")
        monkeypatch.setenv("DATAVIZ_MCP_URL", "")

        settings = Settings()
        assert settings.DATAVIZ_MCP_URL is None

    def test_dataviz_mcp_url_not_set_returns_none(self, monkeypatch):
        """Test DATAVIZ_MCP_URL validator when not set returns None."""
        # Set minimal required environment variables
        monkeypatch.setenv("AZURE_STORAGE_ACCOUNT", "test_account")
        monkeypatch.setenv("AZURE_STORAGE_ACCOUNT_KEY", "test_key")
        monkeypatch.setenv("AZURE_DATALAKE_CONNECTION_STRING", "test_connection")
        monkeypatch.setenv("AZURE_DATALAKE_FILE_SYSTEM_NAME", "test_filesystem")
        monkeypatch.setenv("DATABASE_URL", "postgresql://user:pass@localhost/db")
        monkeypatch.setenv("lINKUP_API_KEY", "test_api_key")
        monkeypatch.setenv("WEB_SEARCH_PROMPT", "test_prompt")
        monkeypatch.setenv("API_URL", "https://example.com")
        monkeypatch.setenv("LITELLM_API_BASE_URL", "https://litellm.com")
        monkeypatch.setenv("LITELLM_API_SECRET_KEY", "secret")
        monkeypatch.setenv("EXCEL_MCP_URL", "https://excel.com")
        monkeypatch.setenv("LANGFUSE_HOST", "https://langfuse.com")
        monkeypatch.setenv("LANGFUSE_SECRET_KEY", "secret")
        monkeypatch.setenv("LANGFUSE_PUBLIC_KEY", "public")
        monkeypatch.setenv("AUTH_USERNAME", "user")
        monkeypatch.setenv("AUTH_PASSWORD", "pass")
        monkeypatch.setenv("REDIS_HOST", "localhost")
        monkeypatch.setenv("REDIS_PORT", "6379")
        monkeypatch.setenv("SECRET_KEY", "secret")
        monkeypatch.setenv("EMBEDDING_MODEL", "text-embedding-3-small")

        settings = Settings()
        assert settings.DATAVIZ_MCP_URL is None

    def test_dataviz_mcp_url_invalid_no_scheme(self, monkeypatch):
        """Test DATAVIZ_MCP_URL validator with invalid URL (no scheme)."""
        # Set minimal required environment variables
        monkeypatch.setenv("AZURE_STORAGE_ACCOUNT", "test_account")
        monkeypatch.setenv("AZURE_STORAGE_ACCOUNT_KEY", "test_key")
        monkeypatch.setenv("AZURE_DATALAKE_CONNECTION_STRING", "test_connection")
        monkeypatch.setenv("AZURE_DATALAKE_FILE_SYSTEM_NAME", "test_filesystem")
        monkeypatch.setenv("DATABASE_URL", "postgresql://user:pass@localhost/db")
        monkeypatch.setenv("lINKUP_API_KEY", "test_api_key")
        monkeypatch.setenv("WEB_SEARCH_PROMPT", "test_prompt")
        monkeypatch.setenv("API_URL", "https://example.com")
        monkeypatch.setenv("LITELLM_API_BASE_URL", "https://litellm.com")
        monkeypatch.setenv("LITELLM_API_SECRET_KEY", "secret")
        monkeypatch.setenv("EXCEL_MCP_URL", "https://excel.com")
        monkeypatch.setenv("LANGFUSE_HOST", "https://langfuse.com")
        monkeypatch.setenv("LANGFUSE_SECRET_KEY", "secret")
        monkeypatch.setenv("LANGFUSE_PUBLIC_KEY", "public")
        monkeypatch.setenv("AUTH_USERNAME", "user")
        monkeypatch.setenv("AUTH_PASSWORD", "pass")
        monkeypatch.setenv("REDIS_HOST", "localhost")
        monkeypatch.setenv("REDIS_PORT", "6379")
        monkeypatch.setenv("SECRET_KEY", "secret")
        monkeypatch.setenv("EMBEDDING_MODEL", "text-embedding-3-small")
        monkeypatch.setenv("DATAVIZ_MCP_URL", "dataviz.example.com")

        with pytest.raises(ValidationError) as exc_info:
            Settings()

        assert "DATAVIZ_MCP_URL" in str(exc_info.value)

    def test_dataviz_mcp_url_invalid_wrong_scheme(self, monkeypatch):
        """Test DATAVIZ_MCP_URL validator with invalid URL (wrong scheme)."""
        # Set minimal required environment variables
        monkeypatch.setenv("AZURE_STORAGE_ACCOUNT", "test_account")
        monkeypatch.setenv("AZURE_STORAGE_ACCOUNT_KEY", "test_key")
        monkeypatch.setenv("AZURE_DATALAKE_CONNECTION_STRING", "test_connection")
        monkeypatch.setenv("AZURE_DATALAKE_FILE_SYSTEM_NAME", "test_filesystem")
        monkeypatch.setenv("DATABASE_URL", "postgresql://user:pass@localhost/db")
        monkeypatch.setenv("lINKUP_API_KEY", "test_api_key")
        monkeypatch.setenv("WEB_SEARCH_PROMPT", "test_prompt")
        monkeypatch.setenv("API_URL", "https://example.com")
        monkeypatch.setenv("LITELLM_API_BASE_URL", "https://litellm.com")
        monkeypatch.setenv("LITELLM_API_SECRET_KEY", "secret")
        monkeypatch.setenv("EXCEL_MCP_URL", "https://excel.com")
        monkeypatch.setenv("LANGFUSE_HOST", "https://langfuse.com")
        monkeypatch.setenv("LANGFUSE_SECRET_KEY", "secret")
        monkeypatch.setenv("LANGFUSE_PUBLIC_KEY", "public")
        monkeypatch.setenv("AUTH_USERNAME", "user")
        monkeypatch.setenv("AUTH_PASSWORD", "pass")
        monkeypatch.setenv("REDIS_HOST", "localhost")
        monkeypatch.setenv("REDIS_PORT", "6379")
        monkeypatch.setenv("SECRET_KEY", "secret")
        monkeypatch.setenv("EMBEDDING_MODEL", "text-embedding-3-small")
        monkeypatch.setenv("DATAVIZ_MCP_URL", "sftp://dataviz.example.com")

        with pytest.raises(ValidationError) as exc_info:
            Settings()

        assert "DATAVIZ_MCP_URL" in str(exc_info.value)
