from enum import Enum
from typing import List, Optional, Tuple, Dict

from pydantic import BaseModel


class PlanRequest(BaseModel):
    method_brain: str
    plan_prompt: str
    oneshot_prompt: str
    webhook_url:str
    metadata:Dict[str, str]


class ConformityRequest(BaseModel):
    task: str
    method_brain: str
    client_brain: str
    collection_name: str
    webhook_url: str = ""
    user_id: Optional[str]


class DocumentModel(BaseModel):
    metadata: dict


class PostQueryRequest(BaseModel):
    documents: List[DocumentModel]
    collection_name: str


class ClientInfoRequest(BaseModel):
    query: str
    truth: str


class RetrieverInfoRequest(BaseModel):
    truth: Optional[str] = None
    topic: Optional[str] = None
    user_id: Optional[str] = 'Salah - Test'
    brain_id: str
    query: str
    collection_name: str
    search_type: str


class TaskStatus(Enum):
    PENDING = "PENDING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"

    class Config:
        use_enum_values = True


class ConformityTaskDetails(BaseModel):
    status: TaskStatus
    result: Optional[Tuple[str, str, str]] = None

    class Config:
        use_enum_values = True


class StreamConformityRequest(BaseModel):
    task: str
    method_brain: str
    client_brain: str
    collection_name: str
    prompt: str
    user_id: str
    detailed_audit: Optional[bool] = None