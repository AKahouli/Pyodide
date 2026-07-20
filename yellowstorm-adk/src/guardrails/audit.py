import logging

logger = logging.getLogger(__name__)


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
