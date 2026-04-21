from typing import Any, ClassVar, Dict, List, Optional
from enum import Enum

from pydantic import BaseModel, Field, root_validator, validator

from src.schema.fastapi.base import WorkerRquest
from src.schema.chunk_style import ChunkStyle

class VectorStore(BaseModel):
    vectorstore_name: Optional[str] = Field(
        None,
        title="Name of the vector store",
        description="Name of the vector store. Must be alphanumeric and underscores only.",
        examples=["vectorstoredev3"],
    )


class IndexText(VectorStore, WorkerRquest):
    brain_id: str = Field(
        ...,
        title="Brain ID of the document index",
        description="Brain ID of the document index. This brain ID could be later used for hybrid search in the vector database.",
        examples=["brain1"],
    )
    external_id: Optional[str] = Field(
        None,
        title="External ID of the document index",
        description="External ID of the document index. This is an optional field that is only used to provide more information about the document.",
        examples=["external1"],
    )


class IndexDocument(IndexText):
    filepath: str = Field(
        ...,
        title="Name of the document index",
        description="Path of the document index.",
        examples=["30-recettes-preferees-des-francais.pdf"],
    )
    source: Optional[str] = Field(
        None,
        title="Source of the document index",
        description="Saved source of the document index. The saved source is the source of the document that will be saved in the vector database. If not provided, the source will be the same as the filename.",
        examples=["https://www.example.com/30-recettes-preferees-des-francais.pdf"],
    )
    sheet_name: Optional[str] = Field(
        None,
        title="Sheet name",
        description="Optional sheet name to filter by (for spreadsheet documents like Excel)",
        examples=["Sheet1", "FinancialData", "Q4_2023"],
    )
    separators: List[str] = Field(
        ["\n\n", "\n", " ", ""],
        title="Separators",
        description="Separators to use to split the document into chunks. The separators are used to split the document into chunks. The chunks are then used to generate the embeddings.",
        examples=[["\n\n", "\n", " ", ""]],
    )
    keep_separator: bool = Field(
        True,
        title="Keep separator",
        description="Keep separator. If true, the separator will be kept in the chunk. If false, the separator will be removed from the chunk.",
        examples=[True, False],
    )

    chunk_size: int = Field(
        4000,
        title="Chunk size",
        description="Chunk size. The chunk size is the maximum number of characters in a chunk. If the chunk size is exceeded, the chunk will be split into smaller chunks.",
        examples=[4000],
    )

    chunk_overlap: int = Field(
        100,
        title="Chunk overlap",
        description="Chunk overlap. The chunk overlap is the number of characters that will be shared between two consecutive chunks.",
        examples=[400],
    )
    lang_code: str = Field(
        ...,
        title="The Code language of document.",
        description="The code language of document to save in milvus schema.",
        examples=["fr"],
    )
    enable_smart_chunk: bool = Field(
        False,
        title="Whether to activate the enable_smart_chunk feature or not.",
        description="A boolean flag that, when set to True, Indexation with the smart chunk alse without smart chunk.",
        examples=[True],
    )
    chunk_style : Optional [List[ChunkStyle]] = None
    brain_type : str = Field(
    ...,
    title="The type of brain. eg : doc or graph",
    description="The type of brain. eg : doc or graph",
    example="doc",
    )
    enable_extract_images: Optional[bool] = Field(False, description="Whether to generate a description for images in the PDF",examples=[False])
    webhook_url : str = Field(
        ...,
        title="Webhook URL",
        description="Webhook URL to send the indexation status to.",
        examples=["https://example.com/webhook"],
    )
    brain_tag: Optional[list[str]]
    image_analyzer : Optional[bool] = Field(False, description="Whether to generate a description for images process", examples=[False])
    oneshot_prompt: Optional[str] = Field(None, description="Prompt to use for oneshot generation", examples=["How to "
                                                                                                           "make a cake"])
    in_memory: Optional[bool] = Field(False, description="Whether to save the document as a template", examples=[False])

    @root_validator(pre=True)
    def deprecated_fields(cls, values):
        filename = values.get("filename")
        filepath = values.get("filepath")
        saved_source = values.get("saved_source")
        source = values.get("source")
        if filename is not None and filepath is None:
            values["filepath"] = filename
        if saved_source is not None and source is None:
            values["source"] = saved_source
        return values


class IndexChunk(IndexText):
    source: str = Field(
        ...,
        title="Source of the document index",
        description="Source of the document index. It is the source of the document that will be saved in the vector database.",
        examples=["https://www.example.com/30-recettes-preferees-des-francais.pdf"],
    )
    parent_pk: int = Field(
        ...,
        title="Primary key of the original chunk",
        description="Id of the chunk to modify. It will be saved in the modified chunk as its parent.",
        examples=[444118749865925670],
    )
    chunk_text: str = Field(
        ...,
        title="New content of the ckunk",
        description="Modified text from the original chunk.",
        examples=["modified document text"],
    )


class IndexDocumentsFromAzureDatalake(VectorStore):
    documents: List[IndexDocument] = Field(
        ...,
        title="List of documents to index",
        description="List of documents to index. The documents must already exist in the blob storage.",
        examples=[[
            {
                "filepath": "30-recettes-preferees-des-francais.pdf",
                "brain_id": "brain1",
                "external_id": "external1",
                "user_id": "user1",
            },
            {
                "filepath": "30-recettes-preferees-des-francais.pdf",
                "brain_id": "brain1",
                "external_id": "external1",
                "user_id": "user1",
            },
        ]],
    )

class VectorStoreQuery_ForDelete(BaseModel):
    brain_id: Optional[str] = Field(
        None,
        title="Brain IDs",
        description="Brain IDs. The brain ID is used to filter the results by brain ID. If not provided, all brain IDs will be considered.",
        examples=["brain1"],
    )
    external_id: Optional[str] = Field(
        None,
        title="External ID",
        description="External ID. The external ID is used to filter the results by external ID. If not provided, all external IDs will be considered.",
        examples=["external1"],
    )


class VectorStoreQuery(VectorStore):
    brain_id: Optional[str] = Field(
        None,
        title="Brain IDs",
        description="Brain IDs. The brain ID is used to filter the results by brain ID. If not provided, all brain IDs will be considered.",
        examples=["brain1"],
    )
    external_id: Optional[str] = Field(
        None,
        title="External ID",
        description="External ID. The external ID is used to filter the results by external ID. If not provided, all external IDs will be considered.",
        examples=["external1"],
    )
    image_analyzer : Optional[bool] = Field(False, description="Whether to generate a description for images process", examples=[False])


class VectorStoreDeleteById(VectorStore):
    vector_ids: List[str] = Field(
        ...,
        title="Vector IDs",
        description="Vector IDs. The vector IDs are used to delete vectors from the vector database.",
        examples=[["vector1"], "vector2"],
    )


class VectorStoreCopy(VectorStore):
    new_vectorstore_name: str = Field(
        ...,
        pattern="^[0-9a-zA-Z_]+$",
        title="Name of the new vector store",
        description="Name of the new vector store. Must be alphanumeric and underscores only.",
        examples=["vectorstore2"],
    )
    extra_fields: Optional[Dict[str, Any]] = Field(
        None,
        title="Extra fields to add to the new vector store.",
        description="When a new feature requires a new collection in the vector store. The new fields with default values must be mentioned in this dictionary.",
        examples=[{"isdropped": False, "parent_pk": -1}],
    )
    


class ChangeDocumentLanguage(VectorStore):
    external_id: str = Field(
        ...,
        title="External ID of the document",
        description="External ID of the document. This is an optional field that is only used to provide more information about the document.",
        examples=["external1"],
    )
    lang_code: str = Field(
        ...,
        title="The Code language of document.",
        description="The code language of document to save in milvus schema.",
        examples=["fr"],
    )


class ClassifyDocumentRequest(BaseModel):
    """Request schema for document classification from Azure Data Lake."""
    vectorstore_name: str = Field(
        ...,
        title="Vector store name",
        description="Name of the vector store/index (for reference and tracking)",
        examples=["my_vectorstore"],
    )
    file_path: str = Field(
        ...,
        title="File path",
        description="Azure Data Lake path to the document file to classify. Supported formats: PDF, Excel (.xlsx, .xls), PowerPoint (.pptx, .ppt), Word (.docx, .doc), and Text (.txt)",
        examples=["documents/invoices/inv_001.pdf", "documents/spreadsheet.xlsx", "documents/presentation.pptx"],
    )
    sheet_name: Optional[str] = Field(
        None,
        title="Sheet name",
        description="Optional sheet name for Excel files. If not provided, all sheets will be processed.",
        examples=["Sheet1", "Data", "Summary"],
    )
    structure_template: Optional[List[Dict[str, Any]]] = Field(
        default=[],
        title="Classification structure template",
        description="Hierarchy structure for classification (same format as indexing). Use empty array [] to allow LLM to create its own categories.",
        examples=[[{
            "directory": "finance",
            "id": "dir_001",
            "sous_directories": [{"directory": "invoices", "id": "dir_002"}]
        }]],
    )
    prompt: Optional[str] = Field(
        None,
        title="Classification prompt",
        description="Custom classification prompt. Use {structure_template} placeholder to insert the category list and {content} placeholder for the document content. "
                    "If not provided, uses the default system prompt.",
        examples=[
            "Classify this document into one of these categories: {structure_template}",
            "You are an expert document classifier. Analyze the following content and determine the best category from: {structure_template}\n\nContent: {content}"
        ],
    )
    webhook_url: Optional[str] = Field(
        None,
        title="Webhook URL",
        description="Optional webhook URL for classification completion notifications",
        examples=["https://example.com/webhook/classification"],
    )
    metadata: Optional[Dict[str, str]] = Field(
        None,
        title="Metadata",
        description="Optional additional metadata to include with the task",
        examples=[{"department": "finance", "priority": "high"}],
    )

    # Supported file extensions for classification
    SUPPORTED_EXTENSIONS: ClassVar[set[str]] = {
        '.pdf',           # PDF documents
        '.xlsx', '.xls',  # Excel spreadsheets
        '.pptx', '.ppt',  # PowerPoint presentations
        '.docx', '.doc',  # Word documents
        '.txt',           # Text files
    }

    @validator('file_path')
    def validate_file_path(cls, v):
        if not v.strip():
            raise ValueError('File path cannot be empty')

        ext = v.lower().rsplit('.', 1)[-1] if '.' in v else ''
        full_ext = f'.{ext}' if ext else ''

        if full_ext not in cls.SUPPORTED_EXTENSIONS:
            supported = ', '.join(sorted(cls.SUPPORTED_EXTENSIONS))
            raise ValueError(f'Unsupported file format: {full_ext}. Supported formats: {supported}')
        return v

    @validator('structure_template')
    def validate_structure_template(cls, v):
        # v can be None due to Optional field, but since we have default=[], it will be []
        if v is not None and not isinstance(v, list):
            raise ValueError('Structure template must be a list')
        return v or []  # Ensure we always return a list
class SendMessageToKafka(BaseModel):
    message: dict = Field(...)
    topic: str = Field(..., examples=["metachatbot-api.debug"])


# Custom Exception Classes for Vectorstore Module
from src.schema.exception import APIBaseException


class VectorstoreBaseException(APIBaseException):
    """Base exception for vectorstore module"""
    def __init__(self, message: str, error_code: str = "VECTORSTORE_ERROR", details: Optional[dict] = None):
        super().__init__(message=message, error_code=error_code, details=details)


class VectorstoreIndexingError(VectorstoreBaseException):
    """Exception for document indexing errors"""
    def __init__(self, message: str, indexing_operation: str, details: Optional[dict] = None):
        super().__init__(
            message=message,
            error_code="VECTORSTORE_INDEXING_ERROR",
            details={"indexing_operation": indexing_operation, **(details or {})}
        )


class VectorstoreSearchError(VectorstoreBaseException):
    """Exception for similarity search errors"""
    def __init__(self, message: str, search_operation: str, details: Optional[dict] = None):
        super().__init__(
            message=message,
            error_code="VECTORSTORE_SEARCH_ERROR",
            details={"search_operation": search_operation, **(details or {})}
        )


class VectorstoreValidationError(VectorstoreBaseException):
    """Exception for input validation errors"""
    def __init__(self, message: str, field: str, details: Optional[dict] = None):
        super().__init__(
            message=message,
            error_code="VECTORSTORE_VALIDATION_ERROR",
            details={"field": field, **(details or {})}
        )


class VectorstoreConnectionError(VectorstoreBaseException):
    """Exception for vectorstore connection errors"""
    def __init__(self, message: str, connection_target: str, details: Optional[dict] = None):
        super().__init__(
            message=message,
            error_code="VECTORSTORE_CONNECTION_ERROR",
            details={"connection_target": connection_target, **(details or {})}
        )


class VectorstoreTaskError(VectorstoreBaseException):
    """Exception for task processing errors"""
    def __init__(self, message: str, task_operation: str, details: Optional[dict] = None):
        super().__init__(
            message=message,
            error_code="VECTORSTORE_TASK_ERROR",
            details={"task_operation": task_operation, **(details or {})}
        )


class VectorstoreDeletionError(VectorstoreBaseException):
    """Exception for document deletion errors"""
    def __init__(self, message: str, deletion_operation: str, details: Optional[dict] = None):
        super().__init__(
            message=message,
            error_code="VECTORSTORE_DELETION_ERROR",
            details={"deletion_operation": deletion_operation, **(details or {})}
        )


class VectorstoreWebhookError(VectorstoreBaseException):
    """Exception for webhook processing errors"""
    def __init__(self, message: str, webhook_operation: str, details: Optional[dict] = None):
        super().__init__(
            message=message,
            error_code="VECTORSTORE_WEBHOOK_ERROR",
            details={"webhook_operation": webhook_operation, **(details or {})}
        )

