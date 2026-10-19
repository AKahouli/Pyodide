"""Module for loading embeddings."""
from functools import lru_cache
import math
from typing import Optional

import httpx

from src.config.settings import get_settings
from src.logger.logging import get_logger
from src.modules.model_security import model_http_client

logger = get_logger(__name__)


def prepare_embedding(vector):
    """Match ingestion's optional Matryoshka prefix reduction and normalization."""
    settings = get_settings()
    if not all(isinstance(value, (int, float)) and not isinstance(value, bool)
               and math.isfinite(value) for value in vector):
        raise ValueError("Embedding contains non-numeric or non-finite values")
    if settings.EMBEDDING_MATRYOSHKA and len(vector) > settings.EMBEDDING_DIMENSION:
        vector = vector[:settings.EMBEDDING_DIMENSION]
    if len(vector) != settings.EMBEDDING_DIMENSION:
        raise ValueError(
            f"Embedding has {len(vector)} dimensions; expected {settings.EMBEDDING_DIMENSION}. "
            "Match the ingestion model and EMBEDDING_MATRYOSHKA settings.")
    norm = math.hypot(*vector)
    if not norm or not math.isfinite(norm):
        raise ValueError("Embedding has a zero or non-finite norm")
    return [value / norm for value in vector]


def embedding_configured(settings):
    return bool(settings.LITELLM_BASE_URL and settings.LITELLM_API_KEY)


@lru_cache(maxsize=1)
def get_azure_openai_embeddings():
    settings = get_settings()
    from langchain_openai import OpenAIEmbeddings

    if not embedding_configured(settings):
        raise RuntimeError("Set LITELLM_BASE_URL and LITELLM_API_KEY")
    http_client = model_http_client(settings, timeout=settings.EMBEDDING_TIMEOUT_SECONDS)
    return OpenAIEmbeddings(
        model=settings.OPENAI_MODEL,
        base_url=settings.LITELLM_BASE_URL,
        api_key=settings.LITELLM_API_KEY,
        # Qwen expects raw text rather than OpenAI-tokenizer token IDs.
        check_embedding_ctx_length=False,
        chunk_size=settings.OPENAI_CHUNK_SIZE,
        # A blocking SDK retry cannot be cancelled after the request deadline.
        # Higher-level search fallback is bounded by the shared deadline.
        max_retries=0,
        timeout=settings.EMBEDDING_TIMEOUT_SECONDS,
        retry_min_seconds=settings.OPENAI_RETRY_MIN_SECONDS,
        retry_max_seconds=settings.OPENAI_RETRY_MAX_SECONDS,
        http_client=http_client,
    )


def get_embeddings(username: Optional[str] = "unknown"):
    """Get the embeddings."""
    logger.debug("Getting embedding model")
    return get_azure_openai_embeddings()


def close_embeddings() -> None:
    """Close the shared embedding connection pool."""
    if not get_azure_openai_embeddings.cache_info().currsize:
        return
    embeddings = get_azure_openai_embeddings()
    http_client = getattr(embeddings, "http_client", None)
    if http_client is not None:
        http_client.close()
    get_azure_openai_embeddings.cache_clear()
