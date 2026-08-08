import json

import pytest

from src.guardrails.classifier import ClassifierDecision
from src.guardrails.models import GuardrailContext
from src.guardrails.runtime import GuardrailRuntime


def config(tool_mode: str = "balanced") -> dict:
    return {"agent_params": {
        "guardrails_json": json.dumps({"agent": {
            "promptInjection": {"inputEnabled": True, "outputEnabled": True, "mode": "balanced"},
            "toolActionReview": {"enabled": True, "mode": tool_mode, "classifierPrompt": "policy", "blockMessage": "Tool blocked"},
        }}),
        "guardrails_classifier_model": "classifier",
    }}


@pytest.mark.asyncio
async def test_balanced_read_tool_bypasses_classifier(monkeypatch) -> None:
    async def fail(**_kwargs):
        raise AssertionError("classifier should not run")

    monkeypatch.setattr("src.guardrails.runtime.classify_prompt_injection", fail)
    decision = await GuardrailRuntime().review_tool_action(
        GuardrailContext(phase="tool_action", runtime_surface="playbook_langgraph", tool_name="calculator", tool_metadata={"safety": "read"}),
        config(),
    )
    assert decision.decision == "allow"
    assert decision.reason == "balanced_read_bypass"


@pytest.mark.asyncio
async def test_write_tool_is_blocked_without_rewriting_arguments(monkeypatch) -> None:
    async def classify(**_kwargs):
        return ClassifierDecision(decision="block", reason="scope exceeded", confidence=0.9)

    monkeypatch.setattr("src.guardrails.runtime.classify_prompt_injection", classify)
    args = {"contact": "123", "access_token": "secret"}
    decision = await GuardrailRuntime().review_tool_action(
        GuardrailContext(phase="tool_action", runtime_surface="playbook_langgraph", tool_name="crm_update", tool_args=args, tool_metadata={"safety": "write"}),
        config(),
    )
    assert decision.blocked is True
    assert decision.block_message == "Tool blocked"
    assert args == {"contact": "123", "access_token": "secret"}


@pytest.mark.asyncio
async def test_monitor_mode_always_allows_tool(monkeypatch) -> None:
    async def classify(**_kwargs):
        return ClassifierDecision(decision="block", reason="unsafe")

    monkeypatch.setattr("src.guardrails.runtime.classify_prompt_injection", classify)
    decision = await GuardrailRuntime().review_tool_action(
        GuardrailContext(phase="tool_action", runtime_surface="playbook_langgraph", tool_name="delete", tool_metadata={"safety": "delete"}),
        config("monitor"),
    )
    assert decision.decision == "allow"
    assert decision.blocked is False
