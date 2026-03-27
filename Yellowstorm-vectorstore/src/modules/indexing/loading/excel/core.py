"""Core functions for loading Excel documents"""

from typing import Any, Dict, List

from langchain_core.documents import Document

from src.logger.logging import get_logger

from ..overwrite_metadata import overwrite_documents_metadata
from .loader import ExcelLoader

logger = get_logger(__name__)


def _load_excel_document(
    document_path: str,
    metadata: Dict[str, Any],
) -> List[Document]:
    """
    Load an Excel document

    Parameters
    ----------
    document_path : str
        Path to the document to load
    metadata : Dict[str, Any]
        Metadata to add to the document

    Returns
    -------
    Document
        Document object
    """
    logger.info(f"Loading Excel document from {document_path} with metadata {metadata}")
    loader = ExcelLoader(
        document_path,
    )
    loaded_documents = loader.load()
    documents = overwrite_documents_metadata(loaded_documents, metadata)
    logger.info(f"Loaded {len(documents)} documents")
    logger.debug(f"Documents: {documents}")
    return documents
