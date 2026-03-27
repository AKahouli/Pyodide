"""Hybrid search core module (Qdrant version)."""


from typing import List, Optional, Tuple

from langchain_core.documents import Document

from src.similarity_search.qdrant_search.filter import dict_to_qdrant_filter
from src.config.settings import get_settings
from src.logger.logging import get_logger

settings = get_settings()
logger = get_logger(__name__)


# ================================
# RRF Utilities
# ================================

def get_ranked_fused_scores(
    results: List[List[Tuple[Document, float]]],
    weights: List[float],
    k: int = 60,
) -> List[Tuple[str, float]]:
    logger.info(f"Fusing {len(results)} result sets with weights {weights}")
    logger.debug(f"RRF parameter k: {k}")

    if len(results) != len(weights):
        raise ValueError("Number of result sets and weights must match")

    fused_scores = {}

    for docs, weight in zip(results, weights):
        logger.debug(f"Processing {len(docs)} documents with weight {weight}")
        for rank, (doc, _) in enumerate(docs):
            doc_id = doc.metadata["id"]
            logger.debug(f"Processing document {doc_id} at rank {rank}")

            if doc_id not in fused_scores:
                fused_scores[doc_id] = 0.0

            fused_scores[doc_id] += weight * (1 / (rank + k))
            logger.debug(f"Updated score for {doc_id}: {fused_scores[doc_id]}")

    logger.debug(f"Fused {len(fused_scores)} unique documents")
    return sorted(fused_scores.items(), key=lambda x: x[1], reverse=True)


def get_document_by_id(doc_id: str, documents: List[Document]) -> Optional[Document]:
    logger.debug(f"Getting document with id {doc_id} from {len(documents)} documents")
    for doc in documents:
        logger.debug(f"Found document with id {doc_id}")
        if doc.metadata["id"] == doc_id:
            return doc
    logger.debug(f"Document with id {doc_id} not found")
    return None


def reciprocal_rank_fusion(
    results: List[List[Tuple[Document, float]]],
    weights: Optional[List[float]] = None,
    k: int = 60,
) -> List[Tuple[Document, float]]:

    logger.info(f"Performing reciprocal rank fusion on {len(results)} sets of results with weights {weights}")
    logger.debug(f"RRF parameter k: {k}")

    if weights is None:
        weights = [1.0 for _ in results]
        logger.debug("Weights not provided, defaulting to equal weights")

    ranked_scores = get_ranked_fused_scores(results, weights, k)
    logger.debug(f"Got {len(ranked_scores)} ranked fused scores")

    reranked_results = []
    logger.debug(f"Reranking {len(ranked_scores)} results using fused scores")
    for doc_id, score in ranked_scores:
        logger.debug(f"Looking for document {doc_id} with score {score}")
        for docs in results:
            documents = [doc for doc, _ in docs]
            doc = get_document_by_id(doc_id, documents)
            if doc:
                reranked_results.append((doc, score))
                logger.debug(f"Found and added document {doc_id} to reranked results")
                break
    logger.debug(f"Total reranked results: {len(reranked_results)}")
    return reranked_results


# ================================
# Hybrid Search
# ================================

def hybrid_search_with_score(
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
    Hybrid search using:
        - Dense vector similarity (semantic search)
        - Native Qdrant full-text search (BM25)
    Fused using Reciprocal Rank Fusion (RRF)
    """

    from src.similarity_search.qdrant_search.get_qdrant_collection import get_qdrant_client
    from src.similarity_search.embeddings import get_embeddings
    from qdrant_client.models import (
        Filter,
        FieldCondition,
        MatchValue,
        MatchText,
    )
    from concurrent.futures import ThreadPoolExecutor

    client = get_qdrant_client()
    embeddings = get_embeddings(user_id)

    vector_k = vector_search_top_k or top_k
    text_k = full_text_search_top_k or top_k

    vector_weight = vector_search_weight or 1.0
    text_weight = full_text_search_weight or 1.0

    qdrant_filter = dict_to_qdrant_filter(filter)

    # ----------------------------------
    # Vector Search
    # ----------------------------------
    def vector_search():
        query_vector = embeddings.embed_query(query)

        search_result = client.query_points(
            collection_name=collection_name,
            query=query_vector,
            limit=vector_k,
            query_filter=qdrant_filter,
            with_payload=True,
            with_vectors=False,
        )

        results = []
        for point in search_result.points:
            payload = point.payload or {}
            doc = Document(
                page_content=payload.get("page_content", ""),
                metadata=payload.get("metadata", {}),
            )
            results.append((doc, float(point.score)))

        return results

    # ----------------------------------
    # Full-Text Search (Native Qdrant BM25)
    # ----------------------------------
    def full_text_search():
        search_result = client.query_points(
            collection_name=collection_name,
            query=MatchText(
                text=query,
                key="page_content",
            ),
            limit=text_k,
            query_filter=qdrant_filter,
            with_payload=True,
            with_vectors=False,
        )

        results = []
        for point in search_result.points:
            payload = point.payload or {}
            doc = Document(
                page_content=payload.get("page_content", ""),
                metadata=payload.get("metadata", {}),
            )
            results.append((doc, float(point.score)))

        return results

    # ----------------------------------
    # Run in Parallel
    # ----------------------------------
    with ThreadPoolExecutor(max_workers=2) as executor:
        vector_future = executor.submit(vector_search)
        text_future = executor.submit(full_text_search)

        vector_results = vector_future.result()
        text_results = text_future.result()

    # ----------------------------------
    # Reciprocal Rank Fusion
    # ----------------------------------
    fused_results = reciprocal_rank_fusion(
        results=[vector_results, text_results],
        weights=[vector_weight, text_weight],
        k=rrf_k,
    )

    return fused_results[:top_k]