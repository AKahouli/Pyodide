"""Similarity search module with Qdrant."""
import json
from typing import List, Optional, Tuple
from langchain_core.documents import Document

from qdrant_client import QdrantClient

from src.config.settings import get_settings
from src.logger.logging import get_logger
from src.similarity_search.embeddings import get_embeddings
from src.similarity_search.qdrant_search.get_qdrant_collection import get_qdrant_client

logger = get_logger(__name__)
settings = get_settings()

def vector_search_with_score(
    collection_name: str,
    query: str,
    top_k: int = 4,
    filter: Optional[dict] = None,
    user_id: str = "unknown",
) -> List[Tuple[Document, float]]:
    """
    Search for similar documents to a query using Qdrant.

    Parameters
    ----------
    collection_name : str
        Name of collection to search in
    query : str
        Query to search for
    top_k : int, optional
        Number of results to return, by default 4
    filter : Optional[dict], optional
        Filter to apply to search, by default None
    user_id : str, optional
        User ID for embeddings, by default "unknown"

    Returns
    -------
    List[Tuple[Document, float]]
        List of tuples containing document and distance to query
    """
    logger.info(f"Performing similarity search with score for query '{query}' in collection '{collection_name}' for user '{user_id}'")
    logger.debug(f"Using singleton Qdrant client for search")

    # Get embeddings
    embeddings = get_embeddings(user_id)

    # Get singleton Qdrant client (reuses existing connection)
    client = get_qdrant_client()

    # Embed query
    query_vector = embeddings.embed_query(query)

    # Build HYBRID Qdrant filter
    from src.similarity_search.qdrant_search.filter import dict_to_qdrant_filter

    # 👉 Automatically add keywords for hybrid search
    hybrid_filter = filter.copy() if filter else {}
    if user_id and user_id != "unknown":
        hybrid_filter["user_id"] = user_id
    # If the caller did NOT explicitly pass keywords,
    # derive them from the query (simple + effective)
    if "keywords" not in hybrid_filter:
        hybrid_filter["keywords"] = query.split()

    qdrant_filter = dict_to_qdrant_filter(hybrid_filter)

    # Vector + hybrid search
    search_result = client.query_points(
        collection_name=collection_name,
        query=query_vector,
        limit=top_k,
        query_filter=qdrant_filter,
        with_payload=True,
        with_vectors=False,
    )
    # Convert Qdrant results to LangChain format (Document, score)

    results: List[Tuple[Document, float]] = []

    for point in search_result.points:
        payload = point.payload or {}

        raw_metadata = payload.get("metadata", {})

        if isinstance(raw_metadata, str):
            try:
                metadata = json.loads(raw_metadata)
            except json.JSONDecodeError:
                metadata = {}
        else:
            metadata = raw_metadata

        doc = Document(
            page_content=payload.get("page_content", ""),
            metadata=metadata,
        )

        results.append((doc, point.score))

    logger.info(f"Received {len(results)} results")
    logger.debug(f"Results: {results}")
    return results


def vector_search_with_relevance_scores(
    collection_name: str,
    query: str,
    top_k: int = 4,
    filter: Optional[dict] = None,
    user_id: str = "unknown",
) -> List[Tuple[Document, float]]:
    """
    Search for similar documents to a query using Qdrant.

    Parameters
    ----------
    collection_name : str
        Name of collection to search in
    query : str
        Query to search for
    top_k : int, optional
        Number of results to return, by default 4
    filter : Optional[dict], optional
        Filter to apply to search, by default None
    user_id : str, optional
        User ID for embeddings, by default "unknown"

    Returns
    -------
    List[Tuple[Document, float]]
        List of tuples containing document and distance to query
    """
    # For now, same as vector_search_with_score
    return vector_search_with_score(collection_name, query, top_k, filter, user_id)
