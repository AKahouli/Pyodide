""" Reorder the results of a similarity search. """

from typing import List, Tuple

from langchain.schema import Document

from src.logger.logging import get_logger

logger = get_logger(__name__)


def reorder_search_results(
    results: List[Tuple[Document, float]],
    higher_is_better: bool = True,
) -> List[Tuple[Document, float]]:
    """
    Reorder the results of a search.

    Parameters
    ----------
    results : List[Tuple[Document, float]]
        List of tuples containing the document and the distance to the query
    higher_is_better : bool, optional
        Flag to indicate whether higher scores are better, by default True

    Returns
    -------
    List[Tuple[Document, float]]
        List of tuples containing the document and the distance to the query
    """
    logger.debug(f"Reordering search results with {len(results)} results and higher_is_better={higher_is_better}")
    if higher_is_better:
        return sorted(results, key=lambda x: x[1], reverse=True)
    return sorted(results, key=lambda x: x[1])