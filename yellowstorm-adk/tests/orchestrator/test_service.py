"""Unit tests for OrchestratorService pure helpers (no ADK/DB/LLM)."""
import asyncio
import os
import sys
from unittest.mock import AsyncMock, MagicMock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import pytest

from src.companion_ai import service as svc
from src.companion_ai.plan import Plan, Status, Step


def test_make_plan_extracts_a_plan_when_output_schema_is_combined_with_tools(monkeypatch):
    """LlmAgent.output_schema + tools together works by ADK injecting a
    set_model_response tool and synthesizing a compatible final text event
    when the model can't natively combine both (see google/adk/flows/
    llm_flows/_output_schema_processor.py) — confirms _make_plan's existing
    JSON extraction still works once that mechanism is in play, not just
    when the planner emits plain text."""
    from pydantic import PrivateAttr
    from google.adk.models import BaseLlm
    from google.adk.models.llm_response import LlmResponse
    from google.adk.runners import Runner
    from google.adk.sessions import InMemorySessionService
    from google.genai import types as genai_types

    class _ScriptedLlm(BaseLlm):
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

    plan_json = {
        "title": "Bitcoin investment check", "goal": "g", "answer": "",
        "steps": [
            {"id": "s1", "kind": "execute", "title": "Search", "description": "d1", "depends_on": []},
            {"id": "s2", "kind": "execute", "title": "Ask Rabeb", "description": "d2",
             "assignee": "Rabeb", "depends_on": ["s1"]},
        ],
    }
    set_response_call = LlmResponse(content=genai_types.Content(role="model", parts=[
        genai_types.Part(function_call=genai_types.FunctionCall(
            name="set_model_response", args=plan_json, id="call_1"))
    ]))
    fake_model = _ScriptedLlm([set_response_call])
    monkeypatch.setattr(svc.nodes, "build_llm", lambda *a, **k: fake_model)
    # _make_plan resolves "assignee" server-side via search_human_agents
    # (never trusts the planner's own text) — mock that lookup too.
    monkeypatch.setattr(svc.human_agents, "search_human_agents", AsyncMock(
        return_value=[{"id": "rabeb", "name": "Rabeb", "role": "Investment analyst"}]))

    session_service = InMemorySessionService()

    def runner_factory(node, app_name):
        return Runner(node=node, app_name=app_name, session_service=session_service)

    service = svc.OrchestratorService(runner_factory, None, planner_model="fake")
    plan = asyncio.run(service._make_plan("sess1", "u1", "search bitcoin then ask Rabeb"))

    assert plan.title == "Bitcoin investment check"
    assert [s.id for s in plan.steps] == ["s1", "s2"]
    assert plan.steps[1].assignee_name == "Rabeb"
    assert plan.steps[1].assignee == "rabeb"


def test_step_row_shows_the_personas_display_name_before_it_runs():
    """The client should see "Rabeb", not a blank/internal node id, the moment
    a persona-assigned step is projected — not only once it starts running."""
    rabeb_step = Step(id="s2", assignee="rabeb", assignee_name="Rabeb")
    assert svc.OrchestratorService._step_row(1, rabeb_step)[10] == "Rabeb"

    # A plain (non-persona) step shows the DEFAULT_EXECUTOR_LABEL, not blank —
    # a blank/internal node id in the UI is meaningless to a real user.
    plain_step = Step(id="s1")
    assert svc.OrchestratorService._step_row(0, plain_step)[10] == svc.DEFAULT_EXECUTOR_LABEL


def test_extract_json_plain():
    assert svc._extract_json('{"title": "t", "steps": []}') == {"title": "t", "steps": []}


def test_extract_json_with_fences_and_prose():
    text = 'Sure!\n```json\n{"a": 1, "b": [2, 3]}\n```\ndone'
    assert svc._extract_json(text) == {"a": 1, "b": [2, 3]}


def test_extract_json_raises_without_json():
    with pytest.raises(ValueError, match="no JSON"):
        svc._extract_json("no json here")


def test_node_to_step_name_strips_path_and_version():
    assert svc._node_to_step_name("plan_s1@1/step_a@1") == "step_a"
    assert svc._node_to_step_name("n_9abc@2") == "n_9abc"


def test_plan_from_snapshot_reconstructs_kind_and_deps():
    snap = {
        "session": {"id": "s", "status": "waiting", "interrupt_id": "i1"},
        "plan": {"id": "p1", "title": "T", "goal": "G", "status": "blocked"},
        "steps": [
            {"step_id": "s1", "description": "ask name", "kind": "ask",
             "question": "name?", "status": "blocked", "wave": 0,
             "depends_on": "", "result": None},
            {"step_id": "s2", "description": "greet", "kind": "execute",
             "question": None, "status": "pending", "wave": 1,
             "depends_on": "s1", "result": None},
        ],
    }
    plan = svc._plan_from_snapshot(snap)
    assert plan.id == "p1" and plan.goal == "G" and plan.status is Status.BLOCKED
    s1, s2 = plan.steps
    assert s1.kind == "ask" and s1.question == "name?" and s1.status is Status.BLOCKED
    assert s2.kind == "execute" and s2.depends_on == ["s1"] and s2.wave == 1


def test_plan_turn_never_gives_the_workflow_the_users_real_message():
    """The trigger passed to Runner.run_async becomes a session event with no
    branch, and ADK makes an unbranched event visible to every node in the
    graph unconditionally -- regardless of that node's own instruction. That
    is how a step whose own instruction only said "search Apple news" still
    saw the whole original request ("...email Rabeb... search Tesla AND
    Apple...") and, in production, acted on part of it that was never its
    job: it sent its own unstamped copy of an email meant for a different
    step entirely.

    No step's instruction depends on this trigger's content -- each already
    carries its own complete description -- so the fix is to never hand the
    real message to the workflow at all. This pins that the session_id's
    turn-driving call keeps receiving something else, so a future edit can't
    silently put the leak back.
    """
    session = MagicMock()
    session.session_service.get_session = AsyncMock(return_value=object())

    def fake_runner_factory(node, app_name):
        return session

    service = svc.OrchestratorService(fake_runner_factory, None, planner_model="m")
    plan = Plan(id="p", title="t", goal="g", steps=[Step(id="a", kind="execute", description="do a")])
    service._make_plan = AsyncMock(return_value=plan)
    service._drive = AsyncMock(return_value=[])

    secret_message = "email x@example.com asking which company she works for"
    asyncio.run(service.plan_turn(session_id="s1", user_id="u1",
                                  message=secret_message, model="m"))

    service._drive.assert_awaited_once()
    new_message = service._drive.await_args.args[-1]
    sent_text = new_message.parts[0].text
    assert secret_message not in sent_text, (
        "the workflow's trigger must never carry the user's real request text")


# --- delegate_to_human_agent (dynamic sub-plan) -----------------------------

def _fn_factory_holder():
    """A minimal node factory for _delegate_tool_for's nested to_workflow() call
    — a real ADK FunctionNode (like test_graph.py's), no LLM involved."""
    from google.adk.workflow import FunctionNode

    async def _noop():
        return None

    return [lambda step, name: FunctionNode(func=_noop, name=name)]


def test_delegate_tool_appends_a_step_assigned_to_the_target_and_calls_run_node(monkeypatch):
    monkeypatch.setattr(svc.human_agents, "search_human_agents", AsyncMock(
        return_value=[{"id": "oussama", "name": "Oussama", "role": "Investment approver"}]))
    rm = MagicMock(upsert_steps=AsyncMock(), set_step_status=AsyncMock())
    service = svc.OrchestratorService(MagicMock(), rm, planner_model="m")
    plan = Plan(id="p", title="t", goal="g", steps=[
        Step(id="s1", kind="execute", description="search bitcoin price"),
        Step(id="s2", kind="execute", description="ask if we should invest",
             assignee="rabeb", assignee_name="Rabeb", depends_on=["s1"]),
    ])
    name_to_step = {"s1": "s1", "s2": "s2"}
    tool = service._delegate_tool_for("sess1", "u1", plan, _fn_factory_holder(), name_to_step, "s2")

    tool_context = MagicMock()
    tool_context.run_node = AsyncMock(return_value="Approved — go ahead.")

    result = asyncio.run(tool.func(
        "Oussama", "Should we invest in bitcoin today?", tool_context=tool_context))

    assert result == "Approved — go ahead."
    assert len(plan.steps) == 3
    new_step = plan.steps[-1]
    assert new_step.assignee == "oussama"
    assert new_step.assignee_name == "Oussama"
    assert new_step.assignee_role == "Investment approver"
    assert new_step.description == "Should we invest in bitcoin today?"
    assert new_step.id in name_to_step.values()
    # The delegated step must depend on its caller so assign_waves puts it
    # after the caller's wave, not at wave 0 as if independent.
    assert new_step.depends_on == ["s2"]
    assert new_step.wave == 2
    tool_context.run_node.assert_awaited_once()
    # Without use_sub_branch=True, ADK loses track of the calling step's own
    # function-call event once the delegate's events land on the same branch.
    assert tool_context.run_node.await_args.kwargs["use_sub_branch"] is True
    rm.upsert_steps.assert_awaited_once()

    # The caller reads "blocked" while the delegate runs, then "running" again.
    caller_calls = [c for c in rm.set_step_status.call_args_list if c.args[1] == "s2"]
    assert [c.args[2] for c in caller_calls] == ["blocked", "running"]
    assert caller_calls[0].kwargs["blocked_reason"] == "waiting on Oussama"
    assert plan.step("s2").status is Status.RUNNING
    assert plan.step("s2").blocked_reason is None


def test_delegate_tool_unblocks_the_caller_even_when_the_delegate_errors(monkeypatch):
    """A failed delegate must not leave the caller stuck showing "blocked"
    forever on the plan card."""
    monkeypatch.setattr(svc.human_agents, "search_human_agents", AsyncMock(
        return_value=[{"id": "oussama", "name": "Oussama", "role": "Investment approver"}]))
    rm = MagicMock(upsert_steps=AsyncMock(), set_step_status=AsyncMock())
    service = svc.OrchestratorService(MagicMock(), rm, planner_model="m")
    plan = Plan(id="p", steps=[
        Step(id="s2", kind="execute", description="ask", assignee="rabeb", assignee_name="Rabeb"),
    ])
    tool = service._delegate_tool_for("sess1", "u1", plan, _fn_factory_holder(), {}, "s2")

    tool_context = MagicMock()
    tool_context.run_node = AsyncMock(side_effect=RuntimeError("boom"))

    result = asyncio.run(tool.func("Oussama", "task", tool_context=tool_context))

    assert "Error asking Oussama" in result
    caller_calls = [c for c in rm.set_step_status.call_args_list if c.args[1] == "s2"]
    assert [c.args[2] for c in caller_calls] == ["blocked", "running"]
    assert plan.step("s2").status is Status.RUNNING


def test_delegate_tool_rejects_an_unknown_agent_without_touching_the_plan(monkeypatch):
    monkeypatch.setattr(svc.human_agents, "search_human_agents", AsyncMock(return_value=[]))
    service = svc.OrchestratorService(MagicMock(), None, planner_model="m")
    plan = Plan(id="p", steps=[Step(id="s1")])
    tool = service._delegate_tool_for("sess1", "u1", plan, _fn_factory_holder(), {}, "s1")

    result = asyncio.run(tool.func("nobody", "task", tool_context=MagicMock()))

    assert "Unknown agent" in result
    assert len(plan.steps) == 1


def test_delegate_tool_refuses_to_delegate_to_itself(monkeypatch):
    """A persona whose role reads as 'lacking authority' can delegate to
    itself repeatedly; this backstop holds regardless of role wording."""
    monkeypatch.setattr(svc.human_agents, "search_human_agents", AsyncMock(
        return_value=[{"id": "sami", "name": "Sami", "role": "General analyst"}]))
    service = svc.OrchestratorService(MagicMock(), None, planner_model="m")
    plan = Plan(id="p", steps=[
        Step(id="s2", kind="execute", description="give a decision",
             assignee="sami", assignee_name="Sami"),
    ])
    tool = service._delegate_tool_for("sess1", "u1", plan, _fn_factory_holder(), {}, "s2")

    result = asyncio.run(tool.func("Sami", "give a decision", tool_context=MagicMock()))

    assert "cannot delegate to yourself" in result
    assert len(plan.steps) == 1


def test_delegate_tool_refuses_past_the_step_cap(monkeypatch):
    monkeypatch.setattr(svc.human_agents, "search_human_agents", AsyncMock(
        return_value=[{"id": "oussama", "name": "Oussama", "role": "Investment approver"}]))
    service = svc.OrchestratorService(MagicMock(), None, planner_model="m")
    plan = Plan(id="p", steps=[Step(id=f"s{i}") for i in range(svc.MAX_PLAN_STEPS)])
    tool = service._delegate_tool_for("sess1", "u1", plan, _fn_factory_holder(), {}, "s0")

    result = asyncio.run(tool.func("Oussama", "task", tool_context=MagicMock()))

    assert "step limit" in result
    assert len(plan.steps) == svc.MAX_PLAN_STEPS
