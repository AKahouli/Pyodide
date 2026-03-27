"""Pydantic models for batch attribute extraction endpoint."""

from typing import List
from pydantic import BaseModel, Field
from src.attribute_extraction.schema.models import AttributeExtractionRequest


class BatchAttributeExtractionRequest(BaseModel):
    """Request model for batch attribute extraction endpoint"""
    extraction_requests: List[AttributeExtractionRequest] = Field(
        ...,
        description="List of attribute extraction requests to process"
    )


class BatchAttributeExtractionResponse(BaseModel):
    """Response model for batch attribute extraction endpoint"""
    batch_job_id: str = Field(
        ...,
        description="Unique batch job identifier"
    )
    status: str = Field(
        ...,
        description="Batch processing status (queued, processing, completed, failed)"
    )
    total_jobs: int = Field(
        ...,
        description="Total number of jobs in batch"
    )
    queued_jobs: int = Field(
        ...,
        description="Number of jobs successfully queued"
    )
    message: str = Field(
        ...,
        description="Status message"
    )