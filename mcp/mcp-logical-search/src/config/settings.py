from functools import lru_cache
from typing import Literal, Optional

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime settings for the logical indexing MCP server."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    MCP_HOST: str
    MCP_PORT: int = 8045
    MCP_API_KEY: str
    HEALTH_ALLOWED_NETWORKS: list[str] = Field(default_factory=lambda: ["127.0.0.0/8", "::1/128"])
    HTTP_BODY_MAX_BYTES: int = Field(default=1_048_576, gt=0)
    HTTP_SCOPE_MAX_CHARS: int = Field(default=1024, gt=0)
    HTTP_SUMMARY_MAX_PAIRS: int = Field(default=100, gt=0)
    HTTP_REQUESTS_PER_MINUTE: int = Field(default=120, gt=0)
    HTTP_MODEL_REQUESTS_PER_MINUTE: int = Field(default=10, gt=0)
    ROUTING_PROFILE_MAX_SECTIONS: int = Field(default=200, gt=0)
    ROUTING_PROFILE_TIMEOUT_SECONDS: float = Field(default=120, gt=0)
    HEALTH_READY_CACHE_SECONDS: float = Field(default=5.0, gt=0)
    HOST: Optional[str] = None
    PORT: Optional[int] = None

    LOG_LEVEL: str = "INFO"
    LOG_JSON_FORMAT: bool = False
    COLOR_LOGS: bool = True
    LOG_CONFIG_PATH: str = "./src/logger/uvicorn_disable_logging.json"
    REQUEST_LOG_DIR: str = "logs"
    REQUEST_LOG_ENABLED: bool = False
    REQUEST_LOG_MAX_CHARS: int = 20000
    REQUEST_LOG_SAMPLE_RATE: float = 0.05
    REQUEST_LOG_QUEUE_SIZE: int = 1000
    REQUEST_LOG_MAX_BYTES: int = 10_000_000
    REQUEST_LOG_BACKUP_COUNT: int = 3
    LANGUAGE_MODEL_PATH: str = "models/lid.176.bin"

    DATABASE_URL: str 
    DB_POOL_SIZE: int = 5
    DB_MAX_OVERFLOW: int = 10
    DB_SYNC_WORKER_LIMIT: int = 10
    DB_QUEUE_LIMIT: int = 100
    DB_POOL_TIMEOUT_SECONDS: float = 5.0
    DB_CONNECT_TIMEOUT_SECONDS: int = 5
    DB_STATEMENT_TIMEOUT_MS: int = 30000
    DB_ECHO: bool = False
    DB_TLS_MODE: Literal["verify-full", "disable"] = "verify-full"
    DB_TLS_CA_FILE: Optional[str] = None

    EMBEDDING_DIMENSION: int = 2048
    EMBEDDING_MATRYOSHKA: bool = False
    PAGE_THRESHOLD: int = 20
    READ_CONTENT_BATCH_MAX_BYTES: int = 500000
    READ_REQUEST_TIMEOUT_SECONDS: float = 30.0
    SHUTDOWN_GRACE_SECONDS: float = 30.0
    READ_BLOCK_PAGE_SIZE: int = 1000
    READ_IMAGE_PAGE_SIZE: int = 20
    REQUEST_QUERY_MAX_CHARS: int = 4000
    REQUEST_COLLECTION_MAX_ITEMS: int = 100
    REQUEST_BATCH_MAX_ITEMS: int = 10
    SEARCH_RESULT_LIMIT_MAX: int = 100
    SEARCH_PREVIEW_MAX_CHARS: int = 200
    SEARCH_EVIDENCE_MAX_CHARS: int = 1000
    SEARCH_EVIDENCE_MAX_BYTES: int = 24000
    SEARCH_SECTION_BLOCK_LIMIT: int = 3
    SECTION_SEARCH_MAX_SECTIONS: int = 10
    IMAGE_BBOX_DPI: int = 144
    IMAGE_MAX_ENCODED_BYTES: int = Field(default=20_000_000, gt=0)
    IMAGE_MAX_DECODED_BYTES: int = Field(default=15_000_000, gt=0)
    IMAGE_MAX_PIXELS: int = Field(default=25_000_000, gt=0)
    MISTRAL_BBOX_DPI: int = 87
    EXPAND_CONTEXT_DESCENDANT_LIMIT: int = 20
    EXPAND_CONTEXT_SAME_LEVEL_LIMIT: int = 10
    EXPAND_CONTEXT_INCLUDE_IMAGE_BYTES: bool = False

    OPENAI_MODEL: str = "qwen3-vl-embedding"
    RESUME_MODEL: str = "gpt-5.4-mini"
    QUERY_TRANSLATION_ENABLED: bool = True
    QUERY_TRANSLATION_MODEL: str = "gpt-5.4-nano"
    QUERY_TRANSLATION_REASONING_EFFORT: Optional[str] = None
    QUERY_TRANSLATION_TIMEOUT_SECONDS: float = 5.0
    SEARCH_REQUEST_TIMEOUT_SECONDS: float = 30.0
    SEARCH_SCALABLE_SCOPE_ENABLED: bool = True
    SEARCH_RETRIEVAL_RESERVE_SECONDS: float = 5.0
    HYBRID_RRF_K: int = 60
    HYBRID_VECTOR_WEIGHT: float = 0.8
    HYBRID_BM25_WEIGHT: float = 1.0
    SEARCH_BLOCK_WEIGHT: float = Field(default=0.75, ge=0.0, le=1.0)
    SEARCH_SECTION_WEIGHT: float = Field(default=0.20, ge=0.0, le=1.0)
    SEARCH_FILENAME_WEIGHT: float = Field(default=0.05, ge=0.0, le=1.0)
    SEARCH_FILENAME_SEMANTIC_ENABLED: bool = True
    SEARCH_FILENAME_SEMANTIC_TIMEOUT_SECONDS: float = Field(default=5.0, gt=0.0)
    SEARCH_FILENAME_SEMANTIC_MAX_FILES: int = Field(default=100, ge=1)
    SEARCH_DOCUMENTS_MIN_VECTOR_SCORE: float = 0.5
    SEARCH_DOCUMENTS_MIN_SCORE: float = 0.35
    SEARCH_DOCUMENTS_RELATIVE_SCORE: float = 0.7
    SEARCH_DOCUMENTS_LEXICAL_BONUS: float = 0.08
    SEARCH_DOCUMENTS_CANDIDATE_LIMIT: int = 100
    SEARCH_DOCUMENTS_RESULT_LIMIT: int = 10
    SEARCH_DOCUMENTS_MATCHES_PER_DOCUMENT: int = 3
    SEARCH_COVERAGE_DOCUMENT_LIMIT: int = 10
    SEARCH_BEST_MATCHES_PER_DOCUMENT: int = 3
    SEARCH_MIN_SCORE: float = 0.3
    OPENAI_CHUNK_SIZE: int = 1000
    MODEL_REQUEST_LIMIT: int = 10
    MODEL_QUEUE_LIMIT: int = 100
    EMBEDDING_TIMEOUT_SECONDS: float = 15.0
    OPENAI_MAX_RETRIES: int = 3
    OPENAI_RETRY_MIN_SECONDS: int = 2
    OPENAI_RETRY_MAX_SECONDS: int = 20
    LITELLM_BASE_URL: Optional[str] = None
    LITELLM_API_KEY: Optional[str] = None
    MODEL_ALLOWED_ORIGINS: list[str] = Field(default_factory=list)
    MODEL_ALLOW_HTTP_LOOPBACK: bool = False

    @field_validator("HEALTH_ALLOWED_NETWORKS")
    @classmethod
    def validate_health_networks(cls, values):
        from ipaddress import ip_network
        for value in values:
            ip_network(value)
        return values

    @property
    def app_host(self) -> str:
        return self.HOST or self.MCP_HOST

    @property
    def app_port(self) -> int:
        return self.PORT or self.MCP_PORT

    @field_validator("MCP_PORT", "PORT")
    @classmethod
    def validate_port(cls, value: Optional[int]) -> Optional[int]:
        if value is not None and not 1 <= value <= 65535:
            raise ValueError(f"port must be between 1 and 65535, got {value}")
        return value

    @field_validator("MCP_API_KEY")
    @classmethod
    def validate_api_key(cls, value: str) -> str:
        if not value or not value.strip():
            raise ValueError("MCP_API_KEY is required and cannot be empty")
        return value.strip()

    @field_validator("DATABASE_URL")
    @classmethod
    def validate_database_url(cls, value: str) -> str:
        if not value or not value.strip():
            raise ValueError("DATABASE_URL cannot be empty")
        if not value.startswith(("postgresql://", "postgresql+asyncpg://", "postgresql+psycopg2://")):
            raise ValueError("DATABASE_URL must be a PostgreSQL URL")
        return value.strip()

    @field_validator("EMBEDDING_DIMENSION")
    @classmethod
    def validate_embedding_dimension(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("EMBEDDING_DIMENSION must be positive")
        return value

    @field_validator(
        "QUERY_TRANSLATION_TIMEOUT_SECONDS",
        "READ_REQUEST_TIMEOUT_SECONDS",
        "SHUTDOWN_GRACE_SECONDS",
        "SEARCH_REQUEST_TIMEOUT_SECONDS",
        "SEARCH_RETRIEVAL_RESERVE_SECONDS",
        "DB_POOL_TIMEOUT_SECONDS",
        "EMBEDDING_TIMEOUT_SECONDS",
    )
    @classmethod
    def validate_positive_timeout(cls, value: float) -> float:
        if value <= 0:
            raise ValueError("search timeout settings must be positive")
        return value

    @field_validator("IMAGE_BBOX_DPI", "MISTRAL_BBOX_DPI")
    @classmethod
    def validate_dpi(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("DPI settings must be positive")
        return value

    @field_validator(
        "DB_POOL_SIZE",
        "DB_MAX_OVERFLOW",
        "OPENAI_CHUNK_SIZE",
        "EXPAND_CONTEXT_DESCENDANT_LIMIT",
        "EXPAND_CONTEXT_SAME_LEVEL_LIMIT",
    )
    @classmethod
    def validate_non_negative(cls, value: int) -> int:
        if value < 0:
            raise ValueError("value must be non-negative")
        return value

    @field_validator(
        "DB_SYNC_WORKER_LIMIT",
        "DB_QUEUE_LIMIT",
        "DB_CONNECT_TIMEOUT_SECONDS",
        "DB_STATEMENT_TIMEOUT_MS",
        "MODEL_REQUEST_LIMIT",
        "MODEL_QUEUE_LIMIT",
        "READ_CONTENT_BATCH_MAX_BYTES",
        "READ_BLOCK_PAGE_SIZE",
        "READ_IMAGE_PAGE_SIZE",
        "REQUEST_QUERY_MAX_CHARS",
        "REQUEST_COLLECTION_MAX_ITEMS",
        "REQUEST_BATCH_MAX_ITEMS",
        "SEARCH_RESULT_LIMIT_MAX",
        "SEARCH_PREVIEW_MAX_CHARS",
        "SEARCH_EVIDENCE_MAX_CHARS",
        "SEARCH_SECTION_BLOCK_LIMIT",
        "SECTION_SEARCH_MAX_SECTIONS",
    )
    @classmethod
    def validate_positive_database_limit(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("database limits must be positive")
        return value

    @model_validator(mode="after")
    def validate_search_fusion_weights(self):
        total = self.SEARCH_BLOCK_WEIGHT + self.SEARCH_SECTION_WEIGHT + self.SEARCH_FILENAME_WEIGHT
        if abs(total - 1.0) > 1e-9:
            raise ValueError("search block, section, and filename weights must sum to 1")
        return self

    @field_validator("SEARCH_EVIDENCE_MAX_BYTES")
    @classmethod
    def validate_evidence_budget(cls, value: int) -> int:
        if value < 1024:
            raise ValueError("SEARCH_EVIDENCE_MAX_BYTES must be at least 1024")
        return value

    @field_validator("SEARCH_MIN_SCORE")
    @classmethod
    def validate_search_min_score(cls, value: float) -> float:
        if not 0.0 <= value <= 1.0:
            raise ValueError("SEARCH_MIN_SCORE must be between 0 and 1")
        return value

    @field_validator("REQUEST_LOG_SAMPLE_RATE")
    @classmethod
    def validate_sample_rate(cls, value: float) -> float:
        if not 0.0 <= value <= 1.0:
            raise ValueError("REQUEST_LOG_SAMPLE_RATE must be between 0 and 1")
        return value

    @field_validator(
        "REQUEST_LOG_QUEUE_SIZE",
        "REQUEST_LOG_MAX_BYTES",
        "REQUEST_LOG_BACKUP_COUNT",
    )
    @classmethod
    def validate_positive_logging_limit(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("request logging limits must be positive")
        return value


@lru_cache()
def get_settings() -> Settings:
    return Settings()
