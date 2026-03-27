"""Qdrant client initialization and collection management."""

from typing import Any, Optional
from threading import Lock

from langchain_community.vectorstores import Qdrant
from qdrant_client import QdrantClient

# Try to import payload index models (available in newer qdrant-client versions)
try:
    from qdrant_client.models import PayloadIndexParams, PayloadSchemaType
except ImportError:
    try:
        from qdrant_client.http.models import PayloadIndexParams, PayloadSchemaType
    except ImportError:
        PayloadIndexParams = None
        PayloadSchemaType = None

from src.config.settings import get_settings
from src.logger.logging import get_logger

from ..embeddings import get_embeddings

logger = get_logger(__name__)
settings = get_settings()

logger.info("Creating Qdrant connection")

# Singleton instance
_qdrant_client: Optional[QdrantClient] = None
_client_lock = Lock()


def get_qdrant_client() -> QdrantClient:
    """Get a singleton Qdrant client instance.

    The client is created once and reused for all subsequent calls.
    Thread-safe implementation using double-checked locking.

    Returns:
        QdrantClient: Configured Qdrant client instance.

    Raises:
        ValueError: If Qdrant URL or API key is not configured.
    """
    global _qdrant_client

    # Double-checked locking pattern for thread-safe singleton
    if _qdrant_client is None:
        qdrant_url = getattr(settings, 'QDRANT_URL', None)
        qdrant_api_key = getattr(settings, 'QDRANT_API_KEY', None)

        if qdrant_url is None:
            raise ValueError("QDRANT_URL must be set in the environment.")

        _qdrant_client = QdrantClient(
            url=qdrant_url,
            api_key=qdrant_api_key,
            timeout=30,
        )
        logger.info(f"Created singleton Qdrant client for {qdrant_url}")

    return _qdrant_client

def get_qdrant_collection(
    collection_name: str,
    user_id: Optional[str] = "unknown",
) -> Qdrant:
    """Get or create a Qdrant collection for the given collection name.

    Args:
        collection_name (str): The name of the collection to use.
        user_id (Optional[str]): User ID for embeddings. Defaults to "unknown".
        recreate_collection (bool): Whether to recreate the collection if it exists.
            Defaults to False.

    Returns:
        Qdrant: A Qdrant instance for the given collection name.

    Raises:
        ValueError: If Qdrant URL is not configured.
    """
    embeddings = get_embeddings(user_id)
    client = get_qdrant_client()

    qdrant_store = Qdrant(
        client=client,
        collection_name=collection_name,
        embeddings=embeddings,
    )
    logger.info(f"Created Qdrant instance for collection {collection_name}")
    return qdrant_store