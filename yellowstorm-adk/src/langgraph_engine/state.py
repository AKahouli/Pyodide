"""LangGraph state definitions for playbook execution."""

from typing import List, Optional, Dict, Any, Annotated
from typing_extensions import TypedDict


class NodeTiming(TypedDict):
    """Timing information for a task/node execution."""
    started_at: Optional[str]
    completed_at: Optional[str]
    duration_ms: Optional[int]


class AgentConfig(TypedDict):
    """Configuration for an agent."""
    id: str
    name: str
    description: str
    prompt: str
    instructions: str
    tools: Optional[List[Dict[str, Any]]]
    model: Optional[str]
    brain_ids: Optional[List[str]]
    brain_documents: Optional[List[Dict[str, Any]]]
    agent_params: Optional[Dict[str, str]]
    agent_type: Optional[str]


class TaskConfig(TypedDict):
    """Configuration for a task."""
    id: str
    title: str
    description: str
    assigned_agent_id: Optional[str]
    execution_order: int
    interrupt_before: bool
    interrupt_after: bool
    allow_clarification: bool
    clarification_prompt: Optional[str]
    max_clarifications: int
    input_keys: Optional[List[str]]
    output_key: Optional[str]
    input_files: Optional[List[str]]  # List of document external_ids to restrict search to


class EdgeConfig(TypedDict):
    """Configuration for a task dependency edge."""
    source_id: str
    target_id: str


# --- Reducers for handling concurrent graph updates ---

def merge_results(left: Dict[str, Any], right: Dict[str, Any]) -> Dict[str, Any]:
    """Merge results dictionaries from concurrent task executions."""
    if not left:
        return right
    if not right:
        return left
    return {**left, **right}


def merge_timings(left: Dict[str, NodeTiming], right: Dict[str, NodeTiming]) -> Dict[str, NodeTiming]:
    """Merge node_timings dictionaries from concurrent task executions."""
    if not left:
        return right
    if not right:
        return left
    return {**left, **right}


def merge_task_ids(left: List[str], right: List[str]) -> List[str]:
    """Merge task ID lists from concurrent task executions (deduplicated)."""
    if not left:
        return right
    if not right:
        return left
    seen = set(left)
    result = list(left)
    for item in right:
        if item not in seen:
            result.append(item)
            seen.add(item)
    return result


class ExecutionState(TypedDict):
    """State for playbook task execution workflow."""
    playbook_id: str
    thread_id: Optional[str]
    tasks: List[TaskConfig]
    edges: List[EdgeConfig]
    agents: Dict[str, AgentConfig]
    current_task_ids: List[str]
    completed_task_ids: Annotated[List[str], merge_task_ids]
    results: Annotated[Dict[str, Any], merge_results]
    status: str  # 'in_progress' | 'suspended' | 'completed' | 'failed'
    error: Optional[str]
    interrupt_payload: Optional[Dict[str, Any]]
    node_timings: Annotated[Dict[str, NodeTiming], merge_timings]
    query: Optional[str]
    workspace_context: Optional[List[Dict[str, Any]]]
    evaluation_user_id: Optional[str]
    execution_mode: Optional[str]
    validated_replays_by_task: Optional[Dict[str, Any]]
    step_execution_modes: Optional[Dict[str, str]]
