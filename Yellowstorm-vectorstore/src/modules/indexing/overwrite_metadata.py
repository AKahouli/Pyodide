from typing import Any, Dict, List

from langchain.schema import Document

from src.logger.logging import get_logger

logger = get_logger(__name__)


def overwrite_document_metadata(document: Document, metadata: Dict[str, Any]) -> Document:
    """
    Overwrite the metadata of a document

    Parameters
    ----------
    document : Document
        Document to overwrite the metadata of
    metadata : Dict[str, Any]
        Metadata to overwrite the document's metadata with

    Returns
    -------
    Document
        Document with overwritten metadata
    """
    logger.debug(f"Overwriting metadata of document {document} with metadata {metadata}")
    return Document(
        page_content=document.page_content,
        metadata={**document.metadata, **metadata},
    )


def overwrite_documents_metadata(documents: List[Document], metadata: Dict[str, Any]) -> List[Document]:
    """
    Overwrite the metadata of a list of documents

    Parameters
    ----------
    documents : List[Document]
        List of documents to overwrite the metadata of
    metadata : Dict[str, Any]
        Metadata to overwrite the documents' metadata with

    Returns
    -------
    List[Document]
        List of documents with overwritten metadata
    """
    logger.info(f"Overwriting metadata of documents {len(documents)} with metadata {metadata}")
    return [overwrite_document_metadata(document, metadata) for document in documents]
