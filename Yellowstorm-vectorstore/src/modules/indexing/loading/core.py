"""This module contains functions for loading documents."""

import os
from typing import Any, Dict, List, Optional
from uuid import uuid4

from langchain_core.documents import Document


from src.logger.logging import get_logger
from .excel import _load_excel_document
from .pdf import _load_pdf_document
from .powerpoint import _load_powerpoint_document
from .text import _load_text_document
from .word import _load_word_document

logger = get_logger(__name__)


def load_document(
    document_path: str,
    metadata: Dict[str, Any],
    use_ocr: bool = False,
    save_images: bool = False,
    datalake_directory: Optional[str] = None,
    save_pages_as_images: bool = False,
) -> List[Document]:
    """
    Load a document

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
    datalake_directory : Optional[str]
        Directory in Azure Data Lake to upload images to
    save_pages_as_images: bool
        Whether to save pages as images extracted from the PDF
    Returns
    -------
    List[Document]
    """
    logger.info(f"Loading document from {document_path}")
    metadata["external_id"] = metadata.get("external_id", str(uuid4()))
    logger.info(f"External ID: {metadata['external_id']}")
    ext = os.path.splitext(document_path)[1].lower()
    if ext == ".pdf":
        return _load_pdf_document(
            document_path=document_path,
            metadata=metadata,
            use_ocr=use_ocr,
            save_images=save_images,
            datalake_directory=datalake_directory,
            save_pages_as_images=save_pages_as_images,
        )
    if ext in [".xls", ".xlsx"]:
        return _load_excel_document(document_path, metadata)
    if ext in [".ppt", ".pptx"]:
        return _load_powerpoint_document(document_path, metadata)
    if ext in [".doc", ".docx"]:
        return _load_word_document(document_path, metadata)
    try:
        logger.warning(f"Unknown file extension: {ext}, defaulting to text loader")
        return _load_text_document(document_path, metadata)
    except RuntimeError:
        raise RuntimeError(f"Could not load document from {document_path}")
