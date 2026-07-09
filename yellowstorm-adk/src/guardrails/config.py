from dataclasses import dataclass
from typing import Any, Literal
import json
import logging

GuardrailMode = Literal["monitor", "balanced", "strict"]

logger = logging.getLogger(__name__)


@dataclass
class PromptInjectionConfig:
    input_guardrail_enabled: bool = False
    output_guardrail_enabled: bool = False
    tool_call_guardrail_enabled: bool = False
    mode: GuardrailMode = "balanced"
    input_classifier_prompt: str = ""
    output_classifier_prompt: str = ""
    tool_call_classifier_prompt: str = ""
    block_message: str = "I cannot follow this instruction."
    source: str = "agent"

    def classifier_prompt_for_phase(self, phase: str) -> str:
        if phase == "input":
            return self.input_classifier_prompt
        if phase == "output":
            return self.output_classifier_prompt
        if phase == "tool_call":
            return self.tool_call_classifier_prompt
        return ""


@dataclass
class EffectiveGuardrailsConfig:
    prompt_injection: PromptInjectionConfig
    classifier_model: str = ""


def _normalize_prompt_injection(raw: dict[str, Any] | None, source: str) -> PromptInjectionConfig:
    raw = raw or {}
    mode = raw.get("mode")
    legacy_prompt = str(raw.get("classifierPrompt") or "")
    return PromptInjectionConfig(
        input_guardrail_enabled=bool(raw.get("inputGuardrailEnabled", False)),
        output_guardrail_enabled=bool(raw.get("outputGuardrailEnabled", False)),
        tool_call_guardrail_enabled=bool(raw.get("toolCallGuardrailEnabled", False)),
        mode=mode if mode in {"monitor", "balanced", "strict"} else "balanced",
        input_classifier_prompt=str(raw.get("inputClassifierPrompt") or legacy_prompt),
        output_classifier_prompt=str(raw.get("outputClassifierPrompt") or legacy_prompt),
        tool_call_classifier_prompt=str(raw.get("toolCallClassifierPrompt") or legacy_prompt),
        block_message=str(raw.get("blockMessage") or "I cannot follow this instruction."),
        source=source,
    )


def resolve_effective_guardrails(agent_config: dict[str, Any]) -> EffectiveGuardrailsConfig:
    params = agent_config.get("agent_params") or {}
    raw_json = params.get("guardrails_json") or "{}"
    classifier_model = str(params.get("guardrails_classifier_model") or "")

    try:
        payload = json.loads(raw_json) if isinstance(raw_json, str) else raw_json
    except (TypeError, ValueError) as exc:
        logger.warning("[GUARDRAIL] Invalid guardrails_json; failing open: %s", exc)
        payload = {}

    admin = payload.get("admin") or {}
    agent = payload.get("agent") or {}

    if admin.get("forceActivation") is True:
        prompt_injection = _normalize_prompt_injection(admin.get("promptInjection"), "admin_forced")
    else:
        prompt_injection = _normalize_prompt_injection(agent.get("promptInjection"), "agent")

    return EffectiveGuardrailsConfig(
        prompt_injection=prompt_injection,
        classifier_model=classifier_model,
    )
