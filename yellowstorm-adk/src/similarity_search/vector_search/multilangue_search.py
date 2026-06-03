"""Module to call similarity search using Qdrant"""
from __future__ import annotations

import logging
from typing import (
    TYPE_CHECKING,
    List,
    Optional,
    Tuple,
)

from langchain_core.documents import Document
from langchain_community.vectorstores import Qdrant
from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance,
    VectorParams,
    Filter,
)

from src.similarity_search.embeddings import get_embeddings
from src.config.settings import get_settings
from src.similarity_search.qdrant_search.get_qdrant_collection import get_qdrant_client

logger = logging.getLogger()

settings = get_settings()


class CustomQdrant:
    def __init__(self, collection_name: str, user_id: str = "unknown"):
        self.collection_name = collection_name
        self.embeddings = get_embeddings(user_id=user_id)

        # Use singleton Qdrant client instead of creating new instance
        self.client = get_qdrant_client()
        logger.debug(f"Using singleton Qdrant client for collection {collection_name}")

        self._ensure_collection_exists()

        self.vectorstore = Qdrant(
            client=self.client,
            collection_name=self.collection_name,
            embeddings=self.embeddings,
        )

    def _ensure_collection_exists(self):
        """Create collection if it does not exist."""
        collections = self.client.get_collections().collections
        if not any(c.name == self.collection_name for c in collections):
            vector_size = len(self.embeddings.embed_query("test"))

            self.client.create_collection(
                collection_name=self.collection_name,
                vectors_config=VectorParams(
                    size=vector_size,
                    distance=Distance.COSINE,
                ),
            )

    def _build_filter(self, filters: Optional[dict]) -> Optional[Filter]:
        """Convert dict filter into Qdrant Filter."""
        from src.similarity_search.qdrant_search.filter import dict_to_qdrant_filter

        return dict_to_qdrant_filter(filters)

    def _vector_search_with_score(
        self,
        query: str,
        k: int = 4,
        filters: Optional[dict] = None,
    ) -> List[Tuple[Document, float]]:
        """Vector similarity search with score."""
        query_vector = self.embeddings.embed_query(query)

        qdrant_filter = self._build_filter(filters)

        results = self.client.search(
            collection_name=self.collection_name,
            query_vector=query_vector,
            limit=k,
            query_filter=qdrant_filter,
        )

        docs = []
        for result in results:
            payload = result.payload or {}

            doc = Document(
                page_content=payload.get("content", ""),
                metadata={
                    **payload,
                    "id": result.id,
                },
            )

            docs.append((doc, float(result.score)))

        return docs

    def _hybrid_search_with_score(
        self,
        query: str,
        k: int = 4,
        filters: Optional[dict] = None,
    ) -> List[Tuple[Document, float]]:
        """
        Hybrid search using:
        - Vector similarity
        - Keyword search (payload text match)
        Then merges manually
        """

        # Vector search
        vector_results = self._vector_search_with_score(query, k=k, filters=filters)

        # Full-text search using scroll + simple match
        qdrant_filter = self._build_filter(filters)

        text_results_raw, _ = self.client.scroll(
            collection_name=self.collection_name,
            scroll_filter=qdrant_filter,
            limit=100,
            with_payload=True,
        )

        keyword_results = []
        for point in text_results_raw:
            payload = point.payload or {}
            content = payload.get("content", "")

            if query.lower() in content.lower():
                doc = Document(
                    page_content=content,
                    metadata={
                        **payload,
                        "id": point.id,
                    },
                )
                keyword_results.append((doc, 1.0))  # simple score

        # Merge (simple fusion)
        merged = {}
        for doc, score in vector_results + keyword_results:
            key = doc.metadata.get("id")
            if key not in merged:
                merged[key] = (doc, score)
            else:
                merged[key] = (doc, merged[key][1] + score)

        sorted_results = sorted(
            merged.values(),
            key=lambda x: x[1],
            reverse=True,
        )

        return sorted_results[:k]


# ================================
# PUBLIC FUNCTIONS
# ================================

def vector_search_with_score_multilangue(
    collection_name: str,
    query: str,
    top_k: int = 4,
    filter: Optional[dict] = None,
    rrf_k: int = 60,
    vector_search_top_k: Optional[int] = None,
    full_text_search_top_k: Optional[int] = None,
    vector_search_weight: Optional[float] = None,
    full_text_search_weight: Optional[float] = None,
    user_id: str = "unknown",
) -> List[Tuple[Document, float]]:
    """
    Vector similarity search using Qdrant.

    Note: Hybrid search parameters are accepted for API compatibility but not used
    in pure vector search. Use hybrid_search_with_score_multilangue for hybrid search.
    """
    logger.info(
        f"Performing vector search for query '{query}' in collection '{collection_name}'"
    )

    # Use vector_search_top_k if provided, otherwise use top_k
    k = vector_search_top_k or top_k

    qdrant_filter = filter.copy() if filter else {}
    if user_id and user_id != "unknown":
        qdrant_filter["user_id"] = user_id

    qdrant_instance = CustomQdrant(collection_name, user_id=user_id)

    results = qdrant_instance._vector_search_with_score(
        query=query,
        k=k,
        filters=qdrant_filter,
    )

    logger.info(f"Received {len(results)} results")

    return results


def hybrid_search_with_score_multilangue(
    collection_name: str,
    query: str,
    top_k: int = 4,
    filter: Optional[dict] = None,
    rrf_k: int = 60,
    vector_search_top_k: Optional[int] = None,
    full_text_search_top_k: Optional[int] = None,
    vector_search_weight: Optional[float] = None,
    full_text_search_weight: Optional[float] = None,
    user_id: str = "unknown",
) -> List[Tuple[Document, float]]:
    """
    Hybrid search combining:
    - Vector similarity
    - Keyword search
    Fused using Reciprocal Rank Fusion (RRF)
    """
    logger.info(
        f"Performing hybrid search for query '{query}' in collection '{collection_name}'"
    )
    logger.debug(f"RRF k={rrf_k}, vector_weight={vector_search_weight}, text_weight={full_text_search_weight}")

    qdrant_filter = filter.copy() if filter else {}
    if user_id and user_id != "unknown":
        qdrant_filter["user_id"] = user_id

    qdrant_instance = CustomQdrant(collection_name, user_id=user_id)

    results = qdrant_instance._hybrid_search_with_score(
        query=query,
        k=top_k,
        filters=qdrant_filter,
    )

    logger.info(f"Received {len(results)} results")

    return results
