"""Chunk retrieval service for Qdrant operations."""

from typing import Dict, List, Any, Optional

from qdrant_client.models import Filter, FieldCondition, MatchValue, MatchText

from src.config.settings import get_settings
from src.logger.logging import get_logger
from .get_qdrant_collection import get_qdrant_client

settings = get_settings()
logger = get_logger(__name__)


class ChunkRetrievalService:
    """Service for retrieving chunks from Qdrant by external_id."""

    def __init__(self, collection_name: str, username: str):
        """
        Initialize the chunk retrieval service.

        Args:
            collection_name: Name of the Qdrant collection
            username: Username for authentication and tracking
        """
        self.collection_name = collection_name
        self.username = username
        self.client = get_qdrant_client()
        self.logger = get_logger(__name__)

    def get_chunks_content_by_external_id(
        self,
        external_id: str,
        include_images: bool = False,
        chunk_filter: Optional[Dict[str, Any]] = None,
        sheet_name: Optional[str] = None,
    ) -> Dict[str, Dict[str, Any]]:
        """
        Retrieve chunk content directly by external_id.

        Args:
            external_id: External ID of the document
            include_images: Whether to include image chunks
            chunk_filter: Optional filters for specific chunks
            sheet_name: Optional sheet name to filter chunks by (for spreadsheet documents)

        Returns:
            Dict[str, Dict[str, Any]]:
                {
                    "chunk_id_1": {"content": "...", "metadata": {...}},
                    "chunk_id_2": {"content": "...", "metadata": {...}},
                    ...
                }

        Raises:
            ValueError: If no chunks found for external_id
            Exception: If Qdrant query fails
        """
        try:
            # Build filter conditions
            filter_conditions = [
                FieldCondition(
                    key="external_id",
                    match=MatchValue(value=external_id),
                )
            ]

            # Add image filtering if specified
            if not include_images:
                # Exclude chunks where metadata.type is "image"
                # Note: This requires the metadata to be structured properly
                filter_conditions.append(
                    FieldCondition(
                        key="metadata.type",
                        match=MatchValue(value="image"),
                    )
                )
                # Use must_not for exclusion
                qdrant_filter = Filter(must=filter_conditions[:-1], must_not=[filter_conditions[-1]])
            else:
                qdrant_filter = Filter(must=filter_conditions)

            # Add sheet name filtering if specified
            if sheet_name:
                sheet_filter = Filter(
                    must=[
                        FieldCondition(
                            key="metadata.sheet_name",
                            match=MatchText(text=sheet_name),
                        )
                    ]
                )
                # Combine with existing filter
                if qdrant_filter.must:
                    qdrant_filter.must.extend(sheet_filter.must)
                else:
                    qdrant_filter = sheet_filter

            # Add custom filters if provided
            if chunk_filter:
                qdrant_filter = self._build_custom_filter(qdrant_filter, chunk_filter)

            self.logger.info(f"Retrieving chunks for external_id: {external_id}")
            self.logger.info(f"Filter: {qdrant_filter}")

            # Execute scroll to get matching points
            results, _ = self.client.scroll(
                collection_name=self.collection_name,
                scroll_filter=qdrant_filter,
                limit=1000,  # Adjust based on expected document size
                with_payload=True,
            )

            # Transform results to expected format
            chunks_data = {}
            for result in results:
                chunk_id = str(result.id)
                chunks_data[chunk_id] = {
                    "content": result.payload.get("content", ""),
                    "metadata": result.payload.get("metadata", {}),
                }

            self.logger.info(f"Retrieved {len(chunks_data)} chunks for external_id: {external_id}")

            if not chunks_data:
                raise ValueError(f"No chunks found for external_id: {external_id}")

            return chunks_data

        except Exception as e:
            self.logger.error(f"Error retrieving chunks for external_id {external_id}: {str(e)}")
            raise

    def get_chunk_ids_by_external_id(
        self,
        external_id: str,
        include_images: bool = False,
    ) -> List[str]:
        """
        Get only chunk IDs (when needed for compatibility).

        Args:
            external_id: External ID of the document
            include_images: Whether to include image chunks

        Returns:
            List[str]: List of chunk IDs
        """
        try:
            filter_conditions = [
                FieldCondition(
                    key="external_id",
                    match=MatchValue(value=external_id),
                )
            ]

            if not include_images:
                # Exclude images
                qdrant_filter = Filter(
                    must=filter_conditions,
                    must_not=[
                        FieldCondition(
                            key="metadata.type",
                            match=MatchValue(value="image"),
                        )
                    ],
                )
            else:
                qdrant_filter = Filter(must=filter_conditions)

            results, _ = self.client.scroll(
                collection_name=self.collection_name,
                scroll_filter=qdrant_filter,
                limit=1000,
                with_payload=False,  # Only get IDs
            )

            chunk_ids = [str(result.id) for result in results]
            self.logger.info(f"Found {len(chunk_ids)} chunk IDs for external_id: {external_id}")

            return chunk_ids

        except Exception as e:
            self.logger.error(f"Error retrieving chunk IDs for external_id {external_id}: {str(e)}")
            raise

    def get_chunks_count_by_external_id(
        self,
        external_id: str,
        include_images: bool = False,
    ) -> int:
        """
        Get count of chunks for external_id.

        Args:
            external_id: External ID of the document
            include_images: Whether to include image chunks

        Returns:
            int: Number of chunks found
        """
        try:
            filter_conditions = [
                FieldCondition(
                    key="external_id",
                    match=MatchValue(value=external_id),
                )
            ]

            if not include_images:
                # Exclude images
                qdrant_filter = Filter(
                    must=filter_conditions,
                    must_not=[
                        FieldCondition(
                            key="metadata.type",
                            match=MatchValue(value="image"),
                        )
                    ],
                )
            else:
                qdrant_filter = Filter(must=filter_conditions)

            # Use count API for efficiency
            count = self.client.count(
                collection_name=self.collection_name,
                count_filter=qdrant_filter,
            )

            chunk_count = count.count
            self.logger.info(f"Found {chunk_count} chunks for external_id: {external_id}")

            return chunk_count

        except Exception as e:
            self.logger.error(f"Error getting chunk count for external_id {external_id}: {str(e)}")
            return 0

    def _build_custom_filter(
        self,
        base_filter: Filter,
        chunk_filter: Dict[str, Any],
    ) -> Filter:
        """
        Build custom filter from filter parameters.

        Args:
            base_filter: Base filter object
            chunk_filter: Additional filter parameters

        Returns:
            Filter: Combined filter object
        """
        if not base_filter.must:
            base_filter.must = []

        if "language" in chunk_filter:
            base_filter.must.append(
                FieldCondition(
                    key="language",
                    match=MatchValue(value=chunk_filter["language"]),
                )
            )

        if "brain_id" in chunk_filter:
            base_filter.must.append(
                FieldCondition(
                    key="metadata.brain_id",
                    match=MatchValue(value=chunk_filter["brain_id"]),
                )
            )

        # Content length filtering - needs to be done after retrieval
        # as Qdrant doesn't support string length filtering natively

        return base_filter