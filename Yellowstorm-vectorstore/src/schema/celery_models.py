"""Celery models for FastAPI."""
from typing import Any,Optional

from pydantic import BaseModel


class TaskID(BaseModel):
    id: str


class TaskStatus(TaskID):
    status: str
    result: Any

class TaskIDS(BaseModel):
    id: str
    temp_folder: str
    id_image : Optional[str]
    id_classification : Optional[str]
    id_redis: Optional[str] = None  # task ID for redis_group (independent pipeline)
