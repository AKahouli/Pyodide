"""This module contains functions for formatting documents before embedding them."""
import base64
import copy
import json
import urllib
from pathlib import Path
from typing import List, Dict, Any, Optional
import fitz
import re2 as re
import requests
from azure.ai.documentintelligence import DocumentIntelligenceClient
from azure.ai.documentintelligence.models import AnalyzeDocumentRequest
from azure.core.credentials import AzureKeyCredential
from haystack.components.converters import TextFileToDocument, XLSXToDocument
from haystack.components.preprocessors import DocumentSplitter
from haystack.dataclasses import Document as DocumentHay
from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter
from requests import RequestException, Timeout

from src.config.settings import get_settings
from src.logger.logging import get_logger
from src.schema.fastapi.vectorstores.requests import (
    VectorstoreValidationError,
    VectorstoreIndexingError
)

logger = get_logger(__name__)

settings = get_settings()


def is_pdf_scanned(file_path):
    doc = fitz.open(file_path)  # Open the PDF
    has_text = any(page.get_text("text").strip() for page in doc)  # Check if any page has text
    return not has_text


def create_ocr_chunks(file_path: str, metadata: Dict[str, Any]) -> List[Dict[str, Any]]:
    with open(file_path, "rb") as f:
        base64_encoded_pdf = base64.b64encode(f.read()).decode("utf-8")

    document_intelligence_client = DocumentIntelligenceClient(
        endpoint=settings.AZURE_OCR_ENDPOINT, credential=AzureKeyCredential(settings.AZURE_AI_FOUNDRY_API_KEY)
    )

    poller = document_intelligence_client.begin_analyze_document(
        "prebuilt-layout", AnalyzeDocumentRequest(bytes_source=base64_encoded_pdf)
    )

    result = poller.result()

    extracted_text = []

    for page in result.pages:
        page_text = " ".join([line.content for line in page.lines]) if page.lines else ""
        extracted_text.append({"page_content": page_text, "metadata": {
            "page": page.page_number,
            **metadata}})

    return extracted_text
def ocr_image_via_azure_doc_intel(
    image_bytes: bytes,
    filename: str = "page.png",
) -> str:
    """
    Run OCR on an image using Azure Document Intelligence (prebuilt-read)
    and return extracted text as a single string.

    Raises:
        VectorstoreValidationError
        VectorstoreIndexingError
    """
    logger.info(f"Running OCR on {filename}")
    if not image_bytes:
        raise VectorstoreValidationError(
            message="image_bytes is required and cannot be empty",
            field="image_bytes",
            details={"filename": filename},
        )

    try:
        endpoint = settings.AZURE_OCR_ENDPOINT
        api_key = settings.AZURE_AI_FOUNDRY_API_KEY
    except Exception as e:
        raise VectorstoreIndexingError(
            message="Azure OCR configuration is missing",
            indexing_operation="resolve_azure_ocr_config",
            details={"error": str(e)},
        )

    try:
        client = DocumentIntelligenceClient(
            endpoint=endpoint,
            credential=AzureKeyCredential(api_key),
        )

        poller = client.begin_analyze_document(
            "prebuilt-read",
            AnalyzeDocumentRequest(bytes_source=image_bytes),
        )

        result = poller.result()

    except Exception as e:
        raise VectorstoreIndexingError(
            message="Azure Document Intelligence OCR failed",
            indexing_operation="azure_ocr_analyze",
            details={
                "filename": filename,
                "error": str(e),
            },
        )

    # Flatten OCR result into a single string (page order preserved)
    lines: list[str] = []

    for page in result.pages:
        if not page.lines:
            continue
        for line in page.lines:
            lines.append(line.content)

    return "\n".join(lines)

def ocr_image_via_api(image_bytes: bytes, filename: str = "page.png") -> str:
    """
    Send an image to the /ocr endpoint (multipart/form-data) and return extracted text.

    The endpoint is expected to respond with JSON: {"text": "<extracted text>"}.

    Raises:
        VectorstoreValidationError: if inputs are invalid.
        VectorstoreIndexingError: for HTTP/network/JSON parsing issues.
    """
    if not image_bytes:
        raise VectorstoreValidationError(
            message="image_bytes is required and cannot be empty",
            field="image_bytes",
            details={"filename": filename}
        )

    try:
        base = settings.PDF_API_URL
    except Exception as e:
        raise VectorstoreIndexingError(
            message="OCR API base URL is not configured",
            indexing_operation="resolve_ocr_url",
            details={"error": str(e)}
        )

    url = urllib.parse.urljoin(base, "ocr")

    files = {
        "file": (filename, image_bytes, "image/png"),
    }
    headers = {
        "accept": "application/json",
    }

    try:
        resp = requests.post(url, headers=headers, files=files, timeout=60)
        resp.raise_for_status()
    except Timeout as e:
        raise VectorstoreIndexingError(
            message=f"OCR request timed out: {url}",
            indexing_operation="ocr_http_timeout",
            details={"url": url, "filename": filename, "error": str(e)}
        )
    except RequestException as e:
        raise VectorstoreIndexingError(
            message=f"OCR request failed: {url}",
            indexing_operation="ocr_http_error",
            details={"url": url, "filename": filename, "error": str(e)}
        )

    # Parse JSON and extract "text"
    try:
        payload = resp.json()
    except json.JSONDecodeError as e:
        raise VectorstoreIndexingError(
            message="Failed to parse OCR response as JSON",
            indexing_operation="ocr_parse_json",
            details={"response_preview": resp.text[:500], "error": str(e)}
        )

    text = payload.get("text")
    if text is None:
        raise VectorstoreIndexingError(
            message='OCR response does not contain "text" field',
            indexing_operation="ocr_missing_text",
            details={"payload_keys": list(payload.keys())}
        )
    return str(text)


def ocr_page(page: fitz.Page, metadata: Dict[str, Any]) -> str:
    """
    Runs OCR on a single page using the external /ocr API and returns the extracted text.
    """
    # 1) Render page to PNG bytes
    try:
        zoom = 300 / 72
        matrix = fitz.Matrix(zoom, zoom)

        pix = page.get_pixmap(matrix=matrix, alpha=False)
        image_bytes = pix.tobytes("png")
    except Exception as e:
        raise VectorstoreIndexingError(
            message="Failed to render page to image",
            indexing_operation="render_page_image",
            details={"page_number": getattr(page, "number", None), "error": str(e)}
        )

    # 2) Build a filename for the multipart field (purely informational for the API)
    doc_name = (metadata or {}).get("document_name") or "document"
    page_num = getattr(page, "number", 0)
    filename = f"{doc_name}-page-{page_num + 1}.png"

    # 3) Call OCR API with proper error handling
    try:
        ocr_text = ocr_image_via_azure_doc_intel(image_bytes, filename)
    except (VectorstoreValidationError, VectorstoreIndexingError):
        # Re-raise known structured errors as-is so upstream can handle uniformly
        raise
    except Exception as e:
        logger.info(f"error_ocr {str(e)}")
        # Catch-all to avoid leaking unexpected exceptions
        raise VectorstoreIndexingError(
            message="Unexpected error during OCR",
            indexing_operation="ocr_unexpected",
            details={"filename": filename, "error": str(e)}
        )

    return ocr_text.strip()

def load_and_split_pdf(file_path: str, metadata: Dict[str, Any],
                       split_length: int = 1000, split_overlap: int = 50, sheet: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    Loads a file (PDF, text, or Excel) and splits it into smaller chunks.

    For non-PDF files, it resumes the original handling.
    For PDF files, it processes each page: if a page's native text is below a threshold,
    it replaces it with OCR text. Then it concatenates all pages into one document,
    using the form feed ('\f') as a delimiter (preserving page boundaries for the splitter)
    and splits the text solely based on the chunk size.
    """
    file_extension = file_path.lower().split('.')[-1]

    # Non-PDF: Resume original handling
    if file_extension != 'pdf':
        if file_extension in ['txt', 'text']:
            converter = TextFileToDocument()
        if file_extension in ['xls', 'xlsx']:
            converter = XLSXToDocument(sheet_name=sheet) if sheet else XLSXToDocument()
        else:
            raise ValueError(f"Unsupported file type: {file_extension}")

        result = converter.run(sources=[Path(file_path)])
        documents = result["documents"]

        splitter = DocumentSplitter(split_by="word", split_length=split_length, split_overlap=split_overlap)
        split_docs = splitter.run(documents=documents)["documents"]

        return [
            {
                "page_content": doc.content,
                "metadata": {"chunk_order": i + 1, "page": doc.meta.get("page_number"), "sheet_name": doc.meta.get("xlsx", {}).get("sheet_name", ""), "type": "Document", **metadata}
            }
            for i, doc in enumerate(split_docs)
        ]

    else:
        import fitz
        doc = fitz.open(file_path)
        pages_text = []

        VALID_RE = re.compile(r'[A-Za-zÀ-ÖØ-öø-ÿ0-9 ,\.\?\%\+\-\(\)]')

        for i, page in enumerate(doc):
            native_text = (page.get_text("text") or "").strip()
            length = len(native_text)

            valid_chars = VALID_RE.findall(native_text)
            valid_ratio = len(valid_chars) / length if length else 0

            if length < 20 or valid_ratio < 0.8:
                ocr_text = ocr_page(page, metadata)
                text = ocr_text or native_text
            else:
                text = native_text
            pages_text.append(text)

        combined_text = "\f".join(pages_text)

        doc_object = DocumentHay(content=combined_text, meta={"file_path": file_path})

        splitter = DocumentSplitter(split_by="word", split_length=split_length, split_overlap=split_overlap)
        split_docs = splitter.run(documents=[doc_object])["documents"]
        docs = [
            {
                "page_content": d.content,
                "metadata": {"chunk_order": i + 1, "source": file_path, "page": d.meta.get("page_number", 1), "type": "Document", **metadata}
            }
            for i, d in enumerate(split_docs)
        ]
        doc.close()
        return docs


def process_chunks_with_page_separation(chunks: List[Dict[str, Any]], is_scanned: bool = False) -> List[Dict[str, Any]]:
    """
    Processes chunks of text by wrapping their content in <page number=X> </page> tags.
    - If `is_scanned` is False, it splits content using '\f' as a delimiter.
    - If `is_scanned` is True, it does not split on '\f' but still wraps each chunk.

    Args:
        chunks (List[Dict[str, Any]]): A list of chunks containing `page_content` and `metadata`.
        is_scanned (bool): Whether the document is scanned or not.

    Returns:
        List[Dict[str, Any]]: Updated chunks with modified `page_content` including page delimiters.
    """
    updated_chunks = []

    for chunk in chunks:
        chunk_text = chunk["page_content"]
        metadata = chunk["metadata"]
        page_number = metadata.get("page", 1)  # Get page number from metadata

        if is_scanned:
            # If scanned, do not split on '\f', just wrap the entire chunk
            formatted_chunk_content = f"<page number={page_number}> {chunk_text.strip()} </page>"
        else:
            # If not scanned, split on '\f' and wrap each section
            page_texts = chunk_text.split("\f")
            formatted_chunk_content = " ".join(
                f"<page number={page_number + i}> {page_text.strip()} </page>"
                for i, page_text in enumerate(page_texts)
            )

        updated_chunks.append({
            "page_content": formatted_chunk_content,
            "metadata": metadata
        })

    return updated_chunks


class OrderSplitter(RecursiveCharacterTextSplitter):
    def create_documents(self, texts: List[str], metadatas: Optional[List[dict]] = None) -> List[Document]:
        """Create documents from a list of texts."""
        _metadatas = metadatas or [{}] * len(texts)
        documents = []
        for i, text in enumerate(texts):
            index = -1
            order = 1
            for chunk in self.split_text(text):
                metadata = copy.deepcopy(_metadatas[i])
                metadata["order"] = order

                if self._add_start_index:
                    index = text.find(chunk, index + 1)
                    metadata["start_index"] = index
                new_doc = Document(page_content=chunk, metadata=metadata)
                documents.append(new_doc)
                order += 1
        return documents


def split_documents(
        documents: List[Document],
        chunk_size: int,
        chunk_overlap: int,
        separators: List[str],
        keep_separator: bool,
        keep_order: bool,
        enrich_with_surrounding_chunks: bool = False
) -> List[Document]:
    """
    Format documents

    Parameters
    ----------
    documents : List[Document]
        List of documents to format
    chunk_size : int
        Chunk size
    chunk_overlap : int
        Chunk overlap
    separators : List[str]
        List of separators
    keep_separator : bool
        Keep separator
    keep_order : bool
    enrich_with_surrounding_chunks : bool

    Returns
    -------
    List[Document]
        List of formatted documents
    """
    # Validate inputs
    if not documents:
        raise VectorstoreValidationError(
            message="Documents list cannot be empty",
            field="documents",
            details={"provided_count": len(documents) if documents else 0}
        )
    
    if not isinstance(documents, list):
        raise VectorstoreValidationError(
            message="Documents must be a list",
            field="documents",
            details={"provided_type": type(documents).__name__}
        )
    
    if chunk_size <= 0:
        raise VectorstoreValidationError(
            message="Chunk size must be positive",
            field="chunk_size",
            details={"provided_value": chunk_size}
        )
    
    if chunk_overlap < 0:
        raise VectorstoreValidationError(
            message="Chunk overlap cannot be negative",
            field="chunk_overlap", 
            details={"provided_value": chunk_overlap}
        )
    
    if chunk_overlap >= chunk_size:
        raise VectorstoreValidationError(
            message="Chunk overlap must be less than chunk size",
            field="chunk_overlap",
            details={"chunk_size": chunk_size, "chunk_overlap": chunk_overlap}
        )
    
    if not isinstance(separators, list):
        raise VectorstoreValidationError(
            message="Separators must be a list",
            field="separators",
            details={"provided_type": type(separators).__name__}
        )
    
    # Validate document content
    for i, doc in enumerate(documents):
        if not isinstance(doc, Document):
            raise VectorstoreValidationError(
                message=f"All documents must be Document instances",
                field="documents",
                details={"document_index": i, "provided_type": type(doc).__name__}
            )
    
    try:
        splitter_kwargs = {
            "chunk_size": chunk_size,
            "chunk_overlap": chunk_overlap,
            "separators": separators,
            "keep_separator": keep_separator,
        }
        logger.info(f"Splitting documents with splitter kwargs {splitter_kwargs}")
        
        try:
            splitter = OrderSplitter(**splitter_kwargs) if keep_order else RecursiveCharacterTextSplitter(**splitter_kwargs)
        except Exception as e:
            raise VectorstoreIndexingError(
                message=f"Failed to create document splitter",
                indexing_operation="create_splitter",
                details={"splitter_kwargs": splitter_kwargs, "error": str(e)}
            )
        
        try:
            split_result = splitter.split_documents(documents)
        except Exception as e:
            raise VectorstoreIndexingError(
                message=f"Failed to split documents",
                indexing_operation="split_documents",
                details={
                    "document_count": len(documents),
                    "chunk_size": chunk_size,
                    "chunk_overlap": chunk_overlap,
                    "error": str(e)
                }
            )
        
        if enrich_with_surrounding_chunks:
            try:
                split_result = enrich_document_with_surrounding_chunks(split_result)
            except Exception as e:
                raise VectorstoreIndexingError(
                    message=f"Failed to enrich documents with surrounding chunks",
                    indexing_operation="enrich_surrounding_chunks",
                    details={"split_count": len(split_result), "error": str(e)}
                )
        
        logger.info(f"Split {len(documents)} documents into {len(split_result)} documents")
        return split_result
        
    except VectorstoreValidationError:
        # Re-raise validation errors as-is
        raise
    except VectorstoreIndexingError:
        # Re-raise indexing errors as-is
        raise
    except Exception as e:
        # Catch any other unexpected errors
        raise VectorstoreIndexingError(
            message=f"Unexpected error during document splitting",
            indexing_operation="split_documents",
            details={
                "document_count": len(documents),
                "chunk_size": chunk_size,
                "chunk_overlap": chunk_overlap,
                "error": str(e)
            }
        )


def enrich_document_with_surrounding_chunks(documents: list[Document]) -> list[Document]:
    """
    Add next chunk context to the current chunk to avoid having missing context.

    Args:
        documents: List of Document objects.

    Returns:
        A new list of documents enriched with surrounding chunks.
    """

    new_document_list = []

    for current_document, next_document in zip(documents, documents[1:]):
        # Create a deep copy of the current document to avoid modifying the original
        enriched_document = copy.deepcopy(current_document)

        # Enrich the copied document with the next chunk's content
        enriched_document.metadata["next_chunk_content"] = next_document.page_content

        if next_document.metadata.get("image_path"):
            enriched_document.metadata["next_chunk_image_path"] = next_document.metadata["image_path"]

        # Add the enriched document to the new list
        new_document_list.append(enriched_document)

    # Add the last document as it is, since it has no next chunk
    if documents:
        new_document_list.append(copy.deepcopy(documents[-1]))

    return new_document_list
