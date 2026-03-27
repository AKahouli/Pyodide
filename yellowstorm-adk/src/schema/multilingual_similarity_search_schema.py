"""Schema for multilingual similarity search request"""

from enum import Enum
from typing import Any, Dict, Optional

from pydantic import BaseModel, Field


class SimilaritySearchType(str, Enum):
    """Enum for similarity search type"""

    SIMILARITY_SEARCH_WITH_SCORE = "similarity_search_with_score"
    SIMILARITY_SEARCH_WITH_RELEVANCE_SCORES = "similarity_search_with_relevance_scores"
    FULL_TEXT_SEARCH_WITH_SCORE = "full_text_search_with_score"


class MultiLingualSimilaritySearchRequest(BaseModel):
    query_dict: Dict[str, str] = Field(..., title="Query", description="Query to search for", repr=False)
    collection_name: str = Field(..., title="Collection Name", description="Name of the collection to search in")
    top_k: int = Field(4, title="Top K", description="Number of results to return")
    filter: Optional[Dict[str, Any]] = Field(
        None, title="Filter", description="Filter to apply to the search", repr=False
    )
    similarity_search_type: SimilaritySearchType = Field(
        SimilaritySearchType.SIMILARITY_SEARCH_WITH_SCORE,
        title="Similarity Search Type",
        description="Type of similarity search to perform",
    )
    similarity_search_function_kwargs: Optional[Dict[str, Any]] = Field(
        None,
        title="Similarity Search Function Kwargs",
        description="Keyword arguments to pass to the similarity search function",
        repr=False,
    )