"""Similarity search worker functions (non-Celery) for api-metachatbot-adk."""

from asyncio import to_thread
from functools import wraps
from typing import Callable, List, Optional, Tuple

from langchain.schema import Document

from src.logger.logging import get_logger

from . import (
    hybrid_search_with_score,
    hybrid_search_with_score_multilangue,
    vector_search_with_score,
    vector_search_with_score_multilangue,
)

logger = get_logger(__name__)


def similarity_search_decorator(async_mode: bool = False):
    """
    Decorator for similarity search tasks.

    Args:
        async_mode (bool): Whether the decorated function is asynchronous.
    """

    def decorator(similarity_search_function: Callable):
        @wraps(similarity_search_function)
        async def async_similarity_search_task(*args, **kwargs):
            """
            An async task for similarity search.
            """
            result = await similarity_search_function(*args, **kwargs)
            return [(document.model_dump(), score) for document, score in result]

        @wraps(similarity_search_function)
        def sync_similarity_search_task(*args, **kwargs):
            """
            A sync task for similarity search.
            """
            result = similarity_search_function(*args, **kwargs)
            return [(document.dict(), score) for document, score in result]

        if async_mode:
            return async_similarity_search_task
        else:
            return sync_similarity_search_task

    return decorator


@similarity_search_decorator(async_mode=False)
def similarity_search_with_score_task(
        collection_name: str, query: str, top_k: int, filter: dict, user_id: str = "unknown"
) -> List[Tuple[Document, float]]:
    """
    A task for similarity search with score
    """
    return vector_search_with_score(collection_name, query, top_k, filter, user_id)


@similarity_search_decorator(async_mode=True)
async def similarity_search_with_score_task_async(
        collection_name: str, query: str, top_k: int, filter: dict, user_id: str = "unknown"
) -> List[Tuple[Document, float]]:
    """
    An async task for similarity search with score

    Uses status-aware routing for brains with PENDING/FAILED documents in Redis.
    - PENDING/FAILED documents → Redis BM25 search
    - COMPLETED documents → Qdrant vector search
    - Results combined from both sources
    """
    from src.modules.redis_connection import get_redis_connection
    from src.modules.document_status_redis import DocumentStatusRedis
    from src.modules.redis_bm25_search import search_bm25

    # Extract brain_ids and external_ids from filter
    brain_ids = []
    external_ids = None

    # DEBUG: Log the filter to see what we're getting
    logger.info(f"[DEBUG] Filter value: {filter}")

    if filter:
        brain_id_list = filter.get("brain_id")
        # Support multiple brain_ids
        if brain_id_list and isinstance(brain_id_list, list) and len(brain_id_list) > 0:
            brain_ids = brain_id_list
            logger.info(f"[DEBUG] Extracted brain_ids: {brain_ids}")

        external_id_list = filter.get("external_id")
        if external_id_list:
            external_ids = external_id_list if isinstance(external_id_list, list) else [external_id_list]
            logger.info(f"[DEBUG] Extracted external_ids: {external_ids}")
    else:
        logger.warning("[DEBUG] Filter is None or empty - no brain_id found")

    # If no brain_ids, use standard Qdrant search (non-brain collection)
    if not brain_ids:
        logger.info(f"Standard Qdrant search (no brain_id in filter)")
        result = await to_thread(vector_search_with_score, collection_name, query, top_k, filter, user_id)
        # Add source metadata
        for doc, score in result:
            #adding those by our search layer as internal fields (not from original doc)
            doc.metadata["_source"] = "qdrant_vector"
            doc.metadata["_search_method"] = "vector_similarity_search"
        logger.info(
            "STANDARD QDRANT SEARCH | collection=%s | brain_ids=%s | query='%s' | total=%d",
            collection_name,
            brain_ids,
            query[:50] + "..." if len(query) > 50 else query,
            len(result),
        )
        return result

    # Check if any brain has status tracking
    # edge case where Redis connection failure: Fallback Qdrant only
    try:
        r = await get_redis_connection()
        status_client = DocumentStatusRedis(r)

        # Scan for document statuses across all brain_ids
        has_statuses = False
        for brain_id in brain_ids:
            pattern = f"doc_status/{brain_id}/*"
            async for _ in r.scan_iter(match=pattern, count=1):# need to find only 1 status
                has_statuses = True
                break
            if has_statuses:
                break

        # edge case no document statuses found: standard search
        if not has_statuses:
            logger.info(f"Standard Qdrant search (no document statuses found for brain_ids '{brain_ids}')")
            result = await to_thread(vector_search_with_score, collection_name, query, top_k, filter, user_id)
            # Add source metadata
            for doc, score in result:
                doc.metadata["_source"] = "qdrant_vector"
                doc.metadata["_search_method"] = "vector_similarity_search"
            logger.info(
                "STANDARD QDRANT SEARCH | collection=%s | brain_ids=%s | query='%s' | total=%d",
                collection_name,
                brain_ids,
                query[:50] + "..." if len(query) > 50 else query,
                len(result),
            )
            return result
    except Exception as e:
        # Redis connection/operation failure: Fallback Qdrant
        logger.warning(
            f"Redis operation failed for brain_ids '{brain_ids}': {e}. Falling back to Qdrant search only."
        )
        result = await to_thread(vector_search_with_score, collection_name, query, top_k, filter, user_id)
        # Add source metadata
        for doc, score in result:
            doc.metadata["_source"] = "qdrant_vector"
            doc.metadata["_search_method"] = "vector_similarity_search"
        logger.info(
            "FALLBACK QDRANT SEARCH (Redis failed) | collection=%s | brain_ids=%s | query='%s' | total=%d",
            collection_name,
            brain_ids,
            query[:50] + "..." if len(query) > 50 else query,
            len(result),
        )
        return result

    # Status-aware search: get document statuses from all brains and route accordingly
    #async cuz we dont want to block entire event loop (no wait for redis)
    # Aggregate statuses across all brain_ids
    all_status_groups = {"PENDING": [], "COMPLETED": [], "FAILED": [], "IMPORTED": []}
    for brain_id in brain_ids:
        status_groups = await status_client.get_all_statuses_for_brain_async(brain_id)
        for status_type in all_status_groups:
            all_status_groups[status_type].extend(status_groups[status_type])

    logger.info(
        "STATUS-AWARE SEARCH | brain_ids=%s | query='%s' | filter_ids=%s | "
        "status(pending=%d, completed=%d, failed=%d, imported=%d)",
        brain_ids,
        query[:50] + "..." if len(query) > 50 else query,
        external_ids if external_ids else "all",
        len(all_status_groups["PENDING"]),
        len(all_status_groups["COMPLETED"]),
        len(all_status_groups["FAILED"]),
        len(all_status_groups["IMPORTED"]),
    )

    # Get external_ids for Redis BM25 search (PENDING + FAILED)
    redis_search_ids = all_status_groups["PENDING"] + all_status_groups["FAILED"]
    if external_ids:
        redis_search_ids = [eid for eid in redis_search_ids if eid in external_ids]

    # Get external_ids for Qdrant search (COMPLETED)
    completed_ids = all_status_groups["COMPLETED"]
    if external_ids:
        completed_ids = [eid for eid in completed_ids if eid in external_ids]

    results = []

    # Qdrant vector search for COMPLETED documents
    qdrant_results = []
    if completed_ids:
        try:
            qdrant_filter = filter.copy() if filter else {}
            qdrant_filter["external_id"] = completed_ids

            logger.info(
                f"Qdrant search for {len(completed_ids)} COMPLETED documents"
            )

            qdrant_results = await to_thread(
                vector_search_with_score, collection_name, query, top_k, qdrant_filter, user_id
            )

            # Add source metadata
            for doc, score in qdrant_results:
                doc.metadata["_source"] = "qdrant_vector"
                doc.metadata["_search_method"] = "vector_similarity_search"

            results.extend(qdrant_results)
            logger.info(f"Qdrant search returned {len(qdrant_results)} results")
        except Exception as e:
            logger.error(f"Qdrant search failed: {e}")

    # Redis BM25 search for PENDING/FAILED documents (across all brain_ids)
    redis_results = []
    if redis_search_ids:
        try:
            logger.info(
                f"Redis BM25 search for {len(redis_search_ids)} PENDING/FAILED documents across {len(brain_ids)} brain(s)"
            )

            # Search across all brain_ids and aggregate results
            for brain_id in brain_ids:
                brain_specific_ids = [eid for eid in redis_search_ids]
                # If external_ids filter is provided, we already filtered above
                # But we need to make sure we're searching for documents in this specific brain

                bm25_results = await search_bm25(
                    r=r,
                    query=query,
                    brain_id=brain_id,
                    external_ids=brain_specific_ids,
                    k=top_k,
                )

                # Convert BM25 results to Document format (qdrant return doc format; consistency)
                for score, doc_fields in bm25_results:
                    doc = Document(
                        page_content=doc_fields.get("page_content", ""),
                        metadata={
                            "brain_id": doc_fields.get("brain_id"),
                            "external_id": doc_fields.get("external_id"),
                            "source": doc_fields.get("source"),
                            "page": doc_fields.get("page"),
                            "chunk_order": doc_fields.get("chunk_order"),
                            "_source": "redis_bm25",
                            "_search_method": "bm25_fulltext_search",
                        }
                    )
                    redis_results.append((doc, score))

            results.extend(redis_results)
            logger.info(f"Redis BM25 search returned {len(redis_results)} results")
        except Exception as e:
            logger.error(f"Redis BM25 search failed: {e}")

    #keep source order: Qdrant results first, then BM25 results
    #We avoid cross-source sorting cuz score scales are not comparable

    # Comprehensive summary logging
    logger.info(
        "STATUS-AWARE SUMMARY | brain_ids=%s | query='%s' | "
        "results(redis_bm25=%d, qdrant_vector=%d, total=%d)",
        brain_ids,
        query[:50] + "..." if len(query) > 50 else query,
        len(redis_results),
        len(qdrant_results),
        len(results),
    )

    return results


@similarity_search_decorator(async_mode=True)
async def similarity_search_with_score_task_multilangue_async(
        collection_name: str, query: str, top_k: int, filter: dict, user_id: str = "unknown"
) -> List[Tuple[Document, float]]:
    """
    An async task for similarity search with score
    """
    result = await to_thread(vector_search_with_score_multilangue, collection_name, query, top_k, filter, user_id)
    return result


@similarity_search_decorator(async_mode=False)
def similarity_search_with_score_task_multilangue_sync(
        collection_name: str, query: str, top_k: int, filter: dict, user_id: str = "unknown"
) -> List[Tuple[Document, float]]:
    """
    A task for similarity search with score multilangue
    """
    return vector_search_with_score_multilangue(collection_name, query, top_k, filter, user_id)


@similarity_search_decorator(async_mode=True)
async def hybrid_search_with_score_task_multilangue_async(
        collection_name: str,
        query: str,
        top_k: int,
        filter: dict,
        rrf_k: int,
        vector_search_top_k: Optional[int] = None,
        full_text_search_top_k: Optional[int] = None,
        vector_search_weight: Optional[float] = None,
        full_text_search_weight: Optional[float] = None,
        user_id: str = "unknown"
) -> List[Tuple[Document, float]]:
    """
    An async task for hybrid search with score
    """
    result = await to_thread(hybrid_search_with_score_multilangue,
                             collection_name,
                             query,
                             top_k,
                             filter,
                             rrf_k,
                             vector_search_top_k,
                             full_text_search_top_k,
                             vector_search_weight,
                             full_text_search_weight,
                             user_id)
    return result


@similarity_search_decorator(async_mode=False)
async def hybrid_search_with_score_task_multilangue_sync(
        collection_name: str,
        query: str,
        top_k: int,
        filter: dict,
        rrf_k: int,
        vector_search_top_k: Optional[int] = None,
        full_text_search_top_k: Optional[int] = None,
        vector_search_weight: Optional[float] = None,
        full_text_search_weight: Optional[float] = None,
        user_id: str = "unknown"
) -> List[Tuple[Document, float]]:
    """
    hybrid search with score multilangue
    """
    result = hybrid_search_with_score_multilangue(
        collection_name,
        query,
        top_k,
        filter,
        rrf_k,
        vector_search_top_k,
        full_text_search_top_k,
        vector_search_weight,
        full_text_search_weight,
        user_id
    )
    return result


@similarity_search_decorator(async_mode=True)
async def hybrid_search_with_score_task_async(
        collection_name: str,
        query: str,
        top_k: int,
        filter: dict,
        rrf_k: int,
        vector_search_top_k: Optional[int] = None,
        full_text_search_top_k: Optional[int] = None,
        vector_search_weight: Optional[float] = None,
        full_text_search_weight: Optional[float] = None,
        user_id: str = "unknown"
) -> List[Tuple[Document, float]]:
    """
    An async task for hybrid search with score
    """
    result = await to_thread(hybrid_search_with_score,
                             collection_name,
                             query,
                             top_k,
                             filter,
                             rrf_k,
                             vector_search_top_k,
                             full_text_search_top_k,
                             vector_search_weight,
                             full_text_search_weight,
                             user_id)
    return result


@similarity_search_decorator(async_mode=False)
def hybrid_search_with_score_task(
        collection_name: str,
        query: str,
        top_k: int,
        filter: dict,
        rrf_k: int,
        vector_search_top_k: Optional[int] = None,
        full_text_search_top_k: Optional[int] = None,
        vector_search_weight: Optional[float] = None,
        full_text_search_weight: Optional[float] = None,
        user_id: str = "unknown"
) -> List[Tuple[Document, float]]:
    """
    A task for hybrid search with score
    """
    return hybrid_search_with_score(
        collection_name,
        query,
        top_k,
        filter,
        rrf_k,
        vector_search_top_k,
        full_text_search_top_k,
        vector_search_weight,
        full_text_search_weight,
        user_id
    )
