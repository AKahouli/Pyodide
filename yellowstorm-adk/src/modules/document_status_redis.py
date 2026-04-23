"""Document status Redis client for ADK.

This module provides read-only access to document status stored in Redis.
Used by status-aware search routing to determine which search method to use:
- PENDING/FAILED → Redis BM25 search
- COMPLETED → Qdrant vector search
"""
import asyncio
import json
from typing import Any, Dict, List, Optional

import redis.asyncio as aioredis

from src.logger.logging import get_logger

logger = get_logger(__name__)


class DocumentStatus:
    """Document processing status enum.

    Status Flow:
        IMPORTED → PENDING → COMPLETED
                         └─→ FAILED
    """
    IMPORTED = "IMPORTED"  # Document received from UI
    PENDING = "PENDING"    # Chunks in Redis, Qdrant indexing in progress
    COMPLETED = "COMPLETED"  # Qdrant verified, Redis chunks deleted
    FAILED = "FAILED"      # Indexing failed, Redis chunks kept for retry


class DocumentStatusRedis:
    """Redis client for reading document status (ADK read only with no status modif unlike vectorstore).

    This is a simplified read only version of the DocumentStatusRedis class
    from the vectorstores repo. It only implements read
    operations needed for status-aware search routing.

    Key Patterns (Hierarchical):
        - Status: "doc_status/{brain_id}/{external_id}" (STRING with JSON value)
        - Chunks: "chunk:{brain_id}:{external_id}:{chunk_order}" (JSON documents)

    Status Flow: IMPORTED → PENDING → COMPLETED/FAILED

    Example:
          from src.modules.redis_connection import get_redis_connection
          r = await get_redis_connection()
          client = DocumentStatusRedis(r)
          status = await client.get_status_async("brain_123", "doc_456")
          print(status["status"])
        'PENDING'
    """

    def __init__(self, redis_client: aioredis.Redis):
        """Initialize with async Redis client.

        Args:
            redis_client: Async Redis client instance
        """
        self.r = redis_client

    def _make_key(self, brain_id: str, external_id: str) -> str:
        """Create Redis key for document status.

        Args:
            brain_id: Brain identifier
            external_id: Document external identifier

        Returns:
            Redis key string
        """
        return f"doc_status/{brain_id}/{external_id}"

    async def get_status_async(
        self,
        brain_id: str,
        external_id: str
    ) -> Optional[Dict[str, Any]]:
        """Get document status from Redis (async version).

        Args:
            brain_id: Brain identifier
            external_id: Document external identifier

        Returns:
            Status dict with keys: brain_id, external_id, status, metrics, created_at, updated_at
            Returns None if not found
        """
        key = self._make_key(brain_id, external_id)
        if self.r is None:
            return None
        try:
            data = await self.r.get(key)
            if data:
                return json.loads(data)
        except Exception as e:
            logger.warning(f"Failed to get status for {key}: {e}")
        return None
    #for testing or future sync contexts (not used for now)
    def get_all_statuses_for_brain(
        self,
        brain_id: str
    ) -> Dict[str, List[str]]:
        """Get all document statuses for a brain, grouped by status (sync version).

        Scans all document status keys for the given brain and groups them by status.

        Args:
            brain_id: Brain identifier

        Returns:
            Dict with status names as keys and lists of external_ids as values:
            {
                "PENDING": ["doc1", "doc2"],
                "COMPLETED": ["doc3"],
                "FAILED": ["doc4"],
                "IMPORTED": ["doc5"]
            }
            Returns empty dict if no statuses found
        """
        pattern = f"doc_status/{brain_id}/*"
        status_groups = {
            DocumentStatus.IMPORTED: [],
            DocumentStatus.PENDING: [],
            DocumentStatus.COMPLETED: [],
            DocumentStatus.FAILED: [],
        }

        try:
            keys = list(self.r.scan_iter(match=pattern, count=1000))
            for key in keys:
                key_str = key.decode() if isinstance(key, bytes) else key
                try:
                    data = self.r.get(key)
                    if data:
                        status_data = json.loads(data)
                        status = status_data.get("status")
                        external_id = status_data.get("external_id")
                        if status and external_id and status in status_groups:
                            status_groups[status].append(external_id)
                except Exception as e:
                    logger.debug(f"Failed to parse status key {key_str}: {e}")
        except Exception as e:
            logger.error(f"Failed to scan statuses for brain {brain_id}: {e}")

        return status_groups

    async def get_all_statuses_for_brain_async(
        self,
        brain_id: str
    ) -> Dict[str, List[str]]:
        """Get all document statuses for a brain, grouped by status (async version).

        Scans all document status keys for the given brain and groups them by status.

        Args:
            brain_id: Brain identifier

        Returns:
            Dict with status names as keys and lists of external_ids as values:
            {
                "PENDING": ["doc1", "doc2"],
                "COMPLETED": ["doc3"],
                "FAILED": ["doc4"],
                "IMPORTED": ["doc5"]
            }
            Returns empty dict if no statuses found
        """
        pattern = f"doc_status/{brain_id}/*"
        status_groups = {
            DocumentStatus.IMPORTED: [],
            DocumentStatus.PENDING: [],
            DocumentStatus.COMPLETED: [],
            DocumentStatus.FAILED: [],
        }

        try:
            keys = []
            async for key in self.r.scan_iter(match=pattern, count=1000):
                keys.append(key)

            for key in keys:
                key_str = key.decode() if isinstance(key, bytes) else key
                try:
                    data = await self.r.get(key)
                    if data:
                        status_data = json.loads(data)
                        status = status_data.get("status")
                        external_id = status_data.get("external_id")
                        if status and external_id and status in status_groups:
                            status_groups[status].append(external_id)
                except Exception as e:
                    logger.debug(f"Failed to parse status key {key_str}: {e}")
        except Exception as e:
            logger.error(f"Failed to scan statuses for brain {brain_id}: {e}")

        return status_groups


async def get_status_client() -> DocumentStatusRedis:
    """Convenience function to get a DocumentStatusRedis client.

    Creates a new Redis connection and returns the status client.

    Returns:
        DocumentStatusRedis instance

    Example:
          client = await get_status_client()
          statuses = await client.get_all_statuses_for_brain_async("brain_123")
    """
    from src.modules.redis_connection import get_redis_connection
    r = await get_redis_connection()
    return DocumentStatusRedis(r)
