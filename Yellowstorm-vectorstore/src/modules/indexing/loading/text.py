""" Load a text document """

from typing import Any, Dict, List

from langchain_community.document_loaders import TextLoader
from langchain_core.documents import Document

from src.logger.logging import get_logger

from .overwrite_metadata import overwrite_documents_metadata

logger = get_logger(__name__)


def _load_text_document(
    document_path: str,
    metadata: Dict[str, Any],
) -> List[Document]:
    """
    Load a PowerPoint document

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
    logger.info(f"Loading text document from {document_path} with metadata {metadata}")
    loader = TextLoader(document_path)
    loaded_documents = loader.load()
    documents = overwrite_documents_metadata(loaded_documents, metadata)
    logger.info(f"Loaded {len(documents)} documents")
    logger.debug(f"Documents: {documents}")
    return documents
