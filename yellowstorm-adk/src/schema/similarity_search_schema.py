"""Schema for Similarity Search API"""

from typing import List, Optional, Tuple

from pydantic import BaseModel, Field

from .document_model_schema import DocumentModel


class SimilaritySearchRequest(BaseModel):
    query: str = Field(..., title="Query", description="Query to search for")
    collection_name: str = Field(..., title="Collection Name", description="Name of the collection to search in")
    top_k: int = Field(4, title="Top K", description="Number of results to return")
    filter: Optional[dict] = Field(None, title="Filter", description="Filter to apply to the search", repr=False)


class MultiSimilaritySearchRequest(BaseModel):
    queries: List[str] = Field(..., title="Queries", description="Queries to search for")
    collection_name: str = Field(..., title="Collection Name", description="Name of the collection to search in")
    top_k: int = Field(4, title="Top K", description="Number of results to return")
    filter: Optional[dict] = Field(None, title="Filter", description="Filter to apply to the search", repr=False)


class HybridSearchRequest(SimilaritySearchRequest):
    rrf_k: int = Field(
        60,
        title="RRF K",
        description="Value of k to use for reciprocal rank fusion",
    )
    vector_search_top_k: Optional[int] = Field(
        None,
        title="Vector Search Top K",
        description="Number of results to return for vector search",
    )
    full_text_search_top_k: Optional[int] = Field(
        None,
        title="Full Text Search Top K",
        description="Number of results to return for full text search",
    )
    vector_search_weight: Optional[float] = Field(
        None,
        title="Vector Search Weight",
        description="Weight to apply to the vector search results",
    )
    full_text_search_weight: Optional[float] = Field(
        None,
        title="Full Text Search Weight",
        description="Weight to apply to the full text search results",
    )


class MultiHybridSearchRequest(MultiSimilaritySearchRequest):
    rrf_k: int = Field(
        60,
        title="RRF K",
        description="Value of k to use for reciprocal rank fusion",
    )
    vector_search_top_k: Optional[int] = Field(
        None,
        title="Vector Search Top K",
        description="Number of results to return for vector search",
    )
    full_text_search_top_k: Optional[int] = Field(
        None,
        title="Full Text Search Top K",
        description="Number of results to return for full text search",
    )
    vector_search_weight: Optional[float] = Field(
        None,
        title="Vector Search Weight",
        description="Weight to apply to the vector search results",
    )
    full_text_search_weight: Optional[float] = Field(
        None,
        title="Full Text Search Weight",
        description="Weight to apply to the full text search results",
    )


class MaxMarginalRelevanceSearchRequest(SimilaritySearchRequest):
    fetch_k: int = Field(
        20,
        title="Fetch K",
        description="Number of results to fetch before applying MMR",
    )
    lambda_mut: float = Field(
        0.5,
        title="Lambda Mutation",
        description="Number between 0 and 1 that controls the tradeoff between relevance and diversity",
    )


SimilaritySearchWithScoreResponse = List[Tuple[DocumentModel, float]]