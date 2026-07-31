"""KNOWN, UNFIXED BUG — xfail, not a regression guard yet.

delegate_to_human_agent crashes when a THIRD, completely unrelated step
(no delegation at all) completes its own turn while the delegate is still
in flight: "No function call event found for function responses ids: ...".
The single-step repro in test_delegate_to_human_agent.py doesn't reproduce
this — it needs a genuine third sibling node's event landing in the shared
stream mid-delegate to trigger it.

Root cause: every top-level plan step runs as a plain ('single_turn')
Workflow graph node with isolation_scope=None (ADK's own
_compute_isolation_scope_for_node: "Otherwise unscoped — workflow nodes
share the workflow's conversation view by default"). Only mode='task'
nodes get automatic per-node isolation, and ADK explicitly REJECTS
mode='task' on a static graph node: "cannot be used as a workflow graph
node. Use a chat coordinator with task sub-agents, or dispatch dynamically
via ctx.run_node from a function node." So the existing delegate fix
(override_isolation_scope) only protects a caller from ITS OWN delegate's
events — it does nothing for unrelated concurrent siblings, and there is no
narrow fix available within the current static-graph architecture. A real
fix means dispatching every step dynamically via ctx.run_node instead of
graph.to_workflow's static edges — a genuine architecture change, not a
patch.

    <adk venv>/bin/python tests/orchestrator/test_delegate_with_concurrent_sibling.py
"""
import asyncio
import os
import sys
from unittest.mock import AsyncMock

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from pydantic import PrivateAttr
from google.adk.models import BaseLlm
from google.adk.models.llm_response import LlmResponse
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from src.companion_ai import graph as graph_mod
from src.companion_ai import human_agents as human_agents_mod
from src.companion_ai import nodes as nodes_mod
from src.companion_ai.plan import Plan, Step
from src.companion_ai.service import OrchestratorService


class _ScriptedLlm(BaseLlm):
    """Replays a fixed sequence of LlmResponses — no network, deterministic."""

    _responses: list = PrivateAttr()
    _i: int = PrivateAttr(default=0)
    _delay: float = PrivateAttr(default=0.0)

    def __init__(self, responses, delay: float = 0.0):
        super().__init__(model="fake")
        object.__setattr__(self, "_responses", responses)
        object.__setattr__(self, "_i", 0)
        object.__setattr__(self, "_delay", delay)

    async def generate_content_async(self, llm_request, stream=False):
        if self._delay:
            await asyncio.sleep(self._delay)
        i = min(self._i, len(self._responses) - 1)
        object.__setattr__(self, "_i", self._i + 1)
        yield self._responses[i]


def _fc(name, args, call_id):
    return LlmResponse(content=types.Content(role="model", parts=[
        types.Part(function_call=types.FunctionCall(name=name, args=args, id=call_id))
    ]))


def _text(t):
    return LlmResponse(content=types.Content(role="model", parts=[types.Part(text=t)]))


async def search(query: str) -> str:
    await asyncio.sleep(0.05)
    return "some search result"


async def _run_with_concurrent_sibling(monkeypatch) -> dict:
    from google.adk.tools import FunctionTool

    # s1: James, Bitcoin — completes quickly, before the others.
    s1_model = _ScriptedLlm([_text("s1's own Bitcoin answer.")], delay=0.02)
    # s2: James, DeFi token — delegates to Sarah, then must resume its OWN
    # turn after — this is where the original bug struck.
    james_model = _ScriptedLlm([
        _fc("delegate_to_human_agent",
            {"agent_name": "sarah", "task": "Can we open this position?"}, "call_1"),
        _text("Final answer from James using Sarah's input."),
    ], delay=0.02)
    # Sarah's own delegate branch takes a while (real searches, like the
    # live ~33s compliance step).
    sarah_model = _ScriptedLlm([
        _fc("search", {"query": "DeFi token compliance"}, "sarah_call_1"),
        _fc("search", {"query": "asset approval policy"}, "sarah_call_2"),
        _text("Sarah says: not approvable yet."),
    ], delay=0.1)
    # s3: David, depends on s1 — starts once s1 finishes, and its OWN
    # completion lands in the shared event stream WHILE Sarah's delegate
    # (spawned by the unrelated s2) is still mid-flight. This is the one
    # piece the single-sibling repro didn't have: a THIRD, unrelated node
    # finishing its own turn during another step's nested delegate call.
    s3_model = _ScriptedLlm([_text("s3's own risk answer.")], delay=0.02)
    # build_llm is called once per step in plan.steps order at graph-build
    # time (s1, s2, s3), then once more when s2's delegate call dynamically
    # builds Sarah's sub-step — that ordering, not call-time order, decides
    # which scripted model lands on which step.
    models_in_order = [s1_model, james_model, s3_model, sarah_model]
    call_count = {"n": 0}

    def fake_build_llm(model_name, *, with_tools, temperature=0.0):
        idx = call_count["n"]
        call_count["n"] += 1
        return models_in_order[idx]

    monkeypatch.setattr(nodes_mod, "build_llm", fake_build_llm)
    monkeypatch.setattr(human_agents_mod, "search_human_agents", AsyncMock(
        return_value=[{"id": "sarah", "name": "Sarah", "role": "Compliance officer"}]))

    session_service = InMemorySessionService()

    def runner_factory(node, app_name):
        return Runner(node=node, app_name=app_name, session_service=session_service)

    service = OrchestratorService(runner_factory, None, planner_model="fake",
                                  max_concurrency=4)
    plan = Plan(id="p1", steps=[
        Step(id="s1", kind="execute", description="Assess Bitcoin add.",
             is_persona=True, assignee="james", assignee_name="James"),
        Step(id="s2", kind="execute", description="Review DeFi token.",
             is_persona=True, assignee="james", assignee_name="James"),
        Step(id="s3", kind="execute", description="Risk Bitcoin add.",
             is_persona=True, assignee="david", assignee_name="David", depends_on=["s1"]),
    ])
    # Mirrors _build_workflow's own wiring (tools_for_step + delegate tool),
    # just with a fake search tool injected instead of real connectors.
    name_to_step = {graph_mod.node_name(s.id): s.id for s in plan.steps}
    factory_holder: list = []

    def tools_for_step(step, tools):
        if step.is_persona:
            tools = list(tools) + [
                human_agents_mod.make_find_human_agents_tool(),
                service._delegate_tool_for(
                    "sess1", "u1", plan, factory_holder, name_to_step, step.id)]
        return tools

    factory = nodes_mod.make_llm_node_factory(
        model_name="fake", tools=[FunctionTool(search)], tools_for_step=tools_for_step)
    factory_holder.append(factory)
    wf = graph_mod.to_workflow(plan, factory, name="plan_sess1", max_concurrency=4)

    runner = runner_factory(wf, "orch_sess1")
    await runner.session_service.create_session(
        app_name="orch_sess1", user_id="u1", session_id="sess1")

    final_texts = {}
    async for ev in runner.run_async(
            user_id="u1", session_id="sess1",
            new_message=types.Content(role="user", parts=[types.Part(text="run the plan")])):
        if ev.content and ev.content.parts and getattr(ev.content.parts[0], "text", None):
            final_texts[ev.author] = ev.content.parts[0].text
    return final_texts


@pytest.mark.xfail(
    reason="Known ADK limitation, no fix available in the current static-"
           "graph architecture — see module docstring. Flip to a plain "
           "regression test once fixed. Not strict: the repro forces a "
           "specific event interleaving via real asyncio delays, which "
           "isn't 100% reproducible run-to-run — an occasional accidental "
           "pass doesn't mean the bug is fixed.",
    strict=False,
)
def test_delegate_survives_a_concurrent_unrelated_sibling_step(monkeypatch):
    """A third, unrelated step (s3, no delegation) completing its own turn
    while s2's delegate (Sarah) is still in flight must not corrupt s2's own
    turn-boundary detection when Sarah replies."""
    result = asyncio.run(_run_with_concurrent_sibling(monkeypatch))
    assert result.get("s2") == "Final answer from James using Sarah's input."


if __name__ == "__main__":
    class _Monkeypatch:
        def setattr(self, obj, name, value):
            setattr(obj, name, value)

    test_delegate_survives_a_concurrent_unrelated_sibling_step(_Monkeypatch())
    print("ok  delegate_to_human_agent survives a concurrent unrelated sibling step")
