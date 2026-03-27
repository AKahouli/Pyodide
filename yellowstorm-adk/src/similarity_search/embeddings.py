"""Module for loading embeddings."""
from typing import Optional

from langchain_community.embeddings import FakeEmbeddings
from langchain_openai import OpenAIEmbeddings
from src.config.settings import get_settings
from src.logger.logging import get_logger

logger = get_logger(__name__)


def get_azure_openai_embeddings(user_id:Optional[str]) :
    logger.debug("Getting Azure OpenAI embeddings")
    settings = get_settings()
    return OpenAIEmbeddings(
        model=settings.EMBEDDING_MODEL,
        base_url=settings.LITELLM_API_BASE_URL,
        api_key="secret",
        default_headers={"Authorization": f'Bearer {settings.LITELLM_API_SECRET_KEY}'},
        model_kwargs={"user":user_id},
        chunk_size=settings.OPENAI_CHUNK_SIZE,
        max_retries=settings.OPENAI_MAX_RETRIES,
        retry_min_seconds=settings.OPENAI_RETRY_MIN_SECONDS,
        retry_max_seconds=settings.OPENAI_RETRY_MAX_SECONDS,
    )

def get_embeddings(user_id:Optional[str]="unknown"):
    """Get the embeddings."""
    logger.debug("Getting embedding model")
    settings = get_settings()
    if settings.FAKE_EMBEDDINGS:
        return FakeEmbeddings(size=1536)
    return get_azure_openai_embeddings(user_id=user_id)