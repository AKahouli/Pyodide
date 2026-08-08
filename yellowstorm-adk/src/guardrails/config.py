from dataclasses import dataclass
from typing import Any
import json
import logging

logger = logging.getLogger(__name__)


@dataclass
class PromptInjectionConfig:
    input_enabled: bool = False
    output_enabled: bool = False
    mode: str = "balanced"
    input_classifier_prompt: str = ""
    output_classifier_prompt: str = ""
    block_message: str = "I cannot follow this instruction."
    source: str = "agent"

    @property
    def input_guardrail_enabled(self) -> bool:
        return self.input_enabled

    @property
    def output_guardrail_enabled(self) -> bool:
        return self.output_enabled

    def classifier_prompt_for_phase(self, phase: str) -> str:
        return self.input_classifier_prompt if phase == "input" else self.output_classifier_prompt if phase == "output" else ""


@dataclass
class ToolActionReviewConfig:
    enabled: bool = False
    mode: str = "balanced"
    classifier_prompt: str = ""
    block_message: str = "I cannot perform this action."
    source: str = "agent"


@dataclass
class EffectiveGuardrailsConfig:
    prompt_injection: PromptInjectionConfig
    tool_action_review: ToolActionReviewConfig
    classifier_model: str = ""


def _normalize_mode(value: Any) -> str:
    return value if value in {"monitor", "balanced", "strict"} else "balanced"


def _normalize_prompt_injection(raw: dict[str, Any] | None, source: str) -> PromptInjectionConfig:
    raw = raw or {}
    legacy_prompt = str(raw.get("classifierPrompt") or "")
    return PromptInjectionConfig(
        input_enabled=bool(raw.get("inputEnabled", raw.get("inputGuardrailEnabled", False))),
        output_enabled=bool(raw.get("outputEnabled", raw.get("outputGuardrailEnabled", False))),
        mode=_normalize_mode(raw.get("mode")),
        input_classifier_prompt=str(raw.get("inputClassifierPrompt") or legacy_prompt),
        output_classifier_prompt=str(raw.get("outputClassifierPrompt") or legacy_prompt),
        block_message=str(raw.get("blockMessage") or "I cannot follow this instruction."),
        source=source,
    )


def _normalize_tool_action(
    raw: dict[str, Any] | None,
    legacy_prompt_injection: dict[str, Any] | None,
    source: str,
) -> ToolActionReviewConfig:
    raw = raw or {}
    legacy = legacy_prompt_injection or {}
    return ToolActionReviewConfig(
        enabled=bool(raw.get("enabled", legacy.get("toolCallGuardrailEnabled", False))),
        mode=_normalize_mode(raw.get("mode", legacy.get("mode"))),
        classifier_prompt=str(
            raw.get("classifierPrompt")
            or legacy.get("toolCallClassifierPrompt")
            or legacy.get("classifierPrompt")
            or ""
        ),
        block_message=str(raw.get("blockMessage") or "I cannot perform this action."),
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
        selected = admin
        source = "admin_forced"
    else:
        selected = agent
        source = "agent"

    legacy_prompt_injection = selected.get("promptInjection")
    prompt_injection = _normalize_prompt_injection(legacy_prompt_injection, source)
    tool_action_review = _normalize_tool_action(
        selected.get("toolActionReview"), legacy_prompt_injection, source
    )

    return EffectiveGuardrailsConfig(
        prompt_injection=prompt_injection,
        tool_action_review=tool_action_review,
        classifier_model=classifier_model,
    )
