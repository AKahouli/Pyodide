from typing import List, Dict, Any

from pydantic import BaseModel, Field


class DeleteCollectionRequest(BaseModel):
    collection_name: str = Field(..., title="Collection Name", description="Name of the collection to delete")

class DeleteByFilterRequest(DeleteCollectionRequest):
    filter: Dict[str, Any] = Field(..., title="Filter", description="Filter to select documents to delete")

class DeleteByIDsRequest(DeleteCollectionRequest):
    ids: List[str] = Field(..., title="IDs", description="IDs of the documents (chunks) to delete")
