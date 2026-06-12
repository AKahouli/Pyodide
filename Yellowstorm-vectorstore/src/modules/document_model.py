"""Module for converting langchain documents to document models."""

from typing import List, Tuple

from langchain.schema import Document

from src.logger.logging import get_logger
from src.schema.document_model import DocumentModel

logger = get_logger(__name__)


def langchain_document_to_document_model(document: Document) -> DocumentModel:
    """Convert a langchain document to a document model."""
    logger.debug(f"Converting document to document model: {document}")
    return DocumentModel(
        page_content=document.page_content,
        metadata=document.metadata,
    )


def document_model_to_langchain_document(document: DocumentModel) -> Document:
    """Convert a document model to a langchain document."""
    logger.debug(f"Converting document model to document: {document}")
    return Document(
        page_content=document.page_content,
        metadata=document.metadata,
    )


