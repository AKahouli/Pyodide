"""Chunk storage for Redis BM25 indexing.

This module handles storing document chunks in Redis with automatic BM25 indexing.
Chunks are automatically indexed when stored due to the idx:chunks index prefix.

"""
import json
from typing import Any, Dict, List

from src.logger.logging import get_logger
from .index import create_bm25_index

logger = get_logger(__name__)

# Index configuration
INDEX_NAME = "idx:chunks"
KEY_PREFIX = "chunk:"


async def store_chunks_in_redis(
    redis_client,
    brain_id: str,
    external_id: str,
    chunks: List[Dict[str, Any]],
    update_status_to_pending: bool = True,
) -> int:
    """Store document chunks in Redis with automatic BM25 indexing.

    Chunks are automatically indexed because:
    1. Key matches index prefix: "chunk:{brain_id}:{external_id}:{order}"
    2. Index has prefix="chunk:" which matches all chunk keys

    Args:
        redis_client: Redis client instance
        brain_id: Collection/brain identifier
        external_id: Document identifier
        chunks: List of chunk dictionaries with page_content and metadata
        update_status_to_pending: Whether to update status to PENDING after storing

    Returns:
        Number of chunks stored
    """
    # Ensure BM25 index exists
    try:
        await create_bm25_index(redis_client, index_name=INDEX_NAME, key_prefix=KEY_PREFIX)
        logger.info(f"✅ RediSearch index '{INDEX_NAME}' ready")
    except Exception as e:
        logger.warning(f"⚠️  Could not verify BM25 index: {e}")

    # Store chunks in Redis
    indexed_count = 0
    for chunk in chunks:
        md = chunk.get("metadata", {})
        chunk_brain_id = md.get("brain_id", brain_id)
        chunk_external_id = md.get("external_id", external_id)
        chunk_order = md.get("chunk_order", 0)

        key = f"{KEY_PREFIX}{chunk_brain_id}:{chunk_external_id}:{chunk_order}"

        # JSON.SET automatically indexes the chunk
        await redis_client.json().set(key, "$", chunk)
        indexed_count += 1

    logger.info(f"✅ Stored {indexed_count} chunks in Redis BM25")

    # Update status to PENDING after Redis indexing (if requested)
    if update_status_to_pending:
        from .status import DocumentStatusRedis
        from src.schema.vectorstores.document_status import DocumentStatus
        redis_store = DocumentStatusRedis(redis_client)
        try:
            redis_store.update_status(
                brain_id=brain_id,
                external_id=external_id,
                status=DocumentStatus.PENDING,
                metrics={"indexed_chunks": indexed_count}
            )
            logger.info(f"✅ Status updated to PENDING for {external_id}")
        except Exception as e:
            logger.warning(f"⚠️  Could not update status to PENDING: {e}")

    return indexed_count


async def get_chunks_from_redis(
    redis_client,
    brain_id: str,
    external_id: str,
) -> List[Dict[str, Any]]:
    """Retrieve all chunks for a document from Redis.

    Args:
        redis_client: Redis client instance
        brain_id: Collection/brain identifier
        external_id: Document identifier

    Returns:
        List of chunk dictionaries
    """
    pattern = f"{KEY_PREFIX}{brain_id}:{external_id}:*"
    chunks = []

    async for key in redis_client.scan_iter(match=pattern):
        try:
            chunk_data = await redis_client.json().get(key)
            if chunk_data:
                chunks.append(chunk_data)
        except Exception as e:
            logger.warning(f"Failed to retrieve chunk from {key}: {e}")
            continue

    # Sort by chunk_order
    chunks.sort(key=lambda x: x.get("metadata", {}).get("chunk_order", 0))
    return chunks


async def delete_chunks_from_redis(
    redis_client,
    brain_id: str,
    external_id: str,
) -> int:
    """Delete all BM25 chunks for a document from Redis.

    Chunks are stored with the pattern: "chunk:{brain_id}:{external_id}:{chunk_order}"

    Args:
        redis_client: Redis client instance
        brain_id: Collection/brain identifier
        external_id: Document identifier

    Returns:
        Number of chunks deleted
    """
    pattern = f"{KEY_PREFIX}{brain_id}:{external_id}:*"
    keys = []

    async for key in redis_client.scan_iter(match=pattern):
        keys.append(key)

    if not keys:
        logger.info(f"No chunks found to delete for {external_id} in brain {brain_id}")
        return 0

    # Delete all chunks
    for key in keys:
        await redis_client.delete(key)

    deleted_count = len(keys)
    logger.info(f"✅ Deleted {deleted_count} chunks for {external_id} in brain {brain_id}")
    return deleted_count


async def count_chunks_in_redis(
    redis_client,
    brain_id: str,
    external_id: str,
) -> int:
    """Count the number of chunks stored for a document.

    Args:
        redis_client: Redis client instance
        brain_id: Collection/brain identifier
        external_id: Document identifier

    Returns:
        Number of chunks
    """
    pattern = f"{KEY_PREFIX}{brain_id}:{external_id}:*"
    count = 0

    async for _ in redis_client.scan_iter(match=pattern):
        count += 1

    return count
