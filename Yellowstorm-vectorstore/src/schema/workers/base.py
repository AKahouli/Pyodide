from enum import Enum
from typing import Dict, Optional, Any

from pydantic import BaseModel


class NotificationIdType(str, Enum):
    RESPONSE = "response"
    INDEXING = "indexing"
    DOWNLOAD = "download"


class NotificationStatus(str, Enum):
    START = "START"
    FINISH = "FINISH"
    FAIL = "FAIL"


class KafkaWorkerMessage(BaseModel):
    username: str
    metadata: Dict[str, str]


class NotificationKafkaMessage(BaseModel):
    id_type: NotificationIdType
    id: str
    status: NotificationStatus
    metadata: Dict[str, str]
    status_image : Optional[NotificationStatus]=None


class TaskErrorDetails(BaseModel):
    """Structured error details for task failures"""
    error_code: str
    message: str
    details: Optional[Dict[str, Any]] = None
    task_name: Optional[str] = None
    stack_trace: Optional[str] = None

class WebhookNotificationPayload(BaseModel):
    """Enhanced notification payload for indexation tasks"""
    event_type: str
    metadata: Dict[str, Any]
    # Optional task_id (included in metadata for classification events)
    task_id: Optional[str] = None
    # for indexation notification
    status: Optional[NotificationStatus] = None
    status_image: Optional[NotificationStatus] = None
    status_logical: Optional[NotificationStatus] = None
    error_details: Optional[TaskErrorDetails] = None
    error_details_image: Optional[TaskErrorDetails] = None
    # for language detection notification
    detected_language: Optional[str] = None
    detection_confidence: Optional[float] = None
    # for file classification
    detected_category: Optional[str] = None
    category_confidence: Optional[float] = None
    # New fields for LLM-only classification with new category detection
    is_new_category: Optional[bool] = None
    category_source: Optional[str] = None  # "llm_new" or "llm_existing"
    category_id: Optional[str] = None
    # Sheet name for Excel files
    sheet_name: Optional[str] = None
