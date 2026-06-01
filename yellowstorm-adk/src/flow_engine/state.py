"""LangGraph state definitions for the new playbook-flow engine.

ExecutionState is the single TypedDict flowing through the graph.
Every field has an explicit reducer so parallel branches compose safely.
"""

from typing import Any, Optional
from typing_extensions import Annotated, TypedDict

from src.flow_engine.reducers import append, last_write, max_of, or_, set_by_key


class ExecutionError(TypedDict):
    node_id: str
    iteration: int
    message: str
    code: str


class PendingApproval(TypedDict):
    node_id: str
    iteration: int
    prompt: str
    timeout_at: Optional[str]


class ExecutionState(TypedDict):
    execution_id: str
    flow_id: str
    inputs: dict[str, Any]
    task_outputs: Annotated[dict[tuple[str, int], Any], set_by_key]
    iterations: Annotated[dict[str, int], max_of]
    router_decisions: Annotated[dict[str, str], set_by_key]
    errors: Annotated[list[ExecutionError], append]
    pending_approval: Annotated[Optional[PendingApproval], last_write]
    cancelled: Annotated[bool, or_]
    hitl_checkpoint: Annotated[Optional[dict[str, Any]], last_write]
    evaluation_user_id: Annotated[Optional[str], last_write]
    human_context: Annotated[list[dict[str, Any]], append]
    hitl_events: Annotated[list[dict[str, Any]], append]
    hitl_policy: Annotated[dict[str, Any], last_write]
    hitl_blockers: Annotated[list[dict[str, Any]], append]
    hitl_memory: Annotated[list[dict[str, Any]], append]
