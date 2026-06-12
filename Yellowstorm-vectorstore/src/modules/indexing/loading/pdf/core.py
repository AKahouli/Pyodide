"""Core functions for loading PDF documents"""

from typing import Any, Dict, List, Optional

from langchain_core.documents import Document

from src.logger.logging import get_logger
from .loader import PDFLoader
from ..overwrite_metadata import overwrite_documents_metadata

logger = get_logger(__name__)


def _load_pdf_document(
    document_path: str,
    metadata: Dict[str, Any],
    use_ocr: bool = False,
    save_images: bool = False,
    datalake_directory: Optional[str] = None,
    save_pages_as_images: bool = False,
) -> List[Document]:
    """
    Load a PDF document

    Parameters
    ----------
    document_path : str
        Path to the document to load
    metadata : Dict[str, Any]
        Metadata to add to the document
    use_ocr : bool
        Whether to use OCR to extract text from images in the PDF
    save_images : bool
        Whether to save images extracted from the PDF
    save_pages_as_images: bool
        Whether to save pages as images extracted from the PDF
    Returns
    -------
    List[Document]
    """
    logger.info(f"Loading PDF document from {document_path} with metadata {metadata}")
    loader = PDFLoader(
        document_path,
        use_ocr=use_ocr,
        save_images=save_images,
        datalake_directory=datalake_directory,
        save_pages_as_images=save_pages_as_images,
    )
    loaded_documents = loader.load()
    loaded_documents = overwrite_documents_metadata(loaded_documents, metadata)
    logger.info(f"Loaded {len(loaded_documents)} documents")
    logger.debug(f"Documents: {loaded_documents}")
    return loaded_documents
