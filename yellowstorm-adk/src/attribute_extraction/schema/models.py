"""Pydantic models for attribute extraction endpoint."""

from typing import Dict, List, Optional, Any
from pydantic import BaseModel, Field, HttpUrl


class AttributeDefinition(BaseModel):
    """Definition of a single attribute to extract"""
    description: str = Field(..., description="Description of what to extract")
    type: str = Field(
        default="string",
        description="Type: string, number, boolean, array, or object"
    )


class AttributeExtractionRequest(BaseModel):
    """Request model for attribute-based extraction endpoint"""
    workspace_names: List[str] = Field(..., description="List of workspace names to search")
    attributes: Dict[str, AttributeDefinition] = Field(
        ...,
        description="Dictionary mapping attribute names to their definitions"
    )
    webhook_url: HttpUrl = Field(..., description="Webhook URL to POST results to when extraction completes")
    vectorstore: str = Field(
        default="vectorstorerec",
        description="Vectorstore name"
    )
    top_k: int = Field(default=3, description="Number of search results to return")
    file_names: Optional[List[str]] = Field(
        None,
        description="Optional list of file names to filter search"
    )
    sheet_name: Optional[str] = Field(
        None,
        description="Optional sheet name to filter Excel document search"
    )


class AttributeExtractionResponse(BaseModel):
    """Response model for attribute extraction endpoint"""
    job_id: str = Field(..., description="Unique job identifier")
    status: str = Field(..., description="Job status (e.g., 'processing', 'queued')")
    message: str = Field(..., description="Human-readable status message")
    webhook_url: str = Field(..., description="Webhook URL where results will be sent")
