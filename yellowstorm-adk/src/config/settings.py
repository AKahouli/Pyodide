"""Configuration management for the Smart ADK API."""

import os
from functools import lru_cache
from typing import Optional, List, Dict
from urllib.parse import urlparse

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(extra="ignore", case_sensitive=False)

    TEMP_FOLDER: str = "./tmp"
    HOST: str = "localhost"
    PORT: int = 8001
    SSL_KEYFILE: Optional[str] = None
    SSL_CERTFILE: Optional[str] = None
    LOG_CONFIG_PATH: str = "./src/logger/uvicorn_disable_logging.json"
    TIMEOUT_KEEP_ALIVE: int = 5
    UVICORN_WORKERS: int = 1

    QDRANT_URL: Optional[str] = None
    QDRANT_API_KEY: Optional[str] = None
    QDRANT_COLLECTION_NAME: Optional[str] = None
    # Embedding dimensions: ada-002=1536, text-embedding-3-small=1536, text-embedding-3-large=3072
    EMBEDDING_DIMS: int = 3072

    # Azure Storage
    AZURE_STORAGE_ACCOUNT: str
    AZURE_STORAGE_ACCOUNT_KEY: str
    AZURE_DATALAKE_CONNECTION_STRING: str
    AZURE_DATALAKE_FILE_SYSTEM_NAME: str
    DATABASE_URL: str
    lINKUP_API_KEY: str
    WEB_SEARCH_PROMPT: str
    API_URL: str
    LITELLM_API_BASE_URL: str
    LITELLM_API_SECRET_KEY: str
    ATTRIBUT_EXTRACT_MODEL: str = "gpt-4.1"
    EXCEL_MCP_URL: str
    MICROSANDBOX_MCP_URL: Optional[str] = None
    MICROSANDBOX_DOCUMENT_SERVER_URL: Optional[str] = None
    MICROSANDBOX_DOCKER_IMAGE: Optional[str] = None
    MAX_CONCURRENCY: int = 50
    MAX_QUEUE_LENGTH: int = 500
    APPLICATION_INSIGHTS_LOG: bool = False
    DD_TRACE_ENABLED: bool = False
    APPLICATIONINSIGHTS_CONNECTION_STRING: Optional[str] = None
    APPLICATION_INSIGHTS_LOG_CONFIG_PATH: str = "./src/logger/app_insight_logging.json"

    LANGFUSE_HOST: str
    LANGFUSE_SECRET_KEY: str
    LANGFUSE_PUBLIC_KEY: str
    # Authentication to get token
    AUTH_USERNAME: str
    AUTH_PASSWORD: str
    # Redis
    ENABLE_REDIS_SSL: bool = False
    REDIS_HOST: str
    REDIS_PORT: int
    REDIS_DB: int = 0
    REDIS_USER: Optional[str] = None
    REDIS_PASSWORD: Optional[str] = None
    # Celery Configuration
    CELERY_BROKER_URL: Optional[str] = None
    CELERY_RESULT_BACKEND: Optional[str] = None
    CELERY_WORKER_CONCURRENCY: int = 4
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    NESTJS_JWT_SECRET: Optional[str] = None
    # Ollama
    OLLAMA_API_BASE_URL: Optional[str] = None
    OLLAMA_API_KEY: Optional[str] = None
    MEMORY_MODEL: str = "gpt-5.4-mini"
    EVALUATION_MODEL: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("EvaluationModel", "EVALUATION_MODEL"),
    )

    # OpenAI Settings for embeddings
    EMBEDDING_MODEL: str
    OPENAI_CHUNK_SIZE: int = 1000
    OPENAI_MAX_RETRIES: int = 3
    OPENAI_RETRY_MIN_SECONDS: int = 2
    OPENAI_RETRY_MAX_SECONDS: int = 20

    # Embedding Configuration
    FAKE_EMBEDDINGS: bool = False
    ENABLE_POSTGRESQL_LOGGING: bool = True
    POSTGRESQL_LOG_BATCH_SIZE: int = 50
    POSTGRESQL_LOG_FLUSH_INTERVAL: float = 10.0
    POSTGRESQL_LOG_POOL_SIZE: int = 5
    POSTGRESQL_LOG_MAX_OVERFLOW: int = 10

    # Database Connection Pool Settings
    DB_MAX_CONNECTIONS: int = 3000  # PostgreSQL max_connections setting
    DB_POOL_SIZE: int = 100  # Base number of connections in pool
    DB_POOL_MAX_OVERFLOW: int = 50  # Additional connections beyond pool_size
    DB_POOL_TIMEOUT: int = 5  # Seconds to wait for connection from pool
    DB_POOL_RECYCLE: int = 1800  # Seconds to recycle connections (30 minutes)
    DB_POOL_AUTO_SCALE: bool = (
        True  # Auto-scale pool sizes based on workers and max_connections
    )

    # Neo4j
    NEO4J_HOST: Optional[str] = None
    NEO4J_USER: Optional[str] = None
    NEO4J_PASSWORD: Optional[str] = None
    CSRD_BRAIN_ID: Optional[str] = "No_CSRD"

    # SNOWFLAKE
    SNOWFLAKE_MCP_URL: Optional[str] = None

    # DataViz
    DATAVIZ_MCP_URL: Optional[str] = None
    DEFAULT_HTML_AGENT_ENABLED: bool = False

    # Code Interpreter Backend
    CODE_INTERPRETER_BACKEND_URL: Optional[str] = None

    # Vectorstores API (document indexing)
    VECTORSTORES_API_URL: Optional[str] = None

    # Image upload limits
    MAX_IMAGES: int = 10
    MAX_IMAGE_SIZE: int = 10 * 1024 * 1024  # 10MB per image

    # gRPC Configuration
    GRPC_ENABLED: bool = True
    GRPC_PORT: int = 50051
    PLAYBOOK_STREAM_QUEUE_MAXSIZE: int = 128
    STEP_STREAM_QUEUE_MAXSIZE: int = 64

    # External API Configuration for specific brain_ids
    EXTERNAL_API_BRAIN_IDS: List[str] = []  # Brain IDs requiring external routing
    EXTERNAL_API_URL: str  # URL of external API endpoint
    EXTERNAL_API_AGENT_NAME: str = (
        "DPP_MOA"  # Default agent name for responses (fallback)
    )
    EXTERNAL_API_BRAIN_AGENT_MAPPING: Dict[
        str, str
    ] = {}  # Mapping of brain_id to agent_name

    # Dynamic Authentication Configuration
    EXTERNAL_API_AUTH_URL: Optional[str] = (
        None  # Authentication endpoint URL for dynamic token generation
    )
    EXTERNAL_API_USERNAME: Optional[str] = (
        None  # Username for external API authentication
    )
    EXTERNAL_API_PASSWORD: Optional[str] = (
        None  # Password for external API authentication
    )
    BASE64_LIST_ENABLED_BRAIN_IDS: List[str] = [
        "67c99ad236081d40c152c23d"
    ]  # Brain IDs that enable base64 list processing
    ADK_ENABLE_PROGRESSIVE_SSE_STREAMING: bool = False

    @field_validator("AZURE_STORAGE_ACCOUNT", mode="before")
    @classmethod
    def validate_azure_storage_account(cls, v):
        if not v or v.strip() == "":
            raise ValueError("AZURE_STORAGE_ACCOUNT is required and cannot be empty")
        return v

    @field_validator("AZURE_STORAGE_ACCOUNT_KEY", mode="before")
    @classmethod
    def validate_azure_storage_account_key(cls, v):
        if not v or v.strip() == "":
            raise ValueError(
                "AZURE_STORAGE_ACCOUNT_KEY is required and cannot be empty"
            )
        return v

    @field_validator("AZURE_DATALAKE_CONNECTION_STRING", mode="before")
    @classmethod
    def validate_azure_datalake_connection_string(cls, v):
        if not v or v.strip() == "":
            raise ValueError(
                "AZURE_DATALAKE_CONNECTION_STRING is required and cannot be empty"
            )
        return v

    @field_validator("AZURE_DATALAKE_FILE_SYSTEM_NAME", mode="before")
    @classmethod
    def validate_azure_datalake_file_system_name(cls, v):
        if not v or v.strip() == "":
            raise ValueError(
                "AZURE_DATALAKE_FILE_SYSTEM_NAME is required and cannot be empty"
            )
        return v

    @field_validator("DATABASE_URL", mode="before")
    @classmethod
    def validate_database_url(cls, v):
        if not v or v.strip() == "":
            raise ValueError("DATABASE_URL is required and cannot be empty")

        valid_prefixes = (
            "postgresql://",
            "mysql://",
            "sqlite://",
            "mssql://",
            "oracle://",
            "postgresql+asyncpg://",
        )
        if not v.startswith(valid_prefixes):
            raise ValueError(
                "DATABASE_URL must be a valid database URL with supported protocol"
            )

        return v

    @field_validator("lINKUP_API_KEY", mode="before")
    @classmethod
    def validate_tavily_api_key(cls, v):
        if not v or v.strip() == "":
            raise ValueError("TAVILY_API_KEY is required and cannot be empty")
        return v

    @field_validator("WEB_SEARCH_PROMPT", mode="before")
    @classmethod
    def validate_web_search_prompt(cls, v):
        if not v or v.strip() == "":
            raise ValueError("WEB_SEARCH_PROMPT is required and cannot be empty")
        return v

    @field_validator("API_URL", mode="before")
    @classmethod
    def validate_api_url(cls, v):
        if not v or v.strip() == "":
            raise ValueError("API_URL is required and cannot be empty")

        try:
            parsed = urlparse(v)
            if not parsed.scheme or not parsed.netloc:
                raise ValueError("API_URL must be a valid URL with scheme and domain")
            if parsed.scheme not in ("http", "https"):
                raise ValueError("API_URL must use http or https scheme")
        except Exception:
            raise ValueError("API_URL must be a valid URL")

        return v

    @field_validator("LITELLM_API_BASE_URL", mode="before")
    @classmethod
    def validate_litellm_api_base_url(cls, v):
        if not v or v.strip() == "":
            raise ValueError("LITELLM_API_BASE_URL is required and cannot be empty")

        try:
            parsed = urlparse(v)
            if not parsed.scheme or not parsed.netloc:
                raise ValueError(
                    "LITELLM_API_BASE_URL must be a valid URL with scheme and domain"
                )
            if parsed.scheme not in ("http", "https"):
                raise ValueError("LITELLM_API_BASE_URL must use http or https scheme")
        except Exception:
            raise ValueError("LITELLM_API_BASE_URL must be a valid URL")

        return v

    @field_validator("LITELLM_API_SECRET_KEY", mode="before")
    @classmethod
    def validate_litellm_api_secret_key(cls, v):
        if not v or v.strip() == "":
            raise ValueError("LITELLM_API_SECRET_KEY is required and cannot be empty")
        return v

    @field_validator("EXCEL_MCP_URL", mode="before")
    @classmethod
    def validate_excel_mcp_url(cls, v):
        if not v or v.strip() == "":
            raise ValueError("EXCEL_MCP_URL is required and cannot be empty")

        try:
            parsed = urlparse(v)
            if not parsed.scheme or not parsed.netloc:
                raise ValueError(
                    "EXCEL_MCP_URL must be a valid URL with scheme and domain"
                )
            if parsed.scheme not in ("http", "https"):
                raise ValueError("EXCEL_MCP_URL must use http or https scheme")
        except Exception:
            raise ValueError("EXCEL_MCP_URL must be a valid URL")

        return v

    @field_validator("MICROSANDBOX_MCP_URL", mode="before")
    @classmethod
    def validate_microsandbox_mcp_url(cls, v):
        if not v or v.strip() == "":
            return None

        try:
            parsed = urlparse(v)
            if not parsed.scheme or not parsed.netloc:
                raise ValueError(
                    "MICROSANDBOX_MCP_URL must be a valid URL with scheme and domain"
                )
            if parsed.scheme not in ("http", "https"):
                raise ValueError("MICROSANDBOX_MCP_URL must use http or https scheme")
        except Exception:
            raise ValueError("MICROSANDBOX_MCP_URL must be a valid URL")

        return v

    @field_validator("MICROSANDBOX_DOCUMENT_SERVER_URL", mode="before")
    @classmethod
    def validate_microsandbox_document_server_url(cls, v):
        if not v or v.strip() == "":
            return None

        try:
            parsed = urlparse(v)
            if not parsed.scheme or not parsed.netloc:
                raise ValueError(
                    "MICROSANDBOX_DOCUMENT_SERVER_URL must be a valid URL with scheme and domain"
                )
            if parsed.scheme not in ("http", "https"):
                raise ValueError(
                    "MICROSANDBOX_DOCUMENT_SERVER_URL must use http or https scheme"
                )
        except Exception:
            raise ValueError("MICROSANDBOX_DOCUMENT_SERVER_URL must be a valid URL")

        return v

    @field_validator("MICROSANDBOX_DOCKER_IMAGE", mode="before")
    @classmethod
    def validate_microsandbox_docker_image(cls, v):
        if not v or v.strip() == "":
            return None

        return v

    @field_validator("SNOWFLAKE_MCP_URL", mode="before")
    @classmethod
    def validate_snowflake_mcp_url(cls, v):
        if not v or v.strip() == "":
            return None

        try:
            parsed = urlparse(v)
            if not parsed.scheme or not parsed.netloc:
                raise ValueError(
                    "SNOWFLAKE_MCP_URL must be a valid URL with scheme and domain"
                )
            if parsed.scheme not in ("http", "https"):
                raise ValueError("SNOWFLAKE_MCP_URL must use http or https scheme")
        except Exception:
            raise ValueError("SNOWFLAKE_MCP_URL must be a valid URL")

        return v

    @field_validator("DATAVIZ_MCP_URL", mode="before")
    @classmethod
    def validate_dataviz_mcp_url(cls, v):
        if not v or v.strip() == "":
            return None

        try:
            parsed = urlparse(v)
            if not parsed.scheme or not parsed.netloc:
                raise ValueError(
                    "DATAVIZ_MCP_URL must be a valid URL with scheme and domain"
                )
            if parsed.scheme not in ("http", "https"):
                raise ValueError("DATAVIZ_MCP_URL must use http or https scheme")
        except Exception:
            raise ValueError("DATAVIZ_MCP_URL must be a valid URL")

        return v

    @field_validator("CODE_INTERPRETER_BACKEND_URL", mode="before")
    @classmethod
    def validate_code_interpreter_backend_url(cls, v):
        if not v or v.strip() == "":
            return None

        try:
            parsed = urlparse(v)
            if not parsed.scheme or not parsed.netloc:
                raise ValueError(
                    "CODE_INTERPRETER_BACKEND_URL must be a valid URL with scheme and domain"
                )
            if parsed.scheme not in ("http", "https"):
                raise ValueError(
                    "CODE_INTERPRETER_BACKEND_URL must use http or https scheme"
                )
        except Exception:
            raise ValueError("CODE_INTERPRETER_BACKEND_URL must be a valid URL")

        return v

    @field_validator("LANGFUSE_HOST", mode="before")
    @classmethod
    def validate_langfuse_host(cls, v):
        if not v or v.strip() == "":
            raise ValueError("LANGFUSE_HOST is required and cannot be empty")

        try:
            parsed = urlparse(v)
            if not parsed.scheme or not parsed.netloc:
                raise ValueError(
                    "LANGFUSE_HOST must be a valid URL with scheme and domain"
                )
            if parsed.scheme not in ("http", "https"):
                raise ValueError("LANGFUSE_HOST must use http or https scheme")
        except Exception:
            raise ValueError("LANGFUSE_HOST must be a valid URL")

        return v

    @field_validator("LANGFUSE_SECRET_KEY", mode="before")
    @classmethod
    def validate_langfuse_secret_key(cls, v):
        if not v or v.strip() == "":
            raise ValueError("LANGFUSE_SECRET_KEY is required and cannot be empty")
        return v

    @field_validator("LANGFUSE_PUBLIC_KEY", mode="before")
    @classmethod
    def validate_langfuse_public_key(cls, v):
        if not v or v.strip() == "":
            raise ValueError("LANGFUSE_PUBLIC_KEY is required and cannot be empty")
        return v

    @field_validator("EXTERNAL_API_URL", mode="before")
    @classmethod
    def validate_external_api_url(cls, v):
        if not v or v.strip() == "":
            raise ValueError("EXTERNAL_API_URL is required and cannot be empty")

        try:
            parsed = urlparse(v)
            if not parsed.scheme or not parsed.netloc:
                raise ValueError(
                    "EXTERNAL_API_URL must be a valid URL with scheme and domain"
                )
            if parsed.scheme not in ("http", "https"):
                raise ValueError("EXTERNAL_API_URL must use http or https scheme")
        except Exception:
            raise ValueError("EXTERNAL_API_URL must be a valid URL")

        return v

    @field_validator("EXTERNAL_API_AUTH_URL", mode="before")
    @classmethod
    def validate_external_api_auth_url(cls, v):
        if v and v.strip():
            try:
                parsed = urlparse(v)
                if not parsed.scheme or not parsed.netloc:
                    raise ValueError(
                        "EXTERNAL_API_AUTH_URL must be a valid URL with scheme and domain"
                    )
                if parsed.scheme not in ("http", "https"):
                    raise ValueError(
                        "EXTERNAL_API_AUTH_URL must use http or https scheme"
                    )
            except Exception:
                raise ValueError("EXTERNAL_API_AUTH_URL must be a valid URL")
        return v

    @field_validator("AUTH_USERNAME", mode="before")
    @classmethod
    def validate_auth_username(cls, v):
        if not v or v.strip() == "":
            raise ValueError("AUTH_USERNAME is required and cannot be empty")
        return v

    @field_validator("AUTH_PASSWORD", mode="before")
    @classmethod
    def validate_auth_password(cls, v):
        if not v or v.strip() == "":
            raise ValueError("AUTH_PASSWORD is required and cannot be empty")
        return v

    @field_validator("REDIS_HOST", mode="before")
    @classmethod
    def validate_redis_host(cls, v):
        if not v or v.strip() == "":
            raise ValueError("REDIS_HOST is required and cannot be empty")
        return v

    @field_validator("REDIS_PORT", mode="before")
    @classmethod
    def validate_redis_port(cls, v):
        if not v:
            raise ValueError("REDIS_PORT is required and cannot be empty")
        try:
            port = int(v)
            if port <= 0:
                raise ValueError("REDIS_PORT must be a positive integer")
            return port
        except (ValueError, TypeError):
            raise ValueError("REDIS_PORT must be a valid 4-digit integer")

    @field_validator("SECRET_KEY", mode="before")
    @classmethod
    def validate_secret_key(cls, v):
        if not v or v.strip() == "":
            raise ValueError("SECRET_KEY is required and cannot be empty")
        return v

    @field_validator("ALGORITHM", mode="before")
    @classmethod
    def validate_algorithm(cls, v):
        if not v or v.strip() == "":
            raise ValueError("ALGORITHM is required and cannot be empty")
        return v

    def get_effective_pool_size(self) -> int:
        """Get the effective pool size, auto-scaled if needed.

        Returns at least 1 connection per worker or raises ValueError if impossible.
        Raises:
            ValueError: If DB_MAX_CONNECTIONS is too low for the current configuration
        """
        if not self.DB_POOL_AUTO_SCALE:
            return self.DB_POOL_SIZE

        # Only reserve logging connections if logging is actually enabled
        # Each log handler can use up to pool_size + max_overflow connections
        total_log_connections = 0
        if self.ENABLE_POSTGRESQL_LOGGING:
            log_connections_per_worker = (
                self.POSTGRESQL_LOG_POOL_SIZE + self.POSTGRESQL_LOG_MAX_OVERFLOW
            )
            total_log_connections = self.UVICORN_WORKERS * log_connections_per_worker
        total_connections = (
            self.UVICORN_WORKERS * (self.DB_POOL_SIZE + self.DB_POOL_MAX_OVERFLOW)
        ) + total_log_connections
        safe_limit = int(self.DB_MAX_CONNECTIONS * 0.8)

        if total_connections > safe_limit:
            # Auto-calculate safe pool sizes
            # Subtract total logging connections (all workers) if logging is enabled
            available_for_workers = safe_limit - total_log_connections

            # Validate configuration is feasible
            if available_for_workers < self.UVICORN_WORKERS:
                error_msg = (
                    f"Invalid database pool configuration: Cannot allocate connections.\n"
                    f"  DB_MAX_CONNECTIONS: {self.DB_MAX_CONNECTIONS}\n"
                    f"  Safe limit (80%): {safe_limit}\n"
                    f"  Workers: {self.UVICORN_WORKERS}\n"
                )

                if self.ENABLE_POSTGRESQL_LOGGING:
                    error_msg += (
                        f"  Logging pool per worker: {self.POSTGRESQL_LOG_POOL_SIZE}\n"
                        f"  Total logging connections: {total_log_connections}\n"
                    )
                else:
                    error_msg += f"  PostgreSQL logging: Disabled\n"

                error_msg += (
                    f"  Available for workers: {available_for_workers}\n"
                    f"  Minimum required: {self.UVICORN_WORKERS} (1 per worker)\n"
                    f"\n"
                    f"Solutions:\n"
                    f"  1. Increase DB_MAX_CONNECTIONS (current: {self.DB_MAX_CONNECTIONS})\n"
                    f"  2. Reduce UVICORN_WORKERS (current: {self.UVICORN_WORKERS})\n"
                )

                if self.ENABLE_POSTGRESQL_LOGGING:
                    error_msg += f"  3. Reduce POSTGRESQL_LOG_POOL_SIZE (current: {self.POSTGRESQL_LOG_POOL_SIZE})\n"
                    error_msg += f"  4. Disable PostgreSQL logging (ENABLE_POSTGRESQL_LOGGING=False)\n"
                    error_msg += f"  5. Set DB_POOL_AUTO_SCALE=False and configure pools manually"
                else:
                    error_msg += f"  3. Set DB_POOL_AUTO_SCALE=False and configure pools manually"

                raise ValueError(error_msg)

            connections_per_worker_safe = available_for_workers // self.UVICORN_WORKERS

            # Clamp to minimum of 1 connection per worker
            if connections_per_worker_safe < 1:
                connections_per_worker_safe = 1

            # Split into pool_size (70%) and max_overflow (30%)
            pool_size = int(connections_per_worker_safe * 0.7)

            # Ensure at least 1 for pool_size
            return max(1, pool_size)

        return self.DB_POOL_SIZE

    def get_effective_max_overflow(self) -> int:
        """Get the effective max overflow, auto-scaled if needed.

        Returns at least 0 for overflow.


        Raises:
            ValueError: If DB_MAX_CONNECTIONS is too low for the current configuration
        """
        if not self.DB_POOL_AUTO_SCALE:
            return self.DB_POOL_MAX_OVERFLOW

        # Only reserve logging connections if logging is actually enabled
        # Each log handler can use up to pool_size + max_overflow connections
        total_log_connections = 0
        if self.ENABLE_POSTGRESQL_LOGGING:
            log_connections_per_worker = (
                self.POSTGRESQL_LOG_POOL_SIZE + self.POSTGRESQL_LOG_MAX_OVERFLOW
            )
            total_log_connections = self.UVICORN_WORKERS * log_connections_per_worker
        total_connections = (
            self.UVICORN_WORKERS * (self.DB_POOL_SIZE + self.DB_POOL_MAX_OVERFLOW)
        ) + total_log_connections
        safe_limit = int(self.DB_MAX_CONNECTIONS * 0.8)

        if total_connections > safe_limit:
            # Auto-calculate safe pool sizes
            # Subtract total logging connections (all workers) if logging is enabled
            available_for_workers = safe_limit - total_log_connections

            # Validate configuration is feasible (same check as pool_size)
            if available_for_workers < self.UVICORN_WORKERS:
                error_msg = (
                    f"Invalid database pool configuration: Cannot allocate connections.\n"
                    f"  DB_MAX_CONNECTIONS: {self.DB_MAX_CONNECTIONS}\n"
                    f"  Safe limit (80%): {safe_limit}\n"
                    f"  Workers: {self.UVICORN_WORKERS}\n"
                )

                if self.ENABLE_POSTGRESQL_LOGGING:
                    error_msg += (
                        f"  Logging pool per worker: {self.POSTGRESQL_LOG_POOL_SIZE}\n"
                        f"  Total logging connections: {total_log_connections}\n"
                    )
                else:
                    error_msg += f"  PostgreSQL logging: Disabled\n"

                error_msg += (
                    f"  Available for workers: {available_for_workers}\n"
                    f"  Minimum required: {self.UVICORN_WORKERS} (1 per worker)\n"
                    f"\n"
                    f"Solutions:\n"
                    f"  1. Increase DB_MAX_CONNECTIONS (current: {self.DB_MAX_CONNECTIONS})\n"
                    f"  2. Reduce UVICORN_WORKERS (current: {self.UVICORN_WORKERS})\n"
                )

                if self.ENABLE_POSTGRESQL_LOGGING:
                    error_msg += f"  3. Reduce POSTGRESQL_LOG_POOL_SIZE (current: {self.POSTGRESQL_LOG_POOL_SIZE})\n"
                    error_msg += f"  4. Disable PostgreSQL logging (ENABLE_POSTGRESQL_LOGGING=False)\n"
                    error_msg += f"  5. Set DB_POOL_AUTO_SCALE=False and configure pools manually"
                else:
                    error_msg += f"  3. Set DB_POOL_AUTO_SCALE=False and configure pools manually"

                raise ValueError(error_msg)

            connections_per_worker_safe = available_for_workers // self.UVICORN_WORKERS

            # Clamp to minimum of 1 connection per worker
            if connections_per_worker_safe < 1:
                connections_per_worker_safe = 1

            # Split into pool_size (70%) and max_overflow (30%)
            pool_size = int(connections_per_worker_safe * 0.7)
            pool_size = max(1, pool_size)  # Ensure at least 1

            overflow = connections_per_worker_safe - pool_size

            # Ensure at least 0 for overflow (never negative)
            return max(0, overflow)

        return self.DB_POOL_MAX_OVERFLOW


ENV_FILES = {
    "local": ".env",
    "dev": ".env.dev",
    "test": ".env.test",
}


@lru_cache()
def get_settings() -> Settings:
    """Load and cache settings based on the `ENVIRONMENT` variable."""

    environment = os.getenv("ENVIRONMENT", "local")
    env_file = ENV_FILES.get(environment)
    if env_file:
        return Settings(_env_file=env_file)  # type: ignore
    if environment == "prod":
        return Settings()  # type: ignore
    raise ValueError(f"Invalid environment: {environment}")
