import logging
from dataclasses import asdict, dataclass

logger = logging.getLogger(__name__)


@dataclass
class GuardrailAuditEvent:
    guardrail_type: str
    phase: str
    runtime_surface: str
    policy_source: str
    mode: str
    decision: str
    confidence: float = 0.0
    reason: str = ""
    agent_id: str = ""
    conversation_id: str = ""
    flow_id: str = ""
    execution_id: str = ""
    node_id: str = ""
    tool_name: str = ""
    tool_safety: str = ""
    classifier_latency_ms: int = 0
    classifier_error: str = ""


def audit_guardrail_decision(event: GuardrailAuditEvent) -> None:
    logger.info("[GUARDRAIL_AUDIT] %s", asdict(event))


def audit_prompt_injection_decision(
    phase: str,
    source: str,
    decision: str,
    confidence: float,
    attack_type: str,
    target: str,
) -> None:
    logger.info(
        "[GUARDRAIL] prompt_injection decision phase=%s source=%s decision=%s confidence=%s attack_type=%s target=%s",
        phase,
        source,
        decision,
        confidence,
        attack_type,
        target,
    )
