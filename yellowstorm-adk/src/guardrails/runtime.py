import json
from typing import Any

from src.guardrails.audit import GuardrailAuditEvent, audit_guardrail_decision
from src.guardrails.classifier import classify_prompt_injection
from src.guardrails.config import resolve_effective_guardrails
from src.guardrails.models import GuardrailContext, GuardrailDecision
from src.guardrails.redaction import redact_sensitive
from src.guardrails.tool_registry import tool_policy


class GuardrailRuntime:
    async def review_model_input(self, text: str, context: GuardrailContext, agent_config: dict[str, Any]) -> GuardrailDecision:
        return await self._review_prompt("input", text, context, agent_config)

    async def review_model_output(self, text: str, context: GuardrailContext, agent_config: dict[str, Any]) -> GuardrailDecision:
        return await self._review_prompt("output", text, context, agent_config)

    async def _review_prompt(self, phase: str, text: str, context: GuardrailContext, agent_config: dict[str, Any]) -> GuardrailDecision:
        effective = resolve_effective_guardrails(agent_config)
        config = effective.prompt_injection
        enabled = config.input_enabled if phase == "input" else config.output_enabled
        if not enabled:
            return GuardrailDecision(text=text)
        packet = {
            "phase": f"model_{phase}",
            "source": context.source or context.channel or "unknown",
            "runtime": context.runtime_surface,
            "agent": {"id": context.agent_id, "name": context.agent_name},
            "task": {"instruction": context.task_instruction, "original_request": context.original_user_request},
            "content": text,
        }
        mode_instruction = "Apply a stricter policy and block ambiguous attempts against protected targets." if config.mode == "strict" else "Apply balanced policy: sanitize mixed attacks when safe and block clear protected-target attacks."
        classifier = await classify_prompt_injection(
            text=json.dumps(packet, default=str),
            classifier_model=effective.classifier_model,
            classifier_prompt=f"{config.classifier_prompt_for_phase(phase)}\n\nMode: {config.mode}. {mode_instruction}",
            phase=f"{phase}:{context.runtime_surface}:{context.source or context.channel}",
            omit_temperature=effective.classifier_omit_temperature,
        )
        decision = classifier.decision
        if config.mode == "monitor":
            decision = "allow"
        result = GuardrailDecision(
            decision=decision,
            text=text,
            reason=classifier.reason,
            confidence=classifier.confidence,
            safe_rewrite=classifier.safe_rewrite,
            attack_type=classifier.attack_type,
            target=classifier.target,
            classifier_error=classifier.error,
        )
        if decision == "block":
            result.blocked = True
            result.text = config.block_message
            result.block_message = config.block_message
        elif decision == "sanitize" and classifier.safe_rewrite:
            result.sanitized = True
            result.text = classifier.safe_rewrite
        self._audit("prompt_injection", phase, context, config.source, config.mode, result)
        return result

    async def review_tool_action(self, context: GuardrailContext, agent_config: dict[str, Any]) -> GuardrailDecision:
        effective = resolve_effective_guardrails(agent_config)
        config = effective.tool_action_review
        if not config.enabled:
            return GuardrailDecision()
        metadata = tool_policy(context.tool_name, context.tool_metadata)
        safety = str(metadata.get("safety") or "unknown").lower()
        if config.mode == "balanced" and safety == "read":
            return GuardrailDecision(reason="balanced_read_bypass")
        packet = {
            "runtime": context.runtime_surface,
            "agent": {"id": context.agent_id, "name": context.agent_name},
            "execution": {"flow_id": context.flow_id, "execution_id": context.execution_id, "node_id": context.node_id, "iteration": context.iteration},
            "task": {"instruction": context.task_instruction, "original_request": context.original_user_request},
            "tool": {"name": context.tool_name, **metadata},
            "arguments": redact_sensitive(context.tool_args),
        }
        classifier = await classify_prompt_injection(
            text=json.dumps(packet, default=str),
            classifier_model=effective.classifier_model,
            classifier_prompt=config.classifier_prompt,
            phase=f"tool_action:{context.runtime_surface}",
            omit_temperature=effective.classifier_omit_temperature,
        )
        blocked = classifier.decision == "block" and config.mode != "monitor"
        result = GuardrailDecision(
            decision="block" if blocked else "allow",
            blocked=blocked,
            reason=classifier.reason,
            confidence=classifier.confidence,
            block_message=config.block_message if blocked else "",
            classifier_error=classifier.error,
        )
        self._audit("tool_action_review", "tool_action", context, config.source, config.mode, result, safety)
        return result

    @staticmethod
    def _audit(guardrail_type: str, phase: str, context: GuardrailContext, source: str, mode: str, decision: GuardrailDecision, safety: str = "") -> None:
        audit_guardrail_decision(GuardrailAuditEvent(
            guardrail_type=guardrail_type, phase=phase, runtime_surface=context.runtime_surface,
            policy_source=source, mode=mode, decision=decision.decision,
            confidence=decision.confidence, reason=decision.reason, agent_id=context.agent_id,
            conversation_id=context.conversation_id, flow_id=context.flow_id,
            execution_id=context.execution_id, node_id=context.node_id,
            tool_name=context.tool_name, tool_safety=safety,
            classifier_error=decision.classifier_error,
        ))
