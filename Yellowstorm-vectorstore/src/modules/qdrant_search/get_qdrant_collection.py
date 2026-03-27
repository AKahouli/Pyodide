"""Qdrant client initialization and collection management."""

from typing import Optional
from langchain_community.vectorstores import Qdrant
from langchain_community.docstore.document import Document
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


def get_qdrant_client() -> QdrantClient:
    """Get a singleton Qdrant client instance.

    Returns:
        QdrantClient: Configured Qdrant client instance.

    Raises:
        ValueError: If Qdrant URL or API key is not configured.
    """
    global _qdrant_client

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
        logger.info(f"Created Qdrant client for {qdrant_url}")

    return _qdrant_client


def get_qdrant_collection(
    collection_name: str,
    user_id: Optional[str] = "unknown",
    recreate_collection: bool = False,
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


def add_documents_batch_to_qdrant(
    collection_name: str,
    documents: list[Document],
    user_id: Optional[str] = "unknown",
) -> list[str]:
    """Add a batch of documents to Qdrant with custom payload structure.

    Payload structure:
    {
        "page_content": "text content",
        "metadata": {...},
        "type": "text" | "image"
    }

    Args:
        collection_name (str): Name of the collection.
        documents (list[Document]): List of langchain Documents to add.
        user_id (Optional[str]): User ID for embeddings. Defaults to "unknown".

    Returns:
        list[str]: List of added document IDs.
    """
    from qdrant_client.models import PointStruct
    from uuid import uuid4

    # Get embeddings and client
    embeddings = get_embeddings(user_id)
    client = get_qdrant_client()

    # Prepare points for upsert
    points = []
    for doc in documents:
        # Extract type from metadata or default to "text"
        doc_type = doc.metadata.get("type", "Document")

        # Create custom payload with 3 top-level fields
        payload = {
            "page_content": doc.page_content,
            "metadata": doc.metadata,
            "type": doc_type,
        }

        # Embed the page_content
        vector = embeddings.embed_query(doc.page_content)

        # Create point
        point = PointStruct(
            id=str(uuid4()),
            vector=vector,
            payload=payload,
        )
        points.append(point)

    # Upsert points in batch
    client.upsert(
        collection_name=collection_name,
        points=points,
    )

    # Return the point IDs
    added_ids = [point.id for point in points]
    logger.info(f"Added {len(added_ids)} documents to collection {collection_name}")
    return added_ids


def add_documents_to_qdrant(
    collection_name: str,
    documents: list[Document],
    user_id: Optional[str] = "unknown",
) -> list[str]:
    """Add documents to a Qdrant collection with custom payload structure.

    Payload structure:
    {
        "page_content": "text content",
        "metadata": {...},
        "type": "text" | "image"
    }

    Args:
        collection_name (str): Name of the collection.
        documents (list[Document]): List of langchain Documents to add.
        user_id (Optional[str]): User ID for embeddings. Defaults to "unknown".

    Returns:
        list[str]: List of added document IDs.
    """
    # Use the batch function (handles batching internally if needed)
    return add_documents_batch_to_qdrant(collection_name, documents, user_id)