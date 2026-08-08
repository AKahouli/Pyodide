from types import SimpleNamespace
from typing import TypedDict

import pytest
from langchain_core.tools import StructuredTool
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command
from pydantic import BaseModel

from src.flow_engine.agent_runtime import StepRuntimeContext, run_step_agent


class EchoInput(BaseModel):
    value: str


class Response:
    def __init__(self, content: str, tool_calls=None):
        message = SimpleNamespace(content=content, tool_calls=tool_calls or [])
        self.choices = [SimpleNamespace(message=message)]
        self.usage = None


@pytest.mark.asyncio
async def test_step_agent_routes_model_tool_model(monkeypatch) -> None:
    calls = []

    async def completion(**kwargs):
        calls.append(kwargs)
        if len(calls) == 1:
            return Response("", [{"id": "call-1", "function": {"name": "echo", "arguments": '{"value":"hello"}'}}])
        return Response("final answer")

    async def echo(value: str) -> str:
        return f"echo:{value}"

    monkeypatch.setattr("src.flow_engine.agent_runtime.model.litellm.acompletion", completion)
    tool = StructuredTool(name="echo", description="Echo", func=None, coroutine=echo, args_schema=EchoInput, metadata={"safety": "read"})
    output = await run_step_agent(system_prompt="system", user_msg="user", tools=[tool], context=StepRuntimeContext(model_id="test", tools_enabled=True))

    assert output == "final answer"
    assert len(calls) == 2
    assert calls[0]["parallel_tool_calls"] is False
    assert any(message.get("role") == "tool" and "echo:hello" in str(message.get("content")) for message in calls[1]["messages"])


@pytest.mark.asyncio
async def test_output_guardrail_buffers_until_validated(monkeypatch) -> None:
    streamed = []

    async def completion(**kwargs):
        assert kwargs.get("stream") is not True
        return Response("unsafe")

    async def review(_self, _text, _context, _config):
        from src.guardrails.models import GuardrailDecision
        return GuardrailDecision(decision="block", text="blocked", blocked=True)

    monkeypatch.setattr("src.flow_engine.agent_runtime.model.litellm.acompletion", completion)
    monkeypatch.setattr("src.flow_engine.agent_runtime.model.GuardrailRuntime.review_model_output", review)
    agent_config = {"agent_params": {"guardrails_json": '{"agent":{"promptInjection":{"outputEnabled":true}}}'}}
    output = await run_step_agent(system_prompt="system", user_msg="user", tools=[], context=StepRuntimeContext(model_id="test", agent_config=agent_config, on_progress=streamed.append))

    assert output == "blocked"
    assert streamed == ["blocked"]


@pytest.mark.asyncio
async def test_tool_hitl_resume_executes_side_effect_once(monkeypatch) -> None:
    side_effects = []

    async def completion(**kwargs):
        if any(message.get("role") == "tool" for message in kwargs["messages"]):
            return Response("complete")
        return Response("", [{"id": "write-1", "function": {"name": "write_file", "arguments": '{"value":"approved"}'}}])

    async def write_file(value: str) -> str:
        side_effects.append(value)
        return "written"

    monkeypatch.setattr("src.flow_engine.agent_runtime.model.litellm.acompletion", completion)
    tool = StructuredTool(name="write_file", description="Write", func=None, coroutine=write_file, args_schema=EchoInput, metadata={"safety": "write"})

    class ParentState(TypedDict, total=False):
        output: str

    async def parent_node(_state: ParentState) -> ParentState:
        output = await run_step_agent(
            system_prompt="system", user_msg="user", tools=[tool],
            context=StepRuntimeContext(
                model_id="test", node_id="step-1", iteration=0, tools_enabled=True,
                hitl_policy={"mode": "auto", "approvalEnabled": True},
                hitl_blockers=[{"id": "rule-1", "enabled": True, "createdBy": "user", "kind": "workspace_write", "appliesToConnectorActions": ["write_file"]}],
            ),
        )
        return {"output": output}

    builder = StateGraph(ParentState)
    builder.add_node("step", parent_node)
    builder.add_edge(START, "step")
    builder.add_edge("step", END)
    graph = builder.compile(checkpointer=MemorySaver())
    config = {"configurable": {"thread_id": "hitl-test"}}

    await graph.ainvoke({}, config)
    assert side_effects == []
    assert graph.get_state(config).interrupts

    final = await graph.ainvoke(Command(resume={"action": "approve"}), config)
    assert final["output"] == "complete"
    assert side_effects == ["approved"]


@pytest.mark.asyncio
async def test_guardrail_block_precedes_hitl_and_tool_execution(monkeypatch) -> None:
    from src.guardrails.classifier import ClassifierDecision

    side_effects = []

    async def completion(**kwargs):
        if any(message.get("role") == "tool" for message in kwargs["messages"]):
            return Response("replanned")
        return Response("", [{"id": "delete-1", "function": {"name": "delete_file", "arguments": '{"value":"target"}'}}])

    async def classify(**_kwargs):
        return ClassifierDecision(decision="block", reason="unsafe")

    async def delete_file(value: str) -> str:
        side_effects.append(value)
        return "deleted"

    monkeypatch.setattr("src.flow_engine.agent_runtime.model.litellm.acompletion", completion)
    monkeypatch.setattr("src.guardrails.runtime.classify_prompt_injection", classify)
    tool = StructuredTool(name="delete_file", description="Delete", func=None, coroutine=delete_file, args_schema=EchoInput, metadata={"safety": "delete"})
    agent_config = {"agent_params": {
        "guardrails_json": '{"agent":{"toolActionReview":{"enabled":true,"mode":"balanced","classifierPrompt":"policy","blockMessage":"blocked"}}}',
        "guardrails_classifier_model": "classifier",
    }}

    output = await run_step_agent(
        system_prompt="system", user_msg="user", tools=[tool],
        context=StepRuntimeContext(
            model_id="test", node_id="step-1", tools_enabled=True, agent_config=agent_config,
            hitl_policy={"mode": "auto", "approvalEnabled": True},
            hitl_blockers=[{"enabled": True, "createdBy": "user", "kind": "workspace_write", "appliesToConnectorActions": ["delete_file"]}],
        ),
    )

    assert output == "replanned"
    assert side_effects == []
