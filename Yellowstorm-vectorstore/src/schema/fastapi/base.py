from typing import Dict

from pydantic import BaseModel, Field


class WorkerRquest(BaseModel):
    metadata: Dict[str, str] = Field(
        {},
        examples=[{"user_id": "123456789"}],
        title="Metadata",
        description="Metadata. The metadata is a dictionary that will be used to provide more information about the document when logging and sending notification.",
    )
