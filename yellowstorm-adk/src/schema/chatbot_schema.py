"""Pydantic models for chatbot endpoints."""

from typing import Any, Dict, List, Optional

from pydantic import BaseModel


def _sync_workspace_aliases(data: Dict[str, Any]) -> Dict[str, Any]:
    if data.get("brain_ids") is None and data.get("workspace_names") is not None:
        data["brain_ids"] = data["workspace_names"]
    if data.get("workspace_names") is None and data.get("brain_ids") is not None:
        data["workspace_names"] = data["brain_ids"]
    return data


class SkillFile(BaseModel):
    path: str
    kind: str
    mime_type: str = ""
    content: str = ""


class Skill(BaseModel):
    id: str
    name: str
    description: str
    instructions: str = ""
    license: str = ""
    compatibility: str = ""
    metadata: Optional[Dict[str, str]] = None
    allowed_tools: Optional[List[str]] = None
    files: Optional[List[SkillFile]] = None


class ChatWithADKRequest(BaseModel):
    """Schema for chat requests sent to the ADK."""
    user_id: str
    session_id: str
    max_tokens: int = 512
    instructions: Optional[str] = None
    chatbot_name: dict
    message: str
    image_input: Optional[List[Dict]] = None
    top_k: int = 2
    vectorstore_name: Optional[str] = "vectorstorerec"
    workspace_names: Optional[List[str]] = None
    brain_ids: Optional[List[str]] = None
    enable_multilingual: bool = False
    brain_documents: Optional[List] = None
    brain_relations: Optional[Dict] = None
    languages: Optional[List[str]] = None
    search_web: Optional[bool] = False

    def __init__(self, **data: Any) -> None:
        super().__init__(**_sync_workspace_aliases(data))


class AgentSuggestion(BaseModel):
    """Schema for agent suggestions."""
    id: str = "no_id"
    name: str
    description: str
    prompt: str
    instruction: Optional[str] = None # Compatibility alias for prompt
    model: Optional[str] = None       # Compatibility alias for chatbot_name['name']
    tools: Optional[List[Dict]] = None
    workspace_names: Optional[List[str]] = None
    knowledge_bases: Optional[List[str]] = None # Compatibility alias for workspace_names
    skills: Optional[List[Skill]] = None
    #tools example : [{"name": "search_web","prompt":"","description": "Useful for when you need to answer questions about current events or the web. Input should be a search query.", "top_k": 3}]
    html: Optional[bool] = False
    vectorstore_name: Optional[str] = "vectorstorerec"
    workspace_names: Optional[List[str]] = []
    brain_ids: Optional[List[str]] = []
    brain_documents: Optional[List] = []
    brain_relations: Optional[Dict] = {'nodes': [], 'relationships': []}
    chatbot_name: Optional[dict] = None  # If not provided, will inherit from RunAgentTeamRequest.chatbot_name
    chatbot: Optional[dict] = None  # NestJS compatibility alias for chatbot_name
    agent_params: Optional[Dict] = None
    agent_type: Optional[str] = None  # Can be "normal" or "manager"
    save_memory: Optional[bool] = False
    mcp: Optional[Dict] = None

    def __init__(self, **data: Any) -> None:
        super().__init__(**_sync_workspace_aliases(data))


class RunAgentTeamRequest(BaseModel):
    """Schema for running agent team requests."""

    user_id: str
    session_id: str
    message: str
    image_input: Optional[List[Dict]] = None
    attached_files: Optional[List[Dict]] = None
    attached_images: Optional[List[Dict]] = None
    previous_attached_files: Optional[List[Dict]] = None
    manager_prompt: str = "You are a manager agent that coordinates tasks between specialized agents."
    chatbot_name: dict
    agents: Optional[List[AgentSuggestion]] = []
    available_agents: Optional[List[AgentSuggestion]] = []
    available_tools: Optional[List[Dict]] = []
    vectorstore_name: str = "default"
    workspace_names: Optional[List[str]] = None
    brain_ids: Optional[List[str]] = None
    brain_documents: Optional[List] = None
    brain_relations: Optional[Dict] = None
    search_web: Optional[bool] = False
    agent_mode: str
    connector_repo: Optional[Dict[str, str]] = None
    skills: Optional[List[Skill]] = None  # Conversation-level skills selected by the user

    def __init__(self, **data: Any) -> None:
        super().__init__(**_sync_workspace_aliases(data))

class UserContext(BaseModel):
    """Schema for user context (user_id + username together)."""
    user_id: str
    username: str


class Document(BaseModel):
    """Schema for document with minimal required fields."""
    _id: str
    filename: str
    type: str


class WorkspaceContext(BaseModel):
    """Schema for workspace context (single workspace_id + documents)."""
    workspace_id: str
    workspace_documents: List[Document]


class Chatbot(BaseModel):
    """Schema for chatbot configuration."""
    name: str
    prompt: str


class ConfigAgentsWithSkillsRequest(BaseModel):
    """Schema for configuring an agent with skills."""

    agent: AgentSuggestion
    skills: str

class RunSingleAgentRequest(BaseModel):
    """Schema for running a single agent request."""

    user_id: str
    session_id: str
    message: str
    agent: AgentSuggestion

class ClearAgentMemoryRequest(BaseModel):
    """Schema for clearing agent memory request."""

    agent_id: str

class ChatCompletionRequest(BaseModel):
    """Schema for simple chat completion request."""

    message: str
    model: str
    temperature: Optional[float] = 0.7
    max_tokens: Optional[int] = None

