"""Pydantic models for playbook_dir endpoints."""

from src.schema.chatbot_schema import AgentSuggestion, RunAgentTeamRequest
from typing import Dict, List, Optional, Any
from pydantic import BaseModel, field_validator, Field


class MailAttachmentWorkspaceImport(BaseModel):
    """Workspace import metadata for a mail attachment."""

    workspaceDocumentId: Optional[str] = None
    filename: str
    finalFilename: Optional[str] = None
    mimeType: Optional[str] = None
    size: Optional[int] = None
    sourcePath: Optional[str] = None
    collisionResolved: bool = False
    error: Optional[str] = None


class MailParticipant(BaseModel):
    """Simple participant metadata for mail payloads."""

    name: Optional[str] = None
    address: str


class MailMessageAttachment(BaseModel):
    """Attachment metadata for mail-trigger payloads."""

    providerAttachmentId: str
    filename: str
    mimeType: Optional[str] = None
    size: Optional[int] = None
    isInline: bool = False
    workspaceImport: Optional[MailAttachmentWorkspaceImport] = None


class MailTriggerRuntimePayload(BaseModel):
    """Normalized runtime payload shape for future mail-trigger executions."""

    provider: str = Field(default="m365")
    mailboxAppKey: str
    providerMessageId: str
    providerThreadId: Optional[str] = None
    receivedAt: str
    subject: str
    bodyText: str
    bodyHtml: Optional[str] = None
    from_: MailParticipant = Field(alias="from")
    to: List[MailParticipant] = Field(default_factory=list)
    cc: List[MailParticipant] = Field(default_factory=list)
    hasAttachments: bool = False
    attachments: List[MailMessageAttachment] = Field(default_factory=list)


class PlaybookMailTriggerNodeInput(BaseModel):
    """Node input shape for future mail-trigger entry nodes."""

    trigger: Dict[str, Any]
    message: MailTriggerRuntimePayload


class RunPlaybookStepRequest(BaseModel):
    """Schema for running a playbook_dir step."""

    messageId: str = Field(..., description="Session ID")
    userId: str = Field(..., description="User ID")
    taskId: str = Field(..., description="Task/step ID")
    taskDescription: str = Field(..., min_length=1, description="Task description")
    task_metadata: Dict[str, Any] = Field(
        default_factory=dict, description="Task metadata"
    )
    result: Optional[str] = Field(None, description="Step result")
    order: int = Field(..., ge=0, description="Step order in playbook")
    agent: AgentSuggestion
    manager_agent: AgentSuggestion
    call_id: str = Field(..., description="Function call ID")
    vectorstore_name: str = Field(..., description="Vectorstore name")
    brain_ids: Optional[List[str]] = Field(
        default_factory=list, description="Brain IDs from config/request"
    )
    brain_documents: Optional[List[Dict[str, Any]]] = Field(
        default_factory=list, description="Brain documents from config/request"
    )
    available_tools: Optional[List[Dict[str, Any]]] = Field(
        default_factory=list, description="Available tools"
    )
    search_documents: Optional[List[str]] = Field(
        default_factory=list,
        description="List of document external_ids to restrict search to. When provided, only filtered search will be available.",
    )

    @field_validator("messageId")
    @classmethod
    def validate_message_id(cls, v):
        """Validate messageId is not empty and has minimum length."""
        if not v or len(v.strip()) < 5:
            raise ValueError("messageId must be at least 5 characters long")
        return v.strip()

    @field_validator("userId")
    @classmethod
    def validate_user_id(cls, v):
        """Validate userId is not empty."""
        if not v or len(v.strip()) == 0:
            raise ValueError("userId cannot be empty")
        return v.strip()

    @field_validator("taskId")
    @classmethod
    def validate_task_id(cls, v):
        """Validate taskId is not empty."""
        if not v or len(v.strip()) == 0:
            raise ValueError("taskId cannot be empty")
        return v.strip()

    @field_validator("taskDescription")
    @classmethod
    def validate_task_description(cls, v):
        """Validate taskDescription is not empty."""
        if not v or len(v.strip()) == 0:
            raise ValueError("taskDescription cannot be empty")
        return v.strip()

    @field_validator("call_id")
    @classmethod
    def validate_call_id(cls, v):
        """Validate call_id is not empty."""
        if not v or len(v.strip()) == 0:
            raise ValueError("call_id cannot be empty")
        return v.strip()

    @field_validator("vectorstore_name")
    @classmethod
    def validate_vectorstore_name(cls, v):
        """Validate vectorstore_name is not empty."""
        if not v or len(v.strip()) == 0:
            raise ValueError("vectorstore_name cannot be empty")
        return v.strip()


class RunPlaybookStepResponse(BaseModel):
    """Schema for playbook_dir step execution response."""

    success: bool
    messageId: str
    taskId: str
    result: Optional[str] = None
    error: Optional[str] = None


class RunPlaybookRequest(RunAgentTeamRequest):
    """Schema for executing a complete playbook with multiple steps."""

    playbook_id: str = Field(..., description="Unique identifier for the playbook")
    playbook_name: str = Field(..., description="Name of the playbook")
    steps: List[RunPlaybookStepRequest] = Field(
        ..., min_length=1, description="List of steps to execute in order"
    )
    manager_agent: AgentSuggestion
    manager_prompt: str = Field(..., description="Prompt for the manager agent")
    brain_ids: Optional[List[str]] = Field(
        default_factory=list, description="Brain IDs from config/request"
    )
    brain_documents: Optional[List[Dict[str, Any]]] = Field(
        default_factory=list, description="Brain documents from config/request"
    )
    available_tools: Optional[List[Dict[str, Any]]] = Field(
        default_factory=list, description="Available tools"
    )
    trigger_context: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Optional trigger context injected by backend-owned playbook triggers.",
    )

    @field_validator("playbook_id")
    @classmethod
    def validate_playbook_id(cls, v):
        """Validate playbook_id is not empty."""
        if not v or len(v.strip()) == 0:
            raise ValueError("playbook_id cannot be empty")
        return v.strip()

    @field_validator("steps")
    @classmethod
    def validate_steps(cls, v):
        """Validate steps list is not empty."""
        if not v or len(v) == 0:
            raise ValueError("steps list cannot be empty")
        return v


class RunPlaybookResponse(BaseModel):
    """Schema for playbook execution response."""

    success: bool
    playbook_id: str
    total_steps: int
    completed_steps: int
    failed_steps: int
    step_results: List[RunPlaybookStepResponse] = Field(
        default_factory=list, description="Results of each step execution"
    )
    final_session_id: Optional[str] = None
    error: Optional[str] = None
