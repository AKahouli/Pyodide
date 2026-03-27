import os
from functools import lru_cache
from typing import Optional

from pydantic import AnyHttpUrl, RedisDsn, Field, field_validator, model_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """
    Settings class for this application.
    Utilizes the BaseSettings from pydantic for environment variables.
    """
    TEMP_FOLDER : str = "./tmp"
    HOST: str = "localhost"
    PORT: int = 8000
    SSL_KEYFILE: Optional[str] = None
    SSL_CERTFILE: Optional[str] = None
    LOG_CONFIG_PATH: str = "./src/logger/uvicorn_disable_logging.json"
    TIMEOUT_KEEP_ALIVE: int = 5
    UVICORN_WORKERS: int = 1
    EMBEDDING_DIMENSION : int

    # Azure Storage
    AZURE_STORAGE_ACCOUNT : str
    AZURE_STORAGE_ACCOUNT_KEY:str
    AZURE_DATALAKE_CONNECTION_STRING: str
    AZURE_DATALAKE_FILE_SYSTEM_NAME: str


    # Default LLM settings
    LLM_TEMPERATURE: float = 0.0
    LLM_MAX_TOKENS: int = 512
    OPENAI_MAX_RETRIES: int = 3
    OPENAI_MODEL: str
    OPENAI_CHUNK_SIZE: int = 1000
    OPENAI_RETRY_MIN_SECONDS: int = 2
    OPENAI_RETRY_MAX_SECONDS: int = 20
    OPENAI_API_VERSION: Optional[str] = None
    LLM_DEPLOYMENT_NAME:str
    # Qdrant
    QDRANT_URL: str
    QDRANT_API_KEY: Optional[str] = None
    # Redis
    ENABLE_REDIS_SSL : bool = False
    REDIS_HOST: str
    REDIS_PORT: int
    REDIS_DB: int = 0
    REDIS_USER: Optional[str] = None
    REDIS_PASSWORD: Optional[str] = None

    # Celery config
    CELERY_BROKER_URL: RedisDsn
    CELERY_RESULT_BACKEND: RedisDsn
    QDRANT_COLLECTION_NAME :str
    # Queue and concurrency
    MAX_QUEUE_LENGTH: int = Field(env="MAX_QUEUE_LENGTH", default=500,
                                  description="The maximum length of the request queue.")
    MAX_CONCURRENCY: int = Field(env="MAX_CONCURRENCY", default=15,
                                 description="The maximum number of concurrent requests.")

    # LangfusePARAM
    LANGFUSE_PUBLIC_KEY:str
    LANGFUSE_PRIVATE_KEY:str
    LANGFUSE_HOST:str
    # Migration vectrostore
    TMP_DELETE_N_SECONDS: int = 60 * 60 * 2  # 2 hours
    EMBEDDING_DEPLOYMENT_NAME : str
    # Debug
    FAKE_EMBEDDINGS: bool = False  # this can be set to True for testing purposes
    # Image feature
    OPENAI_API_VISION_DEPLOYMENT_NAME: Optional[str]
    IMAGE_LAYOUT_API_URL: AnyHttpUrl=None
    NUMBER_OF_IMAGE_WORKERS: int = None
    DOWNLOAD_RETRIES_PDF_NUMBER: int = None
    # azure_endpoint
    API_KEY_TEST : Optional[str]
    # Liste PHAC
    APPLICATION_INSIGHTS_LOG: bool = Field(env="APPLICATION_INSIGHTS_LOG", default=False,
                                           description="log to application insights")
    APPLICATIONINSIGHTS_CONNECTION_STRING: str = Field(env="APPLICATIONINSIGHTS_CONNECTION_STRING",
                                                       description="application insights connection string", default="")
    APPLICATION_INSIGHTS_LOG_CONFIG_PATH: str = Field(env="APPLICATION_INSIGHTS_LOG_CONFIG_PATH",
                                                      description="the path to the log config of applicationinsights",
                                                      default=r".\src\logger\app_insight_logging.json" )

    # CHUNKER AUTH
    CHUNKING_API_URL: str  # this api is used for style-aware chunking
    AUTH_CHUNKER_USERNAME: str
    AUTH_CHUNKER_PASSWORD: str
    # AUTh
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    SECRET_KEY: str
    ALGORITHM: str
    # Authentication Service URL
    AUTH_SERVICE_URL: str

    AZURE_AI_FOUNDRY_API_KEY :Optional[str] 
    AZURE_OCR_ENDPOINT:str

    SHARED_VOLUME_PREFIX: str

    PDF_API_URL: str
    LITELLM_BASE_URL : str
    LITELLM_API_KEY :str

    LLM_CLASSIFICATION_MODEL: str

    # Webhook Authentication
    WEBHOOK_API_KEY: Optional[str] = Field(
        default="",
        description="API key to include in webhook requests for client authentication"
    )

    # ═══════════════════════════════════════════════════════════════
    # Configuration Validators
    # ═══════════════════════════════════════════════════════════════

    @field_validator('PORT')
    @classmethod
    def validate_port(cls, v):
        """Validate that PORT is within valid range"""
        if not 1 <= v <= 65535:
            raise ValueError(f'PORT must be between 1 and 65535, got {v}')
        return v

    @field_validator('REDIS_PORT')
    @classmethod
    def validate_redis_port(cls, v):
        """Validate that REDIS_PORT is within valid range"""
        if not 1 <= v <= 65535:
            raise ValueError(f'REDIS_PORT must be between 1 and 65535, got {v}')
        return v

    @field_validator('REDIS_DB')
    @classmethod
    def validate_redis_db(cls, v):
        """Validate that REDIS_DB is within valid range"""
        if not 0 <= v <= 15:
            raise ValueError(f'REDIS_DB must be between 0 and 15, got {v}')
        return v

    @field_validator('LLM_TEMPERATURE')
    @classmethod
    def validate_temperature(cls, v):
        """Validate that LLM_TEMPERATURE is within valid range"""
        if not 0.0 <= v <= 2.0:
            raise ValueError(f'LLM_TEMPERATURE must be between 0.0 and 2.0, got {v}')
        return v

    @field_validator('LLM_MAX_TOKENS')
    @classmethod
    def validate_max_tokens(cls, v):
        """Validate that LLM_MAX_TOKENS is positive"""
        if v <= 0:
            raise ValueError(f'LLM_MAX_TOKENS must be positive, got {v}')
        if v > 128000:  # Max tokens for most models
            raise ValueError(f'LLM_MAX_TOKENS seems too large (max ~128000), got {v}')
        return v

    @field_validator('OPENAI_CHUNK_SIZE')
    @classmethod
    def validate_chunk_size(cls, v):
        """Validate that OPENAI_CHUNK_SIZE is reasonable"""
        if v <= 0:
            raise ValueError(f'OPENAI_CHUNK_SIZE must be positive, got {v}')
        if v > 10000:
            raise ValueError(f'OPENAI_CHUNK_SIZE seems too large, got {v}')
        return v

    @field_validator('OPENAI_MAX_RETRIES')
    @classmethod
    def validate_max_retries(cls, v):
        """Validate that OPENAI_MAX_RETRIES is reasonable"""
        if v < 0:
            raise ValueError(f'OPENAI_MAX_RETRIES cannot be negative, got {v}')
        if v > 10:
            raise ValueError(f'OPENAI_MAX_RETRIES seems too high, got {v}')
        return v

    @field_validator('MAX_QUEUE_LENGTH')
    @classmethod
    def validate_queue_length(cls, v):
        """Validate that MAX_QUEUE_LENGTH is positive"""
        if v <= 0:
            raise ValueError(f'MAX_QUEUE_LENGTH must be positive, got {v}')
        return v

    @field_validator('MAX_CONCURRENCY')
    @classmethod
    def validate_concurrency(cls, v):
        """Validate that MAX_CONCURRENCY is positive"""
        if v <= 0:
            raise ValueError(f'MAX_CONCURRENCY must be positive, got {v}')
        if v > 1000:
            raise ValueError(f'MAX_CONCURRENCY seems too high, got {v}')
        return v

    @field_validator('UVICORN_WORKERS')
    @classmethod
    def validate_workers(cls, v):
        """Validate that UVICORN_WORKERS is positive"""
        if v <= 0:
            raise ValueError(f'UVICORN_WORKERS must be positive, got {v}')
        if v > 100:
            raise ValueError(f'UVICORN_WORKERS seems too high, got {v}')
        return v

    @field_validator('ACCESS_TOKEN_EXPIRE_MINUTES')
    @classmethod
    def validate_token_expiry(cls, v):
        """Validate that ACCESS_TOKEN_EXPIRE_MINUTES is reasonable"""
        if v <= 0:
            raise ValueError(f'ACCESS_TOKEN_EXPIRE_MINUTES must be positive, got {v}')
        if v > 10080:  # 1 week in minutes
            raise ValueError(f'ACCESS_TOKEN_EXPIRE_MINUTES seems too long (max 1 week), got {v}')
        return v

    @field_validator('TMP_DELETE_N_SECONDS')
    @classmethod
    def validate_tmp_delete_interval(cls, v):
        """Validate that TMP_DELETE_N_SECONDS is reasonable"""
        if v < 60:  # Minimum 1 minute
            raise ValueError(f'TMP_DELETE_N_SECONDS should be at least 60 seconds, got {v}')
        if v > 86400:  # Maximum 24 hours
            raise ValueError(f'TMP_DELETE_N_SECONDS seems too long (max 24h), got {v}')
        return v

    @field_validator('NUMBER_OF_IMAGE_WORKERS')
    @classmethod
    def validate_image_workers(cls, v):
        """Validate that NUMBER_OF_IMAGE_WORKERS is reasonable if set"""
        if v is not None:
            if v <= 0:
                raise ValueError(f'NUMBER_OF_IMAGE_WORKERS must be positive, got {v}')
            if v > 50:
                raise ValueError(f'NUMBER_OF_IMAGE_WORKERS seems too high, got {v}')
        return v

    @field_validator('DOWNLOAD_RETRIES_PDF_NUMBER')
    @classmethod
    def validate_download_retries(cls, v):
        """Validate that DOWNLOAD_RETRIES_PDF_NUMBER is reasonable if set"""
        if v is not None:
            if v < 0:
                raise ValueError(f'DOWNLOAD_RETRIES_PDF_NUMBER cannot be negative, got {v}')
            if v > 250:
                raise ValueError(f'DOWNLOAD_RETRIES_PDF_NUMBER seems too high, got {v}')
        return v

    @field_validator('SECRET_KEY')
    @classmethod
    def validate_secret_key(cls, v):
        """Validate that SECRET_KEY is sufficiently long and secure"""
        if not v or len(v.strip()) == 0:
            raise ValueError('SECRET_KEY cannot be empty')
        if len(v) < 32:
            raise ValueError(f'SECRET_KEY should be at least 32 characters for security, got {len(v)}')
        return v

    @field_validator('ALGORITHM')
    @classmethod
    def validate_algorithm(cls, v):
        """Validate that ALGORITHM is a supported JWT algorithm"""
        supported_algorithms = ['HS256', 'HS384', 'HS512', 'RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512']
        if v not in supported_algorithms:
            raise ValueError(f'ALGORITHM must be one of {supported_algorithms}, got {v}')
        return v

    @field_validator('AZURE_DATALAKE_CONNECTION_STRING')
    @classmethod
    def validate_azure_connection_string(cls, v):
        """Validate that Azure connection string is not empty and has basic format"""
        if not v or len(v.strip()) == 0:
            raise ValueError('AZURE_DATALAKE_CONNECTION_STRING cannot be empty')
        if 'AccountName=' not in v or 'AccountKey=' not in v:
            raise ValueError('AZURE_DATALAKE_CONNECTION_STRING appears to be malformed')
        return v

    @field_validator('AZURE_STORAGE_ACCOUNT_KEY')
    @classmethod
    def validate_azure_storage_key(cls, v):
        """Validate that Azure storage key is not empty"""
        if not v or len(v.strip()) == 0:
            raise ValueError('AZURE_STORAGE_ACCOUNT_KEY cannot be empty')
        if len(v) < 20:
            raise ValueError('AZURE_STORAGE_ACCOUNT_KEY appears to be too short')
        return v

    @field_validator('EMBEDDING_DIMENSION')
    @classmethod
    def validate_embedding_dimension(cls, v):
        """Validate that EMBEDDING_DIMENSION is positive and within a reasonable range"""
        if v is None:
            raise ValueError(f'EMBEDDING_DIMENSION must be set')
        if not isinstance(v, int):
            raise ValueError(f'EMBEDDING_DIMENSION must be an integer, got {type(v).__name__}')
        if v <= 0:
            raise ValueError(f'EMBEDDING_DIMENSION must be positive, got {v}')
        if v > 16384:
            raise ValueError(f'EMBEDDING_DIMENSION seems too large (max 16384), got {v}')
        return v

    @field_validator('QDRANT_URL')
    @classmethod
    def validate_qdrant_url(cls, v):
        """Validate that Qdrant URL is not empty and has a valid format"""
        if not v or len(v.strip()) == 0:
            raise ValueError('QDRANT_URL cannot be empty')
        # Basic URL format check
        if not v.startswith(('http://', 'https://')):
            raise ValueError('QDRANT_URL must start with http:// or https://')
        return v

    @field_validator('LANGFUSE_PUBLIC_KEY', 'LANGFUSE_PRIVATE_KEY')
    @classmethod
    def validate_langfuse_keys(cls, v):
        """Validate that Langfuse keys are not empty"""
        if not v or len(v.strip()) == 0:
            raise ValueError('Langfuse keys cannot be empty')
        return v

    @field_validator('AUTH_CHUNKER_USERNAME', 'AUTH_CHUNKER_PASSWORD')
    @classmethod
    def validate_auth_credentials(cls, v):
        """Validate that authentication credentials are not empty"""
        if not v or len(v.strip()) == 0:
            raise ValueError('Authentication credentials cannot be empty')
        return v

    @field_validator('OPENAI_RETRY_MIN_SECONDS')
    @classmethod
    def validate_retry_min_seconds(cls, v):
        """Validate that OPENAI_RETRY_MIN_SECONDS is reasonable"""
        if v < 0:
            raise ValueError(f'OPENAI_RETRY_MIN_SECONDS cannot be negative, got {v}')
        if v > 300:  # 5 minutes max
            raise ValueError(f'OPENAI_RETRY_MIN_SECONDS seems too high, got {v}')
        return v

    @field_validator('OPENAI_RETRY_MAX_SECONDS')
    @classmethod
    def validate_retry_max_seconds(cls, v):
        """Validate that OPENAI_RETRY_MAX_SECONDS is reasonable"""
        if v < 1:
            raise ValueError(f'OPENAI_RETRY_MAX_SECONDS must be at least 1 second, got {v}')
        if v > 600:  # 10 minutes max
            raise ValueError(f'OPENAI_RETRY_MAX_SECONDS seems too high, got {v}')
        return v

    @model_validator(mode='after')
    def validate_ssl_configuration(self):
        """Validate that if SSL is configured, both keyfile and certfile are provided"""
        if (self.SSL_KEYFILE and not self.SSL_CERTFILE) or (self.SSL_CERTFILE and not self.SSL_KEYFILE):
            raise ValueError('Both SSL_KEYFILE and SSL_CERTFILE must be provided together')
        return self

    @model_validator(mode='after')
    def validate_paths_exist(self):
        """Validate that critical paths exist"""
        import os

        # Validate log config path if specified
        if self.LOG_CONFIG_PATH and not os.path.exists(self.LOG_CONFIG_PATH):
            raise ValueError(f'LOG_CONFIG_PATH does not exist: {self.LOG_CONFIG_PATH}')

        # Create temp folder if it doesn't exist
        if self.TEMP_FOLDER and not os.path.exists(self.TEMP_FOLDER):
            try:
                os.makedirs(self.TEMP_FOLDER, exist_ok=True)
            except Exception as e:
                raise ValueError(f'Failed to create TEMP_FOLDER: {self.TEMP_FOLDER}, error: {e}')

        # Validate SSL files if configured
        if self.SSL_KEYFILE and not os.path.exists(self.SSL_KEYFILE):
            raise ValueError(f'SSL_KEYFILE does not exist: {self.SSL_KEYFILE}')
        if self.SSL_CERTFILE and not os.path.exists(self.SSL_CERTFILE):
            raise ValueError(f'SSL_CERTFILE does not exist: {self.SSL_CERTFILE}')

        return self


@lru_cache()
def get_settings():
    """Function to get and cache settings.
    The settings are cached to avoid repeated disk I/O.
    """
    environment = os.getenv("ENVIRONMENT", "local")
    if environment == "local":
        return Settings(_env_file=".env")  # type: ignore
    # elif environment == "dev":
    #     return Settings(_env_file=".env.dev")
    elif environment == "dev":
        return Settings(_env_file=".env.dev")  # type: ignore
    elif environment == "prod":
        return Settings()  # type: ignore
    else:
        raise ValueError(f"Invalid environment: {environment}")
