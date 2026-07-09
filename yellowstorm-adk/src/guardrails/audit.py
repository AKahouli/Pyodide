import logging

logger = logging.getLogger(__name__)


def audit_prompt_injection_decision(
    phase: str,
    source: str,
    mode: str,
    decision: str,
    confidence: float,
    attack_type: str,
    target: str,
) -> None:
    logger.info(
        "[GUARDRAIL] prompt_injection decision phase=%s source=%s mode=%s decision=%s confidence=%s attack_type=%s target=%s",
        phase,
        source,
        mode,
        decision,
        confidence,
        attack_type,
        target,
    )
