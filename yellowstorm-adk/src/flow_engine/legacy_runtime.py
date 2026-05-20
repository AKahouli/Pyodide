"""Facade for the legacy langgraph_engine runtime used by ChatbotService RPCs.

All legacy playbook RPC methods (RunPlaybookWorkflow, ResumePlaybookWorkflow,
RunStep, RunStepStream) delegate to the old execution engine.  This module
provides a single import surface so that chatbot_servicer never references
src.langgraph_engine directly.

When the legacy RPCs are decommissioned, this file can be deleted in one pass.
"""

from src.langgraph_engine.types import ArtifactRef, Emission, PortPayload
from src.langgraph_engine.action_executor import execute_action_task, resolve_indexing_webhook
from src.langgraph_engine.step_executor import execute_step, resume_step
from src.langgraph_engine.workflow_service import run_playbook, resume_playbook
from src.langgraph_engine.playbook_queue import (
    cancel_task,
    register_task,
    remove_task,
)

__all__ = [
    "ArtifactRef",
    "Emission",
    "PortPayload",
    "cancel_task",
    "execute_action_task",
    "execute_step",
    "register_task",
    "remove_task",
    "resume_playbook",
    "resume_step",
    "resolve_indexing_webhook",
    "run_playbook",
]
