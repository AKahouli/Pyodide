from pydantic import BaseModel
from typing import List, Dict

class ChatRequest(BaseModel):
    graphml_path: str = r"mariem/graphml_test.graphml"
    metadata: dict
    temperature: float = 0
    max_tokens: int = 4096
    max_retries: int = 6
    chatbot_name: str
    conversation_id: str
    message: str
    brain_ids: List[str]
    top_k: int
    collection_name : str
    user_prompt: str
    