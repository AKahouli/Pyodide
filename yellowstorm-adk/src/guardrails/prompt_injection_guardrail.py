from dataclasses import dataclass
from typing import Any

from src.guardrails.audit import audit_prompt_injection_decision
from src.guardrails.classifier import classify_prompt_injection
from src.guardrails.config import resolve_effective_guardrails


@dataclass
class GuardrailResult:
    decision: str
    text: str
    blocked: bool = False
    sanitized: bool = False
    reason: str = ""
    safe_rewrite: str | None = None
    confidence: float = 0.0
    attack_type: str = "none"
    target: str = "none"
    phase: str = "unknown"
    source: str = "unknown"

    def decision_metadata(self) -> dict[str, Any]:
        return {
            "phase": self.phase,
            "source": self.source,
            "decision": self.decision,
            "confidence": self.confidence,
            "attackType": self.attack_type,
            "target": self.target,
            "reason": self.reason,
            "safeRewrite": self.safe_rewrite,
        }


class PromptInjectionGuardrail:
    async def check_input(self, text: str, agent_config: dict[str, Any], channel: str = "web") -> GuardrailResult:
        return await self._check("input", text, agent_config, channel)

    async def check_output(self, text: str, agent_config: dict[str, Any], channel: str = "web") -> GuardrailResult:
        return await self._check("output", text, agent_config, channel)

    async def _check(
        self,
        phase: str,
        text: str,
        agent_config: dict[str, Any],
        channel: str,
    ) -> GuardrailResult:
        effective = resolve_effective_guardrails(agent_config)
        config = effective.prompt_injection
        enabled = {
            "input": config.input_enabled,
            "output": config.output_enabled,
        }.get(phase, False)
        if not enabled:
            return GuardrailResult(decision="allow", text=text, phase=phase, source=config.source)

        classifier = await classify_prompt_injection(
            text=text,
            classifier_model=effective.classifier_model,
            classifier_prompt=config.classifier_prompt_for_phase(phase),
            phase=f"{phase}:{channel}",
        )
        audit_prompt_injection_decision(
            phase=phase,
            source=config.source,
            decision=classifier.decision,
            confidence=classifier.confidence,
            attack_type=classifier.attack_type,
            target=classifier.target,
        )

        if config.mode == "monitor":
            return GuardrailResult(decision="allow", text=text, reason=classifier.reason, phase=phase, source=config.source)

        if classifier.decision == "block":
            return GuardrailResult(
                decision="block",
                text=config.block_message,
                blocked=True,
                reason=classifier.reason,
                safe_rewrite=classifier.safe_rewrite,
                confidence=classifier.confidence,
                attack_type=classifier.attack_type,
                target=classifier.target,
                phase=phase,
                source=config.source,
            )
        if classifier.decision == "sanitize" and classifier.safe_rewrite:
            return GuardrailResult(
                decision="sanitize",
                text=classifier.safe_rewrite,
                sanitized=True,
                reason=classifier.reason,
                safe_rewrite=classifier.safe_rewrite,
                confidence=classifier.confidence,
                attack_type=classifier.attack_type,
                target=classifier.target,
                phase=phase,
                source=config.source,
            )
        return GuardrailResult(decision="allow", text=text, reason=classifier.reason, phase=phase, source=config.source)
