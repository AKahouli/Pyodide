"""Document status models for tracking processing state."""

from enum import Enum


class DocumentStatus(str, Enum):
    """Processing status of a document during indexing.

    IMPORTED : document has been received from the UI waiting to be queued for processing
    PENDING: Document indexing request received, waiting to be processed
    COMPLETED: Document has been successfully indexed
    FAILED: Document indexing failed
    """
    IMPORTED = "IMPORTED"
    PENDING = "PENDING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
