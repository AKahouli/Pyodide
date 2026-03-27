from typing import Annotated

from fastapi import APIRouter, HTTPException, status, Depends

from src.authentification.get_current_user import get_current_active_user
from src.logger.logging import get_logger
from src.middleware.correlation import get_user
from src.schema.authentification_schema import User
from src.schema.similarity_search_schema import SimilaritySearchRequest
from src.similarity_search.worker_functions import (
    similarity_search_with_score_task_async
)

logger = get_logger("api.main")

router = APIRouter(
    prefix="/similarity-search",
    tags=["similarity-search"],
)


@router.post("/similarity-search-with-score")
async def similarity_search_route(request: SimilaritySearchRequest,
                                  current_user: Annotated[User, Depends(get_current_active_user)]):
    """
    Search for similar documents with status-aware routing.

    Status-aware routing (handled in worker_functions.py):
    - PENDING/FAILED documents → Redis BM25 search
    - COMPLETED documents → Qdrant vector search
    - Results combined from both sources

    BM25 OR fallback:
    - Multi-word queries first try AND logic (all tokens must match)
    - If AND returns 0 results, automatic fallback to OR logic (any token matches)
    - Example: "machine learning" → tries "machine AND learning", falls back to "machine OR learning"

    Request:
        - collection_name: Qdrant collection name ("vectorstoredev")
        - query: Search query text
        - top_k: Maximum results to return
        - filter: Optional filters including brain_id, external_id, keywords

    Returns:
        List of (Document dict, score) tuples with _source metadata:
        - _source: "redis_bm25" or "qdrant_vector"
        - _search_method: "bm25_fulltext_search" or "vector_similarity_search"

    Behavior:
        1. If no brain_id in filter: Standard Qdrant vector search
        2. If brain_id but no document statuses: Standard Qdrant vector search
        3. If brain_id with document statuses: Status-aware routing
           - Scans Redis for document statuses (doc_status/{brain_id}/*)
           - PENDING/FAILED → Redis BM25 full-text search
           - COMPLETED → Qdrant vector similarity search
           - Combines and sorts results by score
    """
    logger.info(f"Similarity search request for collection: {request.collection_name}")
    try:
        # Validate required fields
        if not request.collection_name or not request.collection_name.strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "error_code": "VALIDATION_ERROR",
                    "message": "Collection name is required and cannot be empty",
                    "details": {"field": "collection_name", "provided_value": request.collection_name}
                }
            )

        if not request.query or not request.query.strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "error_code": "VALIDATION_ERROR",
                    "message": "Query is required and cannot be empty",
                    "details": {"field": "query", "provided_value": request.query}
                }
            )

        if request.top_k <= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "error_code": "VALIDATION_ERROR",
                    "message": "Top k must be a positive integer",
                    "details": {"field": "top_k", "provided_value": request.top_k}
                }
            )

        # Get user from context
        user_id = get_user()
        logger.info(f"Similarity search request from user: {user_id}")

        result = await similarity_search_with_score_task_async(
            request.collection_name, request.query, request.top_k, request.filter, user_id
        )
        return result

    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
    except Exception as e:
        logger.exception(f"Unexpected error in similarity_search_route: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "error_code": "UNEXPECTED_ERROR",
                "message": "An unexpected error occurred during similarity search",
                "details": {"error": str(e)}
            }
        )