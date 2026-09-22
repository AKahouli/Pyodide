"""Request/response models for the attachment-profile endpoint."""

from typing import List, Optional

from pydantic import BaseModel, Field


class AttachmentProfileRequest(BaseModel):
    document_id: str
    path: str = Field(..., description="Object key of the stored source file")
    filename: str
    mime_type: str = ""
    max_indexed_tabular_rows: int = Field(default=5000, ge=1)


class ExtractionInfo(BaseModel):
    status: str  # "ready" | "partial" | "failed"
    extractor: str
    characters: int
    truncated: bool


class TabularInfo(BaseModel):
    total_rows: int
    sheet_count: Optional[int] = None
    column_names: Optional[List[str]] = None


class AttachmentProfile(BaseModel):
    version: int = 1
    document_id: str
    filename: str
    mime_type: str
    extraction: ExtractionInfo
    tabular: Optional[TabularInfo] = None
    # CODE_ONLY profiles (row count exceeded the threshold) carry no content.
    content: Optional[str] = None
    preview: Optional[str] = None
    generated_at: str
