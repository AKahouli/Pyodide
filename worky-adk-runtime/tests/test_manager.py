"""Unit tests for the Worky Manager LlmAgent.

The real LLM is never called in tests — we install a shared stub
`google.adk.agents` module that records the agent construction kwargs
and exposes the two tool functions directly. The schema validation
path is exercised by calling the tool with valid + invalid bodies.
"""
from __future__ import annotations

from typing import Any

import pytest

# Install shared ADK stubs BEFORE importing app modules so the lazy
# imports inside the manager pick up the stubs.
from tests._adk_stub import (  # noqa: E402
    install_adk_stubs,
    constructed_llm_agents,
    reset_recordings,
)

install_adk_stubs()

import importlib  # noqa: E402

import app.agents.model as _model_mod  # noqa: E402
importlib.reload(_model_mod)
import app.agents.manager as _manager_mod  # noqa: E402
importlib.reload(_manager_mod)

build_manager_agent = _manager_mod.build_manager_agent
from app.agents.schemas import PlanDeltaBody  # noqa: E402


@pytest.fixture(autouse=True)
def _reset():
    reset_recordings()
    yield
    reset_recordings()


def _build_with_callbacks():
    submitted: list[PlanDeltaBody] = []
    clarifications: list[tuple[str, list[str] | None]] = []

    build_manager_agent(
        on_submit_delta=lambda parsed: submitted.append(parsed),
        on_clarification=lambda q, o: clarifications.append((q, o)),
    )
    constructed = constructed_llm_agents()
    assert constructed, "Manager did not construct an LlmAgent"
    return constructed[-1], submitted, clarifications


def test_manager_agent_uses_litellm_without_hardcoded_model() -> None:
    kwargs, _, _ = _build_with_callbacks()
    assert "model" in kwargs, "LlmAgent must receive a model parameter"
    assert kwargs["model"] is not None


def test_manager_agent_wires_submit_and_clarify_tools() -> None:
    kwargs, _, _ = _build_with_callbacks()
    tools = kwargs.get("tools", [])
    assert len(tools) == 2, "Manager must have exactly 2 tools"


def test_submit_plan_delta_tool_validates_input() -> None:
    kwargs, submitted, _ = _build_with_callbacks()
    submit_tool = kwargs["tools"][0]
    # Invalid body — missing required actionCategory.
    result = submit_tool({"create_tasks": [{"title": "X", "lane": "ready"}]})
    assert result["submitted"] is False
    assert "validation_error" in result
    assert submitted == []


def test_submit_plan_delta_tool_emits_to_callback() -> None:
    kwargs, submitted, _ = _build_with_callbacks()
    submit_tool = kwargs["tools"][0]
    result = submit_tool(
        {
            "create_tasks": [
                {
                    "title": "A",
                    "lane": "ready",
                    "actionCategory": "internal_analysis",
                }
            ]
        }
    )
    assert result == {"submitted": True}
    assert len(submitted) == 1
    assert submitted[0].create_tasks[0].title == "A"


def test_clarification_tool_invokes_callback() -> None:
    kwargs, _, clarifications = _build_with_callbacks()
    clarify_tool = kwargs["tools"][1]
    result = clarify_tool("Which doc?", ["A", "B"])
    assert result["asked"] is True
    assert clarifications == [("Which doc?", ["A", "B"])]
