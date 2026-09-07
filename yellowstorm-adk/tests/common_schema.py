from typing import Optional, List

from pydantic import BaseModel


class MockSettings(BaseModel):
    TEMP_FOLDER: str = "./mock_tmp"
    HOST: str = "localhost"
    PORT: int = 8009
    SSL_KEYFILE: Optional[str] = None
    SSL_CERTFILE: Optional[str] = None
    LOG_CONFIG_PATH: str = "./src/logger/mock_uvicorn_disable_logging.json"
    TIMEOUT_KEEP_ALIVE: int = 5
    UVICORN_WORKERS: int = 1

    # Azure Storage
    AZURE_STORAGE_ACCOUNT: str = "mock_storage_account"
    AZURE_STORAGE_ACCOUNT_KEY: str = "mock_storage_key"
    AZURE_DATALAKE_CONNECTION_STRING: str = "DefaultEndpointsProtocol=https;AccountName=mock_account;AccountKey=mock_key;EndpointSuffix=core.windows.net"
    AZURE_DATALAKE_FILE_SYSTEM_NAME: str = "mock_file_system"
    DATABASE_URL: str = "sqlite+aiosqlite:///./test.db"
    LANGGRAPH_CHECKPOINT_SCHEMA: str = "langgraph_checkpoints"
    LANGGRAPH_CHECKPOINT_POOL_MIN_SIZE: int = 1
    LANGGRAPH_CHECKPOINT_POOL_MAX_SIZE: int = 2
    LANGGRAPH_CHECKPOINT_POOL_TIMEOUT_SECONDS: float = 5.0
    lINKUP_API_KEY: str = "mock_lookup_api_key"
    WEB_SEARCH_PROMPT: str = "mock_web_search_prompt"
    API_URL: str = "https://mock_api_url"
    API_ADK_URL: str = "https://mock_api_adk_url"
    LITELLM_API_BASE_URL: str = "https://mock_litellm_api_base_url"
    LITELLM_API_SECRET_KEY: str = "mock_litellm_api_secret_key"
    ATTRIBUT_EXTRACT_MODEL: str = "gpt-4.1"
    MICROSANDBOX_MCP_URL: Optional[str] = "https://mock_microsandbox_mcp_url"
    MICROSANDBOX_DOCUMENT_SERVER_URL: Optional[str] = "https://mock_microsandbox_document_server_url"
    MICROSANDBOX_DOCKER_IMAGE: Optional[str] = "mock_microsandbox_docker_image"
    MAX_CONCURRENCY: int = 10
    MAX_QUEUE_LENGTH: int = 100
    APPLICATION_INSIGHTS_LOG: bool = False
    DD_TRACE_ENABLED: bool = False
    APPLICATIONINSIGHTS_CONNECTION_STRING: Optional[str] = None
    APPLICATION_INSIGHTS_LOG_CONFIG_PATH: str = "./src/logger/mock_app_insight_logging.json"

    # Authentication to get token
    AUTH_USERNAME: str = "mock_user"
    AUTH_PASSWORD: str = "mock_password"
    # Redis
    ENABLE_REDIS_SSL: bool = False
    REDIS_HOST: str = "localhost"
    REDIS_PORT: int = 6379
    REDIS_DB: int = 0
    REDIS_USER: Optional[str] = None
    REDIS_PASSWORD: Optional[str] = None
    # Celery Configuration
    CELERY_BROKER_URL: Optional[str] = None
    CELERY_RESULT_BACKEND: Optional[str] = None
    CELERY_WORKER_CONCURRENCY: int = 4
    SECRET_KEY: str = "mock_secret"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    ADK_API_KEY: str = "mock_adk_api_key"
    VECTORSTORE_API_KEY: str = "mock_vectorstore_api_key"
    QDRANT_COLLECTION_NAME: Optional[str] = "mock_qdrant_collection"
    EMBEDDING_DIMS: int = 2560
    # Ollama
    OLLAMA_API_BASE_URL: Optional[str] = "mock_ollama_api_base_url"
    OLLAMA_API_KEY: Optional[str] = "mock_ollama_api_key"
    # memory
    AZURE_AI_SEARCH_MEM_COLLECTION_NAME: str = "mock_ai_search_mem_collection"
    MEMORY_MODEL: str = "gpt-4.1-mini"

    # OpenAI Settings for embeddings
    EMBEDDING_MODEL: str = "text-embedding-ada-002"
    OPENAI_CHUNK_SIZE: int = 1000
    OPENAI_MAX_RETRIES: int = 3
    OPENAI_RETRY_MIN_SECONDS: int = 2
    OPENAI_RETRY_MAX_SECONDS: int = 20

    # Embedding Configuration
    FAKE_EMBEDDINGS: bool = False
    ENABLE_POSTGRESQL_LOGGING: bool = True
    POSTGRESQL_LOG_BATCH_SIZE: int = 10
    POSTGRESQL_LOG_FLUSH_INTERVAL: float = 5.0
    POSTGRESQL_LOG_POOL_SIZE: int = 5
    POSTGRESQL_LOG_MAX_OVERFLOW: int = 10

    # Database Connection Pool Settings
    DB_MAX_CONNECTIONS: int = 3000
    DB_POOL_SIZE: int = 100
    DB_POOL_MAX_OVERFLOW: int = 50
    DB_POOL_TIMEOUT: int = 5
    DB_POOL_RECYCLE: int = 1800
    DB_POOL_AUTO_SCALE: bool = True

    # Neo4j
    NEO4J_HOST: Optional[str] = "bolt://localhost:7687"
    NEO4J_USER: Optional[str] = "mock_neo4j_user"
    NEO4J_PASSWORD: Optional[str] = "mock_neo4j_password"
    CSRD_BRAIN_ID: Optional[str] = "ABC"

    DEFAULT_HTML_AGENT_ENABLED: bool = False

    # Code Interpreter Backend
    CODE_INTERPRETER_BACKEND_URL: Optional[str] = None

    BASE64_LIST_ENABLED_BRAIN_IDS: List[str] = ["67c99ad236081d40c152c23d"]
