"""delegate_to_human_agent, executed on the real ADK engine (scripted LLMs, no
network) — regression test for a bug only reproducible against real ADK event
bookkeeping, not against mocks.

Root cause (found via this exact repro): use_sub_branch=True alone is not
enough. The delegate's reply event still carries a different `author` than
the calling step's node name, and ADK's contents.py:_get_current_turn_contents
scans backward for the latest event with a foreign author
(_is_other_agent_reply) to decide where "the current turn" starts — the
delegate's reply qualifies, so everything before it, including the calling
step's own function_call event, gets truncated away. The next LLM call then
fails with "No function call event found for function responses ids: ...".

Fix: override_isolation_scope=tool_context.function_call_id on the run_node
call — ADK's own documented convention for a delegated sub-agent (see
_build_task_input_user_content's docstring: "A task agent runs under
isolation_scope=<fc_id>"). That makes _should_include_event_in_context
exclude the delegate's events from the calling step's own context-building
scan entirely, so they can never be mistaken for a turn boundary.

    <adk venv>/bin/python tests/orchestrator/test_delegate_to_human_agent.py
"""
import asyncio
import os
import sys
from unittest.mock import AsyncMock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from pydantic import PrivateAttr
from google.adk.models import BaseLlm
from google.adk.models.llm_response import LlmResponse
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from src.companion_ai import human_agents as human_agents_mod
from src.companion_ai import nodes as nodes_mod
from src.companion_ai.plan import Plan, Status, Step
from src.companion_ai.service import OrchestratorService


class _ScriptedLlm(BaseLlm):
    """Replays a fixed sequence of LlmResponses — no network, deterministic."""

    _responses: list = PrivateAttr()
    _i: int = PrivateAttr(default=0)

    def __init__(self, responses):
        super().__init__(model="fake")
        object.__setattr__(self, "_responses", responses)
        object.__setattr__(self, "_i", 0)

    async def generate_content_async(self, llm_request, stream=False):
        i = min(self._i, len(self._responses) - 1)
        object.__setattr__(self, "_i", self._i + 1)
        yield self._responses[i]


def _fc(name, args, call_id):
    return LlmResponse(content=types.Content(role="model", parts=[
        types.Part(function_call=types.FunctionCall(name=name, args=args, id=call_id))
    ]))


def _text(t):
    return LlmResponse(content=types.Content(role="model", parts=[types.Part(text=t)]))


async def _run_rabeb_delegates_to_oussama(monkeypatch) -> str:
    rabeb_model = _ScriptedLlm([
        _fc("delegate_to_human_agent",
            {"agent_name": "oussama", "task": "Should we invest today?"}, "call_1"),
        _text("Final answer from Rabeb using Oussama's input."),
    ])
    oussama_model = _ScriptedLlm([_text("Oussama says: no buy today.")])
    models_in_order = [rabeb_model, oussama_model]
    call_count = {"n": 0}

    def fake_build_llm(model_name, *, with_tools, temperature=0.0):
        idx = call_count["n"]
        call_count["n"] += 1
        return models_in_order[idx]

    monkeypatch.setattr(nodes_mod, "build_llm", fake_build_llm)
    monkeypatch.setattr(human_agents_mod, "search_human_agents", AsyncMock(
        return_value=[{"id": "oussama", "name": "Oussama", "role": "Investment approver"}]))

    session_service = InMemorySessionService()

    def runner_factory(node, app_name):
        return Runner(node=node, app_name=app_name, session_service=session_service)

    service = OrchestratorService(runner_factory, None, planner_model="fake")
    plan = Plan(id="p1", steps=[
        Step(id="s2", kind="execute", description="Should we invest today?",
             is_persona=True, assignee="rabeb", assignee_name="Rabeb"),
    ])
    wf, _ = service._build_workflow("sess1", "u1", plan, "fake", None, None)

    runner = runner_factory(wf, "orch_sess1")
    await runner.session_service.create_session(
        app_name="orch_sess1", user_id="u1", session_id="sess1")

    final_text = None
    async for ev in runner.run_async(
            user_id="u1", session_id="sess1",
            new_message=types.Content(role="user", parts=[types.Part(text="run the plan")])):
        if ev.content and ev.content.parts and getattr(ev.content.parts[0], "text", None):
            final_text = ev.content.parts[0].text
    return final_text


def test_a_delegate_spawned_mid_turn_is_never_left_orphaned(monkeypatch):
    """A step spawned mid-turn must still RUN before the turn is declared done.

    The graph is built from plan.steps at the START of a turn, so a step
    delegate_to_human_agent adds is not in it and cannot run that time round.
    await_reply gets a later turn for free (the mail reply triggers one);
    nothing triggers one for a delegate. Seen live in session
    6f5b45c30e42: the plan finished 'completed' with its "ask Firas Kahia"
    step still PENDING, never run, and the user got a final answer that
    silently skipped it. _drive_until_quiescent rebuilds and drives again
    while the last pass left newly-spawned work behind.
    """
    caller = _ScriptedLlm([
        _fc("delegate_to_human_agent",
            {"agent_name": "oussama", "task": "Should we invest today?"}, "call_1"),
        _text("Asked Oussama; awaiting his answer."),
    ])
    delegate = _ScriptedLlm([_text("Oussama says: no buy today.")])
    order, i = [caller, delegate], {"n": 0}

    def fake_build_llm(model_name, *, with_tools, temperature=0.0):
        m = order[min(i["n"], len(order) - 1)]
        i["n"] += 1
        return m

    monkeypatch.setattr(nodes_mod, "build_llm", fake_build_llm)
    monkeypatch.setattr(human_agents_mod, "search_human_agents", AsyncMock(
        return_value=[{"id": "oussama", "name": "Oussama", "role": "Investment approver"}]))

    session_service = InMemorySessionService()

    def runner_factory(node, app_name):
        return Runner(node=node, app_name=app_name, session_service=session_service)

    service = OrchestratorService(runner_factory, None, planner_model="fake")
    plan = Plan(id="p1", steps=[
        Step(id="s2", kind="execute", description="Should we invest today?",
             is_persona=True, assignee="rabeb", assignee_name="Rabeb"),
    ])

    async def go():
        wf, n2s = service._build_workflow("sess1", "u1", plan, "fake", None, None)
        runner = runner_factory(wf, "orch_sess1")
        await session_service.create_session(
            app_name="orch_sess1", user_id="u1", session_id="sess1")
        return await service._drive_until_quiescent(
            runner, "sess1", "u1", plan, n2s,
            types.Content(role="user", parts=[types.Part(text="run the plan")]),
            model="fake", connectors=None, executor_prompt=None)

    interrupts = asyncio.run(go())

    assert interrupts == []
    # The delegate was created AND executed — not left behind.
    assert len(plan.steps) == 2, [s.id for s in plan.steps]
    delegated = plan.steps[-1]
    assert delegated.assignee_name == "Oussama"
    assert delegated.status is not Status.PENDING, \
        "the delegate step was orphaned — created but never run"
    assert [s.status for s in plan.steps].count(Status.PENDING) == 0


def test_delegate_survives_the_calling_steps_own_next_llm_turn(monkeypatch):
    """Regression guard: this raised ValueError('No function call event found
    for function responses ids: ...') before override_isolation_scope was added."""
    result = asyncio.run(_run_rabeb_delegates_to_oussama(monkeypatch))
    assert result == "Final answer from Rabeb using Oussama's input."


if __name__ == "__main__":
    class _Monkeypatch:
        def setattr(self, obj, name, value):
            setattr(obj, name, value)

    test_delegate_survives_the_calling_steps_own_next_llm_turn(_Monkeypatch())
    print("ok  delegate_to_human_agent survives the calling step's own next LLM turn")
