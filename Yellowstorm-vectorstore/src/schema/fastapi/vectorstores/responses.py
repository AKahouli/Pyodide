from typing import List, Tuple, Optional, Dict, Any
from datetime import datetime
from enum import Enum

from langchain_core.documents import Document

from pydantic import BaseModel, Field



class DocumentWithScore(BaseModel):
    document: Document
    score: float




class VectorIds(BaseModel):
    vector_ids: List[str]


class VectorstoreNames(BaseModel):
    vectorstore_names: List[str]




class PendingIndexing(BaseModel):
    indexing_id: str


class PendingDownloadIndexing(BaseModel):
    download_id: str
    indexing_id: str


class PendingDownloadIndexings(BaseModel):
    ids: List[PendingDownloadIndexing]


class IndexingTokens(BaseModel):
    indexing_tokens: int


class DetectedLanguage(BaseModel):
    detected_language: str


class PendingClassificationTask(BaseModel):
    """Response model for classification task creation."""
    classification_task_id: str = Field(..., description="ID of the queued classification task")
    status: str = Field(default="queued", description="Current status of the task")
    estimated_chunks: Optional[int] = Field(None, description="Estimated number of chunks to process (for backward compatibility)")




class ClassificationResult(BaseModel):
    """Response model for classification results using similarity classification with LLM fallback."""
    document_id: str = Field(..., description="Document external ID")
    predicted_category: str = Field(..., description="Predicted category")
    final_confidence: float = Field(..., description="Final confidence score (0-1)")
    total_chunks: int = Field(..., description="Total number of chunks processed")
    chunk_votes: Optional[List[Dict[str, Any]]] = Field(None, description="Individual chunk votes")
    vote_distribution: Optional[Dict[str, int]] = Field(None, description="Vote distribution by category")
    processing_metadata: Optional[Dict[str, Any]] = Field(None, description="Additional processing metadata")
    

