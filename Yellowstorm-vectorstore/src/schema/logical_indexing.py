"""
Pydantic models for logical indexing API requests and responses.
"""

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class BoundingBox(BaseModel):
    """Bounding box coordinates for a block."""
    x1: float
    y1: float
    x2: float
    y2: float


class LogicalBlockSchema(BaseModel):
    """Schema for a content block."""
    block_id: str
    block_type: str
    content: Optional[str] = None
    page_number: Optional[int] = None
    bbox: Optional[BoundingBox] = None
    level: Optional[int] = None
    parent_id: Optional[str] = None

    class Config:
        from_attributes = True


class LogicalSectionSchema(BaseModel):
    """Schema for a document section."""
    section_id: str
    title: Optional[str] = None
    level: int
    parent_section_id: Optional[str] = None
    start_block_id: Optional[str] = None
    end_block_id: Optional[str] = None
    page_start: Optional[int] = None
    page_end: Optional[int] = None

    class Config:
        from_attributes = True


class LogicalDocumentSchema(BaseModel):
    """Schema for a complete logical document with blocks and sections."""
    doc_id: str
    external_id: str
    brain_id: str
    source: Optional[str] = None
    total_pages: int
    overview: Optional[str] = None
    toc: Optional[str] = None
    processing_time_ms: Optional[float] = None
    created_at: Optional[datetime] = None
    blocks: List[LogicalBlockSchema] = []
    sections: List[LogicalSectionSchema] = []

    class Config:
        from_attributes = True


class LogicalDocumentSummary(BaseModel):
    """Summary of a logical document (without full blocks/sections)."""
    doc_id: str
    external_id: str
    brain_id: str
    source: Optional[str] = None
    total_pages: int
    overview: Optional[str] = None
    toc: Optional[str] = None
    processing_time_ms: Optional[float] = None
    created_at: Optional[datetime] = None
    total_blocks: int = 0
    total_sections: int = 0

    class Config:
        from_attributes = True


# API Request/Response models

class LogicalIndexingRequest(BaseModel):
    """Request model for triggering logical document indexing."""
    file_path: str = Field(..., description="Azure Data Lake path to the document")
    external_id: str = Field(..., description="External document identifier")
    brain_id: str = Field(..., description="Brain/workspace identifier")
    doc_id: Optional[str] = Field(None, description="Optional custom document ID")
    source: Optional[str] = Field(None, description="Source URL or path of the document")


class LogicalIndexingResponse(BaseModel):
    """Response model for logical indexing request."""
    task_id: str = Field(..., description="Celery task ID for tracking")
    status: str = Field(..., description="Task status (PENDING, STARTED, etc.)")
    message: str = Field(..., description="Human-readable status message")


class LogicalIndexingResult(BaseModel):
    """Result model returned by the logical indexing task."""
    doc_id: str
    external_id: str
    brain_id: str
    total_pages: int
    total_blocks: int
    total_sections: int
    processing_time_ms: float
    status: str = "completed"
    error: Optional[str] = None


class LogicalIndexingStatus(BaseModel):
    """Status response for a logical indexing task."""
    task_id: str
    status: str
    result: Optional[LogicalIndexingResult] = None
    error: Optional[str] = None
