"""Document status tracking for Redis BM25 indexing.

This module provides status tracking for documents during the indexing process.
Status flow: IMPORTED → PENDING → COMPLETED/FAILED

"""
import json
from datetime import timezone, datetime
from typing import Any, Dict, Optional

from src.logger.logging import get_logger
from src.schema.vectorstores.document_status import DocumentStatus

logger = get_logger(__name__)

# Redis key patterns
DOC_STATUS_KEY_PREFIX = "doc_status"
DOC_PAGE_KEY_PREFIX = "doc_page"


class DocumentStatusRedis:
    """Redis storage for document status tracking.

    Key Patterns (Hierarchical):
        - Status: "doc_status/{brain_id}/{external_id}"
        - Pages: "doc_page/{brain_id}/{external_id}:{page_number}"

    No TTL - entries persist until explicitly deleted
    """

    # Valid status transitions (forward only)
    # IMPORTED → PENDING → COMPLETED/FAILED
    #redis stores strings so we need string values
    _VALID_TRANSITIONS = {
        DocumentStatus.IMPORTED.value: [DocumentStatus.PENDING.value, DocumentStatus.FAILED.value],
        DocumentStatus.PENDING.value: [DocumentStatus.COMPLETED.value, DocumentStatus.FAILED.value],
        DocumentStatus.COMPLETED.value: [],  # Final(special) state - no transitions allowed
        DocumentStatus.FAILED.value: [],  # Final state
    }

    def __init__(self, redis_client):
        """Initialize the Redis store.

        Args:
            redis_client: Redis connection instance (sync or async)
        """
        self.r = redis_client

    def _make_key(self, brain_id: str, external_id: str) -> str:
        """Generate Redis key for document status using folder structure.

        Args:
            brain_id: Brain ID for the document
            external_id: External document ID

        Returns:
            Redis key string: "doc_status/{brain_id}/{external_id}"
        """
        return f"{DOC_STATUS_KEY_PREFIX}/{brain_id}/{external_id}"

    def _make_page_key(self, brain_id: str, external_id: str, page_number: int) -> str:
        """Generate Redis key for a document page using folder structure.

        Args:
            brain_id: Brain ID for the document
            external_id: External document ID
            page_number: Page number (1-indexed)

        Returns:
            Redis key string: "doc_page/{brain_id}/{external_id}:{page_number}"
        """
        return f"{DOC_PAGE_KEY_PREFIX}/{brain_id}/{external_id}:{page_number}"

    def _make_page_hash_key(self, brain_id: str, external_id: str) -> str:
        """Generate Redis hash key for all pages using folder structure.

        Args:
            brain_id: Brain ID for the document
            external_id: External document ID

        Returns:
            Redis hash key string: "doc_page/{brain_id}/{external_id}"
        """
        return f"{DOC_PAGE_KEY_PREFIX}/{brain_id}/{external_id}"

    def save_imported_status(
        self,
        brain_id: str,
        external_id: str,
        file_path: str,
        vectorstore_name: Optional[str] = None,
        source: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        """Save IMPORTED status when document is first received from UI.

        This is the initial state before the document is queued for processing.

        Key format: "doc_status/{brain_id}/{external_id}"
        Example: "doc_status/brain_001/doc_123"

        Note: The "/" creates visual folders in Redis GUI tools,
        but in Redis this is just a STRING key, not a HASH.

        Args:
            brain_id: Brain ID for the document
            external_id: External document ID
            file_path: Path to the document file in storage
            vectorstore_name: Optional vector store name
            source: Optional source identifier (e.g., filename, URL)
            metadata: Optional additional metadata
        """
        key = self._make_key(brain_id, external_id)
        now = datetime.now(timezone.utc).isoformat()
        data = {
            "external_id": external_id,
            "brain_id": brain_id,
            "vectorstore_name": vectorstore_name,
            "status": DocumentStatus.IMPORTED,
            "file_path": file_path,
            "source": source,
            "metadata": metadata or {},
            "created_at": now,
            "updated_at": now,
        }
        # Store as STRING key with JSON value (NOT hash)
        self.r.set(key, json.dumps(data))
        logger.info(f"✅ Saved IMPORTED status for {external_id} in brain {brain_id} at {key}")

    def save_initial_status(
        self,
        brain_id: str,
        external_id: str,
        task_id: Optional[str] = None,
        file_path: Optional[str] = None,
        vectorstore_name: Optional[str] = None,
    ) -> None:
        """Save initial PENDING status when indexing starts.

        Args:
            brain_id: Brain ID for the document
            external_id: External document ID
            task_id: Celery task ID
            file_path: Path to the document file
            vectorstore_name: Name of the vector store
        """
        key = self._make_key(brain_id, external_id)
        now = datetime.now(timezone.utc).isoformat()
        data = {
            "external_id": external_id,
            "brain_id": brain_id,
            "vectorstore_name": vectorstore_name,
            "status": DocumentStatus.PENDING,
            "task_id": task_id,
            "file_path": file_path,
            "created_at": now,
            "updated_at": now,
        }
        self.r.set(key, json.dumps(data))
        logger.info(f"✅ Saved PENDING status for {external_id} in brain {brain_id}")

    def get_status(
        self,
        brain_id: str,
        external_id: str,
    ) -> Optional[Dict[str, Any]]:
        """Get document status from Redis.

        Args:
            brain_id: Brain ID for the document
            external_id: External document ID

        Returns:
            Dictionary with document status data, or None if not found
        """
        key = self._make_key(brain_id, external_id)
        data = self.r.get(key)
        if not data:
            return None
        return json.loads(data)

    def update_status(
        self,
        brain_id: str,
        external_id: str,
        status: str,
        metrics: Optional[Dict[str, Any]] = None,
        force: bool = False,
    ) -> bool:
        """Update document status with validation.

        Only allows forward status transitions to prevent race conditions:
        - IMPORTED → PENDING → COMPLETED/FAILED
        - IMPORTED → FAILED (edge case for early failures)
        - **Any status → COMPLETED** (verification override - allows retry recovery)
        - Backward transitions (COMPLETED → PENDING) are blocked

        The COMPLETED status is special - when verification succeeds, it overrides
        any previous status (including FAILED) to support retry scenarios.

        Args:
            brain_id: Brain ID for the document
            external_id: External document ID
            status: New document status (IMPORTED, PENDING, COMPLETED, FAILED)
            metrics: Optional metrics to update
            force: If True, skip validation (use with caution)

        Returns:
            True if updated successfully, False if key not found or transition blocked
        """
        key = self._make_key(brain_id, external_id)
        existing = self.r.get(key)
        if not existing:
            logger.warning(f"Cannot update status - key not found: {key}")
            return False

        data = json.loads(existing)
        current_status_str = data.get("status")

        # Parse current status
        try:
            current_status = current_status_str
            valid_next_statuses = self._VALID_TRANSITIONS.get(current_status, [])
        except (KeyError, TypeError):
            current_status = None
            valid_next_statuses = []

        # Validate transition if current status is known and not forcing
        if current_status and not force:
            # Special case: Allow transition to COMPLETED from any state
            # Verification success is the source of truth and should override previous failures
            if status == DocumentStatus.COMPLETED.value:
                logger.info(
                    f"✅ Verification succeeded: Updating {external_id} in brain {brain_id} "
                    f"from {current_status} → {status} (verification overrides previous status)"
                )
            else:
                # Normal transition validation for non-COMPLETED statuses
                if status not in valid_next_statuses:
                    logger.warning(
                        f"⚠️  Blocked invalid status transition for {external_id} in brain {brain_id}: "
                        f"{current_status} → {status}. "
                        f"Valid transitions: {valid_next_statuses}"
                    )
                    return False
                logger.info(
                    f"✅ Valid status transition for {external_id} in brain {brain_id}: "
                    f"{current_status} → {status}"
                )

        data["status"] = status
        data["updated_at"] = datetime.now(timezone.utc).isoformat()
        if metrics:
            existing_metrics = data.get("metrics", {})
            existing_metrics.update(metrics)
            data["metrics"] = existing_metrics

        self.r.set(key, json.dumps(data))
        return True

    def delete_document(
        self,
        brain_id: str,
        external_id: str,
    ) -> Dict[str, Any]:
        """Delete document status and all associated pages.

        Args:
            brain_id: Brain ID for the document
            external_id: External document ID

        Returns:
            Dictionary with deletion results
        """
        key = f"{DOC_STATUS_KEY_PREFIX}/{brain_id}/{external_id}"
        raw = self.r.get(key)
        status_deleted = False
        if raw:
            status_deleted = self.delete_status_by_key(key)

        # Delete pages using folder structure
        pages_deleted = self.delete_all_pages(brain_id, external_id)

        return {
            "status_deleted": status_deleted,
            "pages_deleted": pages_deleted,
        }

    def delete_status_by_key(self, key: str) -> bool:
        """Delete status by exact key.

        Args:
            key: Exact Redis key

        Returns:
            True if deleted, False if key not found
        """
        result = self.r.delete(key)
        return result > 0

    def delete_all_pages(
        self,
        brain_id: str,
        external_id: str,
    ) -> int:
        """Delete all pages for a document using folder structure.

        Args:
            brain_id: Brain ID for the document
            external_id: External document ID

        Returns:
            Number of pages deleted
        """
        # Try hash format first
        hash_key = self._make_page_hash_key(brain_id, external_id)
        hash_exists = self.r.exists(hash_key)
        if hash_exists:
            result = self.r.delete(hash_key)
            if result > 0:
                return result

        # Fall back to individual keys
        pattern = f"{DOC_PAGE_KEY_PREFIX}/{brain_id}/{external_id}:*"
        keys = list(self.r.scan_iter(match=pattern, count=100))
        if not keys:
            return 0
        return self.r.delete(*keys)

    def delete_chunks(
        self,
        brain_id: str,
        external_id: str,
    ) -> int:
        """Delete all BM25 chunks for a document from Redis.

        Chunks are stored with the pattern: "chunk:{brain_id}:{external_id}:{chunk_order}"

        Args:
            brain_id: Brain ID for the document
            external_id: External document ID

        Returns:
            Number of chunks deleted
        """
        KEY_PREFIX = "chunk:"
        pattern = f"{KEY_PREFIX}{brain_id}:{external_id}:*"
        keys = list(self.r.scan_iter(match=pattern, count=1000))
        if not keys:
            logger.info(f"No chunks found to delete for {external_id} in brain {brain_id}")
            return 0
        deleted_count = self.r.delete(*keys)
        logger.info(f"✅ Deleted {deleted_count} chunks for {external_id} in brain {brain_id}")
        return deleted_count

    def get_all_statuses_for_brain(
        self,
        brain_id: str,
    ) -> Dict[str, list[str]]:
        """Get all document statuses for a brain/collection.

        Args:
            brain_id: Collection/brain identifier

        Returns:
            Dict with status -> [external_ids] mapping
            Example:
            {
                "PENDING": ["doc1", "doc2"],
                "COMPLETED": ["doc3"],
                "FAILED": ["doc4"]
            }
        """
        pattern = f"{DOC_STATUS_KEY_PREFIX}/{brain_id}/*"
        statuses = {
            DocumentStatus.PENDING: [],
            DocumentStatus.COMPLETED: [],
            DocumentStatus.FAILED: []
        }

        for key in self.r.scan_iter(match=pattern):
            try:
                data = self.r.get(key)
                if data:
                    doc_data = json.loads(data)
                    status = doc_data.get("status")
                    ext_id = doc_data.get("external_id")
                    if status in statuses and ext_id:
                        statuses[status].append(ext_id)
            except Exception as e:
                logger.warning(f"Failed to read status from {key}: {e}")
                continue

        return statuses