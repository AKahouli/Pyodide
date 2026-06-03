"""Querying data using Qdrant."""

import json
from typing import Any, Dict, List, Optional

from qdrant_client.models import Filter, ScoredPoint

from src.config.settings import get_settings
from src.logger.logging import get_logger

from .filter import dict_to_qdrant_filter, build_exclusion_filter
from .get_qdrant_collection import get_qdrant_collection

settings = get_settings()
logger = get_logger(__name__)


def format_query_results(results: List[ScoredPoint], collection_name: str) -> List[Dict[str, Any]]:
    """Format Qdrant query results to match the expected output format.

    Args:
        results (List[ScoredPoint]): Raw Qdrant search results.
        collection_name (str): Name of the collection.

    Returns:
        List[Dict[str, Any]]: Formatted results matching the Azure Search format.
    """
    formatted_results = []

    for result in results:
        formatted_result = {
            "_index": collection_name,
            "_id": result.id,
            "_score": result.score,
            "_source": {
                "text": result.payload.get("content", ""),
                "metadata": result.payload.get("metadata", {}),
            },
        }
        formatted_results.append(formatted_result)

    return formatted_results


def query_qdrant_search_index(
    collection_name: str,
    filter: Optional[Dict[str, Any]] = None,
    query_text: Optional[str] = None,
    limit: int = 10,
    score_threshold: Optional[float] = None,
) -> List[Dict[str, Any]]:
    """Query a collection of documents in Qdrant.

    Args:
        collection_name (str): The name of the collection to query.
        filter (Optional[Dict[str, Any]]): Dictionary containing filter conditions.
        query_text (Optional[str]): Query text for similarity search.
            If None, performs a filter-only search.
        limit (int): Maximum number of results to return. Defaults to 10.
        score_threshold (Optional[float]): Minimum score threshold for results.

    Returns:
        List[Dict[str, Any]]: A list of documents matching the query.

    Examples:
        >>> # Filter only search
        >>> results = query_qdrant_search_index(
        ...     "my_collection",
        ...     filter={"workspace_id": "workspace123"}
        ... )

        >>> # Similarity search with filters
        >>> results = query_qdrant_search_index(
        ...     "my_collection",
        ...     filter={"file_name": "report.pdf"},
        ...     query_text="search query",
        ...     limit=5
        ... )
    """
    from .get_qdrant_collection import get_qdrant_collection

    qdrant_store = get_qdrant_collection(collection_name)
    client = qdrant_store.client

    # Build Qdrant filter from dictionary
    qdrant_filter = dict_to_qdrant_filter(filter)

    # Handle ID exclusions if present in filter
    if filter and "ids" in filter and isinstance(filter["ids"], list):
        from .filter import build_exclusion_filter
        exclusion_filter = build_exclusion_filter(filter["ids"])
        if qdrant_filter:
            # Combine filters
            if hasattr(qdrant_filter, 'must') and qdrant_filter.must:
                # Merge the existing must conditions with must_not
                if not hasattr(qdrant_filter, 'must_not'):
                    qdrant_filter.must_not = []
                qdrant_filter.must_not.extend(exclusion_filter.must_not)
        else:
            qdrant_filter = exclusion_filter

    logger.info(f"Querying collection {collection_name} with filter: {filter}")

    # Perform the search using LangChain's similarity_search
    if query_text:
        # Similarity search with optional filters
        # Convert filter dict to kwargs for LangChain
        search_kwargs = {"k": limit}
        if score_threshold:
            search_kwargs["score_threshold"] = score_threshold
        if qdrant_filter:
            search_kwargs["filter"] = qdrant_filter

        # Use LangChain's similarity_search_with_score
        results = qdrant_store.similarity_search_with_score(query_text, **search_kwargs)

        # Convert LangChain results to expected format
        formatted_results = [
            {
                "_index": collection_name,
                "_id": str(result[0].metadata.get("id", "")),
                "_score": result[1],
                "_source": {
                    "text": result[0].page_content,
                    "metadata": result[0].metadata,
                },
            }
            for result in results
        ]
    else:
        # Filter-only search (no vector query) - use scroll
        if qdrant_filter:
            results = client.scroll(
                collection_name=collection_name,
                scroll_filter=qdrant_filter,
                limit=limit,
                with_payload=True,
            )[0]
        else:
            # Get all documents (no filter, no query)
            results = client.scroll(
                collection_name=collection_name,
                limit=limit,
                with_payload=True,
            )[0]

        formatted_results = format_query_results(results, collection_name)

    logger.info(f"Found {len(formatted_results)} results")
    return formatted_results


def similarity_search_with_score(
    collection_name: str,
    query_text: str,
    filter: Optional[Dict[str, Any]] = None,
    k: int = 4,
    score_threshold: Optional[float] = None,
) -> List[tuple[Dict[str, Any], float]]:
    """Perform similarity search with scores.

    Args:
        collection_name (str): The name of the collection to query.
        query_text (str): Query text for similarity search.
        filter (Optional[Dict[str, Any]]): Optional filter conditions.
        k (int): Number of results to return. Defaults to 4.
        score_threshold (Optional[float]): Minimum score threshold.

    Returns:
        List[tuple[Dict[str, Any], float]]: List of (document, score) tuples.
    """
    qdrant_store = get_qdrant_collection(collection_name)

    # Use LangChain's similarity_search_with_score method
    search_kwargs = {"k": k}
    if score_threshold:
        search_kwargs["score_threshold"] = score_threshold

    # Build and apply filter if provided
    qdrant_filter = dict_to_qdrant_filter(filter)
    if qdrant_filter:
        search_kwargs["filter"] = qdrant_filter

    results = qdrant_store.similarity_search_with_score(query_text, **search_kwargs)

    # Format results as (document, score) tuples
    formatted_results = [
        (
            {
                "id": str(doc[0].metadata.get("id", "")),
                "content": doc[0].page_content,
                "metadata": doc[0].metadata,
            },
            doc[1],
        )
        for doc in results
    ]

    return formatted_results


def get_documents_by_ids(
    collection_name: str,
    ids: List[str],
) -> List[Dict[str, Any]]:
    """Retrieve documents by their IDs.

    Args:
        collection_name (str): The name of the collection.
        ids (List[str]): List of document IDs to retrieve.

    Returns:
        List[Dict[str, Any]]: List of documents.
    """
    qdrant_store = get_qdrant_collection(collection_name)
    client = qdrant_store.client

    results = client.retrieve(
        collection_name=collection_name,
        ids=ids,
        with_payload=True,
    )

    formatted_results = [
        {
            "id": str(result.id),
            "content": result.payload.get("content", ""),
            "metadata": result.payload.get("metadata", {}),
        }
        for result in results
    ]

    return formatted_results
