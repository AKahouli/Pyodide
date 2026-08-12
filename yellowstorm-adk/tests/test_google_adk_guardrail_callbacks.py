import json
from types import SimpleNamespace

import pytest

from src.guardrails.adapters.google_adk import (
    agent_tree_has_output_guardrail,
    append_callback,
    apply_guardrail_callbacks,
    apply_guardrails_to_agent,
    build_guarded_adk_agent,
)
from src.guardrails.models import GuardrailDecision


class FakeAgent:
    def __init__(self, **kwargs):
        for key, value in kwargs.items():
            setattr(self, key, value)
        self.tools = list(kwargs.get("tools") or [])
        self.sub_agents = list(kwargs.get("sub_agents") or [])


def guardrail_config(*, output: bool = False, mode: str = "balanced") -> dict:
    return {"agent_params": {"guardrails_json": json.dumps({"agent": {
        "promptInjection": {"outputEnabled": output, "mode": mode},
        "toolActionReview": {"enabled": True, "mode": mode},
    }})}}


def test_append_callback_preserves_existing_order() -> None:
    first = lambda *_args: None
    second = lambda *_args: None
    assert append_callback(first, second) == [first, second]
    assert append_callback([first], second) == [first, second]


def test_apply_guardrail_callbacks_composes_every_native_phase() -> None:
    existing = lambda *_args: None
    kwargs = {"before_model_callback": existing, "before_tool_callback": existing}
    result = apply_guardrail_callbacks(kwargs, {})
    assert result["before_model_callback"][0] is existing
    assert result["before_tool_callback"][0] is existing
    assert len(result["before_model_callback"]) == 2
    assert len(result["after_model_callback"]) == 1
    assert len(result["before_tool_callback"]) == 2


def test_guarded_constructor_marks_output_policy_and_preserves_callbacks() -> None:
    existing = lambda *_args: None
    agent = build_guarded_adk_agent(
        FakeAgent,
        {"name": "normal", "before_model_callback": existing},
        guardrail_config(output=True),
    )

    assert agent.before_model_callback[0] is existing
    assert len(agent.before_model_callback) == 2
    assert len(agent.after_model_callback) == 1
    assert len(agent.before_tool_callback) == 1
    assert agent_tree_has_output_guardrail(agent) is True


def test_parent_policy_is_added_without_replacing_stricter_child_callbacks() -> None:
    child = build_guarded_adk_agent(FakeAgent, {"name": "child"}, guardrail_config(output=True, mode="strict"))
    parent = build_guarded_adk_agent(
        FakeAgent,
        {"name": "parent", "tools": [SimpleNamespace(agent=child)]},
        guardrail_config(mode="balanced"),
    )

    assert len(child.before_model_callback) == 2
    assert len(child.after_model_callback) == 2
    assert len(child.before_tool_callback) == 2
    assert len(child._guardrails_config_fingerprints) == 2
    assert agent_tree_has_output_guardrail(parent) is True

    apply_guardrails_to_agent(child, guardrail_config(mode="balanced"))
    assert len(child.before_tool_callback) == 2


@pytest.mark.asyncio
@pytest.mark.parametrize("safety", ["read", "write", "delete", "internal", "unknown"])
async def test_before_tool_block_prevents_underlying_side_effect(monkeypatch, safety: str) -> None:
    calls = []

    async def block(_self, _context, _config):
        return GuardrailDecision(decision="block", blocked=True, block_message="blocked")

    async def execute():
        calls.append("executed")

    monkeypatch.setattr("src.guardrails.adapters.google_adk.GuardrailRuntime.review_tool_action", block)
    agent = build_guarded_adk_agent(FakeAgent, {"name": "agent"}, guardrail_config(mode="strict"))
    tool = SimpleNamespace(name=f"{safety}_tool", metadata={"safety": safety})
    result = None
    for callback in agent.before_tool_callback:
        result = await callback(tool, {"value": "x"}, SimpleNamespace(invocation_id="inv-1"))
        if result is not None:
            break
    if result is None:
        await execute()

    assert result == {"status": "blocked_by_guardrail", "error": "blocked"}
    assert calls == []


@pytest.mark.asyncio
async def test_second_brain_confirmation_blocks_tool_before_execution(monkeypatch) -> None:
    calls = []

    async def require_confirmation(_config, _tool_name, _args, _metadata):
        return {
            "decision": "confirmation_required",
            "pendingAction": {"confirmationId": "confirmation-1"},
        }

    async def execute():
        calls.append("executed")

    monkeypatch.setattr("src.guardrails.adapters.google_adk.evaluate_second_brain_tool", require_confirmation)
    config = {
        **guardrail_config(),
        "id": "agent-1",
        "agent_type": "platform_copilot",
        "user_id": "user-1",
    }
    agent = build_guarded_adk_agent(FakeAgent, {"name": "My Second Brain"}, config)
    tool = SimpleNamespace(
        name="playbook_mcp_start_playbook_execution",
        metadata={"action_key": "start_playbook_execution", "safety": "write"},
    )
    result = None
    for callback in agent.before_tool_callback:
        result = await callback(tool, {"playbook_id": "playbook-1"}, SimpleNamespace(invocation_id="inv-1"))
        if result is not None:
            break
    if result is None:
        await execute()

    assert result == {
        "status": "confirmation_required",
        "decision": "confirmation_required",
        "pendingAction": {"confirmationId": "confirmation-1"},
    }
    assert calls == []
