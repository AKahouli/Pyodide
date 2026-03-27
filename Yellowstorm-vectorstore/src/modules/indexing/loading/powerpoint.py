""" Load a PowerPoint document """

from typing import Any, Dict, List

from langchain_community.document_loaders import UnstructuredPowerPointLoader
from langchain_core.documents import Document

from src.logger.logging import get_logger

from .overwrite_metadata import overwrite_documents_metadata

logger = get_logger(__name__)


def _load_powerpoint_document(
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
    logger.info(f"Loading PowerPoint document from {document_path} with metadata {metadata}")
    loader = UnstructuredPowerPointLoader(document_path, mode="elements")
    loaded_documents = loader.load()
    for document in loaded_documents:
        document.metadata["page"] = document.metadata.get("page_number")
    documents = overwrite_documents_metadata(loaded_documents, metadata)
    logger.info(f"Loaded {len(documents)} documents")
    logger.debug(f"Documents: {documents}")
    return documents
