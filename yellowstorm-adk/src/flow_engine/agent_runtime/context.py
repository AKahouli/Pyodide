from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class StepRuntimeContext:
    model_id: str
    runtime_surface: str = "playbook_langgraph"
    execution_id: str = ""
    flow_id: str = ""
    node_id: str = ""
    iteration: int = 0
    user_id: str = ""
    agent_id: str = ""
    agent_name: str = ""
    task_instruction: str = ""
    original_user_request: str = ""
    agent_config: dict[str, Any] = field(default_factory=dict)
    hitl_policy: dict[str, Any] = field(default_factory=dict)
    hitl_blockers: list[dict[str, Any]] = field(default_factory=list)
    label: str = ""
    writer: Any = None
    on_progress: Any = None
    on_trace_update: Any = None
    trace_collector: Any = None
    agent_role: str = "parent"
    summary_session_id: str = ""
    tools_enabled: bool = False
    max_tool_iterations: int = 50
