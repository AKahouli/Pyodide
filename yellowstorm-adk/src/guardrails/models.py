from dataclasses import dataclass, field
from typing import Any


@dataclass
class GuardrailContext:
    phase: str
    runtime_surface: str
    user_id: str = ""
    agent_id: str = ""
    agent_name: str = ""
    conversation_id: str = ""
    flow_id: str = ""
    execution_id: str = ""
    node_id: str = ""
    iteration: int = 0
    channel: str = ""
    source: str = ""
    original_user_request: str = ""
    task_instruction: str = ""
    tool_name: str = ""
    tool_args: dict[str, Any] = field(default_factory=dict)
    tool_metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class GuardrailDecision:
    decision: str = "allow"
    text: str = ""
    reason: str = ""
    confidence: float = 0.0
    blocked: bool = False
    sanitized: bool = False
    safe_rewrite: str | None = None
    attack_type: str = "none"
    target: str = "none"
    block_message: str = ""
    classifier_error: str = ""
