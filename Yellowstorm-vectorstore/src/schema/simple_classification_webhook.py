"""
Simplified webhook schema for file classification tasks with hierarchical directory support.

This schema provides support for sous_directories (subdirectories) and hierarchical
classification results while maintaining backward compatibility.
"""

from typing import Dict, Any, Optional, List
from pydantic import BaseModel, Field


class SimpleClassificationPayload(BaseModel):
    """
    Simplified webhook payload for file classification tasks with hierarchical support.

    This payload provides essential classification information with optional hierarchical
    details for clients that need full directory context.
    """
    # Core classification fields (required for compatibility)
    event_type: str = Field(default="file_classification_task", description="Type of event")
    external_id: str = Field(..., description="External document identifier")
    sheet_name: Optional[str] = Field(None, description="Sheet name for Excel documents")
    directory_id: Optional[str] = Field(None, description="Target directory ID for the document")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Additional metadata")

    # Enhanced hierarchical fields (optional, for clients that support them)
    predicted_category: Optional[str] = Field(None, description="Predicted category from classification model")
    confidence_score: Optional[float] = Field(None, description="Classification confidence (0.0-1.0)")
    hierarchy_path: Optional[List[str]] = Field(None, description="Full hierarchical path to the directory")
    hierarchy_level: Optional[int] = Field(None, description="Depth level in hierarchy (0=root)")
    parent_directory_id: Optional[str] = Field(None, description="Parent directory ID if not root level")
    
    class Config:
        extra = "allow"  # Allow additional fields for future extensions
        schema_extra = {
            "example": {
                "event_type": "file_classification_task",
                "external_id": "doc_123456",
                "sheet_name": "Financial Report Q4",
                "directory_id": "subfolder-001",
                "predicted_category": "Finances/Factures",
                "confidence_score": 0.85,
                "hierarchy_path": ["Finances", "Factures"],
                "hierarchy_level": 1,
                "parent_directory_id": "folder-001",
                "metadata": {
                    "processing_time": 1.2,
                    "user_id": "user_789",
                    "total_paths_considered": 15
                }
            }
        }


class HierarchicalClassificationResult(BaseModel):
    """
    Enhanced classification result with full hierarchical information.

    This model provides comprehensive classification results for clients that
    need detailed hierarchical analysis and directory navigation.
    """
    # Core identification
    external_id: str = Field(..., description="External document identifier")
    sheet_name: Optional[str] = Field(None, description="Sheet name for Excel documents")

    # Classification results
    predicted_category: str = Field(..., description="Predicted category from classification model")
    directory_id: Optional[str] = Field(None, description="Mapped directory ID from structure template")
    confidence_score: float = Field(..., description="Classification confidence (0.0-1.0)")

    # Hierarchical information
    hierarchy_path: List[str] = Field(default_factory=list, description="Full hierarchical path to the directory")
    hierarchy_level: int = Field(0, description="Depth level in hierarchy (0=root)")
    parent_directory_id: Optional[str] = Field(None, description="Parent directory ID if not root level")

    # Processing information
    processing_time: float = Field(..., description="Time taken for classification in seconds")

    # Additional metadata
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Additional classification metadata")

    class Config:
        schema_extra = {
            "example": {
                "external_id": "doc_123456",
                "sheet_name": "Financial Report Q4",
                "predicted_category": "Finances/Factures/2024",
                "directory_id": "subsub-001",
                "confidence_score": 0.92,
                "hierarchy_path": ["Finances", "Factures", "2024"],
                "hierarchy_level": 2,
                "parent_directory_id": "subfolder-001",
                "processing_time": 2.3,
                "metadata": {
                    "model_version": "gpt-4.1-latest",
                    "total_directories": 25,
                    "max_depth_considered": 3,
                    "similar_categories": ["Finances/Budgets/2024", "Finances/Reports/2024"]
                }
            }
        }


class ClassificationWebhookResponse(BaseModel):
    """
    Webhook response that can be either simple or enhanced based on client capabilities.

    This allows backward compatibility while providing enhanced features for
    clients that support hierarchical classification.
    """
    success: bool = Field(..., description="Whether the classification was successful")
    message: str = Field(..., description="Status message or description")
    task_id: Optional[str] = Field(None, description="Task identifier for async processing")

    # Simple result (for backward compatibility)
    simple_result: Optional[SimpleClassificationPayload] = Field(None, description="Simple classification result")

    # Enhanced result (for clients supporting hierarchical features)
    enhanced_result: Optional[HierarchicalClassificationResult] = Field(None, description="Enhanced classification result with hierarchy")

    class Config:
        schema_extra = {
            "example": {
                "success": True,
                "message": "Document classified successfully",
                "task_id": "task_123456789",
                "simple_result": {
                    "event_type": "file_classification_task",
                    "external_id": "doc_123456",
                    "directory_id": "subfolder-001"
                },
                "enhanced_result": {
                    "external_id": "doc_123456",
                    "predicted_category": "Finances/Factures",
                    "directory_id": "subfolder-001",
                    "confidence_score": 0.85,
                    "hierarchy_path": ["Finances", "Factures"],
                    "hierarchy_level": 1
                }
            }
        }