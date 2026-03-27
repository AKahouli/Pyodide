from typing import Dict, Any, List, Optional
from src.modules.qdrant_search.querying import query_qdrant_search_index
from src.schema.fastapi.vectorstores.requests import (
    VectorstoreValidationError,
    VectorstoreSearchError
)


def query_collection_by_filter(
        collection_name: str,
        filter: Dict[str, Any],
        include: Optional[List[str]] = None,
        exclude: Optional[List[str]] = None,
):
    """
    Query a collection by filter

    Parameters
    ----------
    collection_name : str
        The name of the collection to query
    filter : Dict[str, Any]
        The filter to apply to the query
    include : Optional[List[str]], optional
        The columns to include in the results, by default None
    exclude : Optional[List[str]], optional
        The columns to exclude from the results, by default None

    Returns
    -------
    List[Dict[str, Any]]
        The results of the query
    """
    # Validate inputs
    if not collection_name or not collection_name.strip():
        raise VectorstoreValidationError(
            message="Collection name is required and cannot be empty",
            field="collection_name",
            details={"provided_value": collection_name}
        )
    
    try:
        return query_qdrant_search_index(
            collection_name=collection_name,
            filter=filter
        )
    except Exception as e:
        raise VectorstoreSearchError(
            message=f"Failed to query collection '{collection_name}'",
            search_operation="query_by_filter",
            details={
                "collection_name": collection_name,
                "filter": filter,
                "error": str(e)
            }
        )
