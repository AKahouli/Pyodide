import json

from src.guardrails.config import resolve_effective_guardrails


def test_resolve_effective_guardrails_uses_flat_agent_params() -> None:
    payload = {
        "agent": {
            "promptInjection": {
                "inputGuardrailEnabled": True,
                "outputGuardrailEnabled": False,
                "toolCallGuardrailEnabled": True,
                "inputClassifierPrompt": "input policy",
                "outputClassifierPrompt": "output policy",
                "toolCallClassifierPrompt": "tool policy",
                "blockMessage": "blocked",
            }
        },
        "admin": {
            "forceActivation": False,
            "promptInjection": {
                "inputGuardrailEnabled": False,
                "outputGuardrailEnabled": True,
                "toolCallGuardrailEnabled": False,
                "classifierPrompt": "admin policy",
                "blockMessage": "admin blocked",
            },
        },
    }

    config = resolve_effective_guardrails({
        "agent_params": {
            "guardrails_json": json.dumps(payload),
            "guardrails_classifier_model": "azure/gpt-4o-mini",
        }
    })

    assert config.classifier_model == "azure/gpt-4o-mini"
    assert config.prompt_injection.source == "agent"
    assert config.prompt_injection.input_guardrail_enabled is True
    assert config.prompt_injection.output_guardrail_enabled is False
    assert config.prompt_injection.tool_call_guardrail_enabled is True
    assert config.prompt_injection.classifier_prompt_for_phase("input") == "input policy"
    assert config.prompt_injection.classifier_prompt_for_phase("output") == "output policy"
    assert config.prompt_injection.classifier_prompt_for_phase("tool_call") == "tool policy"
    assert config.prompt_injection.block_message == "blocked"


def test_resolve_effective_guardrails_uses_admin_when_forced() -> None:
    payload = {
        "agent": {"promptInjection": {"inputGuardrailEnabled": False}},
        "admin": {
            "forceActivation": True,
            "promptInjection": {
                "inputGuardrailEnabled": True,
                "classifierPrompt": "admin policy",
            },
        },
    }

    config = resolve_effective_guardrails({"agent_params": {"guardrails_json": json.dumps(payload)}})

    assert config.prompt_injection.source == "admin_forced"
    assert config.prompt_injection.input_guardrail_enabled is True
    assert config.prompt_injection.classifier_prompt_for_phase("input") == "admin policy"


def test_resolve_effective_guardrails_supports_legacy_single_prompt() -> None:
    payload = {
        "agent": {
            "promptInjection": {
                "inputGuardrailEnabled": True,
                "classifierPrompt": "legacy policy",
            }
        }
    }

    config = resolve_effective_guardrails({"agent_params": {"guardrails_json": json.dumps(payload)}})

    assert config.prompt_injection.classifier_prompt_for_phase("input") == "legacy policy"
    assert config.prompt_injection.classifier_prompt_for_phase("output") == "legacy policy"
    assert config.prompt_injection.classifier_prompt_for_phase("tool_call") == "legacy policy"
