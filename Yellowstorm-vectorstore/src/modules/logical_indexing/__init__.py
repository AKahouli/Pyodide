"""
Logical Indexing Module

This module provides document structure parsing capabilities using
gRPC layout detection + PyMuPDF text extraction.

Components:
- LayoutPyMuPDFPipeline: Fast pipeline for document parsing
- InternalLayoutClient: gRPC client for layout detection
- doc_outline_v2: Document compilation and structure building
- tree_builder: Hierarchical document tree construction
- tasks: Celery tasks for async processing
"""

from src.modules.logical_indexing.layout_pymupdf_pipeline import LayoutPyMuPDFPipeline
from src.modules.logical_indexing.internal_layout_client import InternalLayoutClient
from src.modules.logical_indexing.tasks import (
    parse_document_logical_task,
    get_logical_indexing_result,
    delete_logical_indexing_result,
)

__all__ = [
    "LayoutPyMuPDFPipeline",
    "InternalLayoutClient",
    "parse_document_logical_task",
    "get_logical_indexing_result",
    "delete_logical_indexing_result",
]
