""" This module contains functions for multilingual similarity search. """

from typing import Any, Callable, Dict, List, Optional, Tuple

from langchain_core.documents import Document

from src.logger.logging import get_logger

from .reorder import reorder_search_results
from .vector_search.core import vector_search_with_relevance_scores, vector_search_with_score

logger = get_logger(__name__)


def multilingual_similarity_search(
    collection_name: str,
    query_dict: Dict[str, str],
    top_k: int = 4,
    filter: Optional[dict] = None,
    similarity_search_function: Callable = vector_search_with_score,
    similarity_search_function_kwargs: Optional[Dict[str, Any]] = None,
    user_id: str = "unknown"
) -> List[Tuple[Document, float]]:
    """
    Search for similar documents to multiple queries in different languages.

    Parameters
    ----------
    collection_name : str
        Name of the collection to search in
    query_dict : Dict[str, str]
        Dictionary containing queries in different languages
    top_k : int, optional
        Number of results to return for each query, by default 4
    filter : Optional[Dict], optional
        Filter to apply to the search, by default None
    similarity_search_function : Callable, optional
        Function to use for similarity search, by default similarity_search_with_score

    Returns
    -------
    List[List[Tuple[Document, float]]]
        List of lists containing tuples with the document and the distance to the query for each query
    """
    logger.info(f"Performing multilingual similarity search for queries {query_dict} in collection {collection_name}")
    if similarity_search_function not in [
        vector_search_with_score,
        vector_search_with_relevance_scores,
    ]:
        raise ValueError(
            "similarity_search_function must be one of similarity_search_with_score, similarity_search_with_relevance_scores or max_marginal_relevance_search_with_score"
        )

    if similarity_search_function_kwargs is None:
        similarity_search_function_kwargs = {}
    results = [
        similarity_search_function(collection_name, value, top_k, filter, user_id=user_id, **similarity_search_function_kwargs)
        for value in query_dict.values()
    ]
    logger.info(f"Received {len(results)} results")
    logger.debug(f"Results: {results}")
    unpacked_results = []
    for result in results:
        unpacked_results.extend(result)
    logger.debug(f"Unpacked results: {unpacked_results}")
    if similarity_search_function == vector_search_with_relevance_scores:
        return reorder_search_results(unpacked_results)
    return reorder_search_results(unpacked_results, higher_is_better=False)
