from typing import List, Optional, Dict, Any

from pydantic import HttpUrl, BaseModel

class AttributeSpec(BaseModel):
    name: str
    description: str

class ProcessRequest(BaseModel):
    paths: List[str]
    num_pages: Optional[int] = 10
    webhook_url: HttpUrl
    metadata:  Dict[str, Any]
    attributes: List[AttributeSpec]



