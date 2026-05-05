"""LangGraph state definitions for playbook execution."""

from typing import List, Optional, Dict, Any, Annotated, Callable, Awaitable
from typing_extensions import TypedDict

_STATUS_SEVERITY = {
    "failed": 0,
    "suspended": 1,
    "in_progress": 2,
    "completed": 3,
    "skipped": 4,
}


class NodeTiming(TypedDict):
    started_at: Optional[str]
    completed_at: Optional[str]
    duration_ms: Optional[int]


class AgentConfig(TypedDict):
    id: str
    name: str
    description: str
    prompt: str
    instructions: str
    tools: Optional[List[Dict[str, Any]]]
    skills: Optional[List[Dict[str, Any]]]
    model: Optional[str]
    brain_ids: Optional[List[str]]
    brain_documents: Optional[List[Dict[str, Any]]]
    agent_params: Optional[Dict[str, str]]
    agent_type: Optional[str]


class TaskConfig(TypedDict):
    id: str
    title: str
    description: str
    assigned_agent_id: Optional[str]
    execution_mode: Optional[str]
    selected_action: Optional[str]
    execution_order: int
    interrupt_before: bool
    interrupt_after: bool
    allow_clarification: bool
    clarification_prompt: Optional[str]
    max_clarifications: int
    input_keys: Optional[List[str]]
    output_key: Optional[str]
    input_files: Optional[List[str]]
    input_files_by_port: Optional[List[Dict[str, Any]]]  # Port-aware document bindings
    task_type: Optional[str]
    task_metadata: Optional[Dict[str, Any]]
    evaluation_config: Optional[Dict[str, Any]]
    input_ports: Optional[List[Dict[str, Any]]]
    output_ports: Optional[List[Dict[str, Any]]]


class EdgeConfig(TypedDict):
    source_id: str
    target_id: str
    source_output_port_id: Optional[str]
    target_input_port_id: Optional[str]


class StepUpdate(TypedDict, total=False):
    task_id: str
    task_title: str
    status: str
    result: Optional[Dict[str, Any]]
    interrupt: Optional[Dict[str, Any]]


StepCallback = Callable[[StepUpdate], Awaitable[None]]


async def _noop_step_callback(_update: StepUpdate) -> None:
    pass


NoopStepCallback: StepCallback = _noop_step_callback


def merge_results(left: Dict[str, Any], right: Dict[str, Any]) -> Dict[str, Any]:
    if not left:
        return right
    if not right:
        return left
    return {**left, **right}


def merge_timings(
    left: Dict[str, NodeTiming], right: Dict[str, NodeTiming]
) -> Dict[str, NodeTiming]:
    if not left:
        return right
    if not right:
        return left
    return {**left, **right}


def merge_task_ids(left: List[str], right: List[str]) -> List[str]:
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


def merge_task_outputs(left: Dict[str, str], right: Dict[str, str]) -> Dict[str, str]:
    if not left:
        return right
    if not right:
        return left
    return {**left, **right}


def merge_clarification_transcripts(
    left: Dict[str, List[Dict[str, str]]],
    right: Dict[str, List[Dict[str, str]]],
) -> Dict[str, List[Dict[str, str]]]:
    if not left:
        return right
    if not right:
        return left

    merged: Dict[str, List[Dict[str, str]]] = {
        key: list(value or []) for key, value in left.items()
    }
    for key, value in right.items():
        incoming = value if isinstance(value, list) else [value]
        valid_turns = [item for item in incoming if isinstance(item, dict)]
        if key in merged:
            merged[key].extend(valid_turns)
        else:
            merged[key] = valid_turns
    return merged


def merge_task_description_overrides(
    left: Dict[str, str], right: Dict[str, str]
) -> Dict[str, str]:
    if not left:
        return right
    if not right:
        return left
    return {**left, **right}


def merge_artifacts(
    left: Dict[str, List[Dict[str, Any]]], right: Dict[str, List[Dict[str, Any]]]
) -> Dict[str, List[Dict[str, Any]]]:
    if not left:
        return right
    if not right:
        return left

    merged: Dict[str, List[Dict[str, Any]]] = {
        key: list(value or []) for key, value in left.items()
    }
    for key, value in right.items():
        incoming = value if isinstance(value, list) else [value]
        if key in merged:
            merged[key].extend([item for item in incoming if isinstance(item, dict)])
        else:
            merged[key] = [item for item in incoming if isinstance(item, dict)]
    return merged


def merge_status(left: str, right: str) -> str:
    higher_severity_wins = _STATUS_SEVERITY.get(left, 99) <= _STATUS_SEVERITY.get(
        right, 99
    )
    return left if higher_severity_wins else right


def merge_error(left: Optional[str], right: Optional[str]) -> Optional[str]:
    if left:
        return left
    return right


class ExecutionState(TypedDict):
    playbook_id: str
    thread_id: Optional[str]
    tasks: List[TaskConfig]
    edges: List[EdgeConfig]
    agents: Dict[str, AgentConfig]
    current_task_ids: List[str]
    completed_task_ids: Annotated[List[str], merge_task_ids]
    results: Annotated[Dict[str, Any], merge_results]
    status: Annotated[str, merge_status]
    error: Annotated[Optional[str], merge_error]
    interrupt_payload: Optional[Dict[str, Any]]
    node_timings: Annotated[Dict[str, NodeTiming], merge_timings]
    query: Optional[str]
    workspace_context: Optional[List[Dict[str, Any]]]
    brain_documents: Optional[List[Dict[str, Any]]]
    trigger_context: Optional[Dict[str, Any]]
    evaluation_user_id: Optional[str]
    execution_mode: Optional[str]
    validated_replays_by_task: Optional[Dict[str, Any]]
    step_execution_modes: Optional[Dict[str, str]]
    user_language: Optional[str]
    prompt_overrides: Optional[Dict[str, str]]
    task_outputs: Annotated[Dict[str, str], merge_task_outputs]
    artifacts_by_port: Annotated[Dict[str, List[Dict[str, Any]]], merge_artifacts]
    node_inputs_by_port: Annotated[Dict[str, List[Dict[str, Any]]], merge_artifacts]
    clarification_transcripts_by_task: Annotated[
        Dict[str, List[Dict[str, str]]], merge_clarification_transcripts
    ]
    task_description_overrides_by_task: Annotated[
        Dict[str, str], merge_task_description_overrides
    ]
