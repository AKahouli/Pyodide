"""DocumentModel schema for api compatibility."""

from pydantic import BaseModel, Field


class DocumentModel(BaseModel):
    """Clone of langchain_core.documents.base.Document for api compatibility."""

    page_content: str
    """String text."""
    metadata: dict = Field(default_factory=dict)
    """Arbitrary metadata about the page content (e.g., source, relationships to other
        documents, etc.).
    """
