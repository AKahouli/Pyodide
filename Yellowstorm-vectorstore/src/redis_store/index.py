"""Redis BM25 index management using raw Redis commands."""
from typing import Dict, Any

from src.logger.logging import get_logger

logger = get_logger(__name__)

# Index configuration
INDEX_NAME = "idx:chunks"
KEY_PREFIX = "chunk:"


async def create_bm25_index(
    redis_client,
    index_name: str = INDEX_NAME,
    key_prefix: str = KEY_PREFIX
) -> bool:
    """Create BM25 full-text search index on Redis using raw commands.

    This uses FT.CREATE with raw Redis commands for maximum compatibility
    and control.

    Args:
        redis_client: Redis client instance
        index_name: Name of the search index
        key_prefix: Key prefix for documents to index

    Returns:
        bool: True if index created or already exists

    Raises:
        Exception: If index creation fails
    """
    try:
        # Check if index exists using FT.INFO
        try:
            info = await redis_client.execute_command("FT.INFO", index_name)
            num_docs = info[1][info[0].index('num_docs')] if info else 0
            logger.info(f"✅ Index '{index_name}' already exists with {num_docs} documents")
            return True
        except Exception as e:
            if "Unknown index name" not in str(e):
                raise
            # Index doesn't exist, create it

        # Create index using FT.CREATE raw command
        logger.info(f"Creating RediSearch index '{index_name}'...")

        await redis_client.execute_command(
            "FT.CREATE", index_name,
            "ON", "JSON",
            "PREFIX", "1", key_prefix,
            "SCHEMA",
            # Text field (main content)
            "$.page_content", "AS", "content", "TEXT",
            # Tag fields for exact filtering
            "$.metadata.brain_id", "AS", "brain_id", "TAG",
            "$.metadata.external_id", "AS", "external_id", "TAG",
            "$.metadata.source", "AS", "source", "TAG",
            # Numeric fields
            "$.metadata.page", "AS", "page", "NUMERIC",
            "$.metadata.chunk_order", "AS", "chunk_order", "NUMERIC",
            "$.metadata.split_length", "AS", "split_length", "NUMERIC",
            "$.metadata.split_overlap", "AS", "split_overlap", "NUMERIC",
            # Tag field for language
            "$.metadata.language", "AS", "language", "TAG",
        )

        logger.info(f"✅ RediSearch index '{index_name}' created with prefix '{key_prefix}'")
        return True

    except Exception as e:
        logger.error(f"❌ Failed to create BM25 index: {e}")
        raise


async def drop_bm25_index(
    redis_client,
    index_name: str = INDEX_NAME
) -> bool:
    """Drop the BM25 index.

    WARNING: This doesn't delete the documents, only the index.

    Args:
        redis_client: Redis client instance
        index_name: Name of index to drop

    Returns:
        bool: True if dropped successfully
    """
    try:
        await redis_client.execute_command("FT.DROPINDEX", index_name, "DD")
        logger.info(f"✅ Dropped index: {index_name}")
        return True
    except Exception as e:
        logger.error(f"❌ Failed to drop index: {e}")
        return False


async def get_index_info(
    redis_client,
    index_name: str = INDEX_NAME
) -> Dict[str, Any]:
    """Get information about the index.

    Args:
        redis_client: Redis client instance
        index_name: Name of index

    Returns:
        Dict with index stats
    """
    try:
        info = await redis_client.execute_command("FT.INFO", index_name)

        # Parse FT.INFO response - returns a flat list: [key1, val1, key2, val2, ...]
        result = {}
        if info and len(info) >= 2:
            for i in range(0, len(info) - 1, 2):
                key = info[i]
                value = info[i + 1]
                result[key] = value

        return {
            "num_docs": int(result.get("num_docs", 0)),
            "indexing_time": float(result.get("indexing_time", 0)),
            "index_name": result.get("index_name", index_name),
            "fields": result.get("attributes", []),
        }

    except Exception as e:
        logger.error(f"❌ Failed to get index info: {e}")
        return {}