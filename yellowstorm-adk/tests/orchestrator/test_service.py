"""Unit tests for OrchestratorService pure helpers (no ADK/DB/LLM)."""
import asyncio
import os
import sys
from unittest.mock import AsyncMock, MagicMock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import pytest

from src.companion_ai import scheduler, service as svc
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


def test_plan_turn_stamps_the_clients_executor_onto_every_plain_step():
    """Every step is executed by someone: a human-agent persona, or — for
    the rest — the client's own configured executor agent. plan_turn stamps
    that identity onto plan.assignee/assignee_name once, right after the
    plan is built, so every later read (initial projection, re-projection
    on delegation, the delegate-tool gate) is just `step.assignee_name`,
    with no separate executor_name/executor_id fallback needed anywhere."""
    session = MagicMock()
    session.session_service.get_session = AsyncMock(return_value=object())
    service = svc.OrchestratorService(lambda node, app_name: session, None, planner_model="m")
    plan = Plan(id="p", title="t", goal="g", steps=[
        Step(id="s1", kind="execute", description="search"),
        Step(id="s2", kind="execute", description="ask Rabeb",
             is_persona=True, assignee="rabeb", assignee_name="Rabeb"),
    ])
    service._make_plan = AsyncMock(return_value=plan)
    service._drive = AsyncMock(return_value=[])

    asyncio.run(service.plan_turn(
        session_id="s1", user_id="u1", message="go", model="m",
        executor_name="Worky executor", executor_id="exec-42"))

    assert (plan.step("s1").assignee, plan.step("s1").assignee_name) == ("exec-42", "Worky executor")
    assert plan.step("s1").is_persona is False
    # A persona step keeps its own identity untouched.
    assert (plan.step("s2").assignee, plan.step("s2").assignee_name) == ("rabeb", "Rabeb")


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


def test_plan_from_snapshot_restores_is_dynamic_delegate():
    """Without this surviving the round trip, resume_turn/continue_turn can't
    tell a delegate_to_human_agent step from a plain one, and nodes.py's
    short-circuit (see test_await_reply.py) never fires — the step silently
    re-runs its LLM call on every resume instead of replaying its answer."""
    snap = {
        "session": {"id": "s", "status": "waiting", "interrupt_id": None},
        "plan": {"id": "p1", "title": "T", "goal": "G", "status": "running"},
        "steps": [
            {"step_id": "s1", "description": "ask James", "kind": "execute",
             "status": "completed", "wave": 1, "depends_on": "", "result": "answer",
             "assignee": "james", "assignee_name": "James",
             "is_persona": True, "is_dynamic_delegate": True},
        ],
    }
    plan = svc._plan_from_snapshot(snap)
    assert plan.steps[0].is_dynamic_delegate is True


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
             is_persona=True, assignee="rabeb", assignee_name="Rabeb", depends_on=["s1"]),
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


def test_delegate_tool_propagates_dependency_to_siblings_for_an_accurate_wave(monkeypatch):
    """s3 already depends on the caller (s1). Once s1 dynamically spawns a
    delegate, s3 can't really start until that finishes either — s1's own
    node doesn't complete until its delegate call does, so s3 must land in
    a later wave than the delegate, not the same one."""
    monkeypatch.setattr(svc.human_agents, "search_human_agents", AsyncMock(
        return_value=[{"id": "david", "name": "David", "role": "Risk manager"}]))
    rm = MagicMock(upsert_steps=AsyncMock(), set_step_status=AsyncMock())
    service = svc.OrchestratorService(MagicMock(), rm, planner_model="m")
    plan = Plan(id="p", title="t", goal="g", steps=[
        Step(id="s1", kind="execute", description="ask James",
             is_persona=True, assignee="james", assignee_name="James"),
        Step(id="s3", kind="execute", description="formal sign-off", depends_on=["s1"]),
    ])
    scheduler.assign_waves(plan)
    assert plan.step("s3").wave == 1  # before delegation

    name_to_step = {"s1": "s1", "s3": "s3"}
    tool = service._delegate_tool_for("sess1", "u1", plan, _fn_factory_holder(), name_to_step, "s1")
    tool_context = MagicMock()
    tool_context.run_node = AsyncMock(return_value="modest sizing")

    asyncio.run(tool.func("David", "risk read?", tool_context=tool_context))

    new_step = plan.steps[-1]
    assert new_step.assignee_name == "David"
    assert plan.step("s3").depends_on == ["s1", new_step.id]
    assert plan.step("s3").wave == 2  # correctly later than David's wave (1), not equal to it


def test_delegate_tool_reprojects_a_plain_sibling_without_losing_its_executor_id(monkeypatch):
    """s3 is a plain (non-persona) step, already stamped with the client's
    executor id/name by plan_turn before the workflow ever runs (see
    test_plan_turn_stamps_the_clients_executor_onto_every_plain_step). It
    gets re-projected here by the dependency-propagation above, once s1
    dynamically spawns a delegate — that re-projection must not lose the
    stamped id/name, since _step_row has no fallback of its own to fall
    back on."""
    monkeypatch.setattr(svc.human_agents, "search_human_agents", AsyncMock(
        return_value=[{"id": "david", "name": "David", "role": "Risk manager"}]))
    rm = MagicMock(upsert_steps=AsyncMock(), set_step_status=AsyncMock())
    service = svc.OrchestratorService(MagicMock(), rm, planner_model="m")
    plan = Plan(id="p", title="t", goal="g", steps=[
        Step(id="s1", kind="execute", description="ask James",
             is_persona=True, assignee="james", assignee_name="James"),
        Step(id="s3", kind="execute", description="formal sign-off", depends_on=["s1"],
             assignee="exec-42", assignee_name="Worky executor"),
    ])
    scheduler.assign_waves(plan)

    name_to_step = {"s1": "s1", "s3": "s3"}
    tool = service._delegate_tool_for("sess1", "u1", plan, _fn_factory_holder(), name_to_step, "s1")
    tool_context = MagicMock()
    tool_context.run_node = AsyncMock(return_value="modest sizing")

    asyncio.run(tool.func("David", "risk read?", tool_context=tool_context))

    s3_rows = [row for c in rm.upsert_steps.call_args_list
               for row in c.args[1] if row[0] == "s3"]
    assert s3_rows, "s3 should have been re-projected after its depends_on changed"
    assert s3_rows[-1][9] == "exec-42"
    assert s3_rows[-1][10] == "Worky executor"


def test_delegate_tool_keeps_two_consultations_from_the_same_caller_parallel(monkeypatch):
    """James asks both David and Oussama. They're independent branches of
    the same caller, not a chain, and must stay siblings at the same wave —
    not get sequentialized into one wave after the other."""
    monkeypatch.setattr(svc.human_agents, "search_human_agents", AsyncMock(side_effect=[
        [{"id": "david", "name": "David", "role": "Risk manager"}],
        [{"id": "oussama", "name": "Oussama", "role": "Investment approver"}],
    ]))
    rm = MagicMock(upsert_steps=AsyncMock(), set_step_status=AsyncMock())
    service = svc.OrchestratorService(MagicMock(), rm, planner_model="m")
    plan = Plan(id="p", title="t", goal="g", steps=[
        Step(id="s1", kind="execute", description="ask James",
             is_persona=True, assignee="james", assignee_name="James"),
        Step(id="s3", kind="execute", description="formal sign-off", depends_on=["s1"]),
    ])
    scheduler.assign_waves(plan)

    name_to_step = {"s1": "s1", "s3": "s3"}
    tool = service._delegate_tool_for("sess1", "u1", plan, _fn_factory_holder(), name_to_step, "s1")
    tool_context = MagicMock()
    tool_context.run_node = AsyncMock(return_value="ok")

    asyncio.run(tool.func("David", "risk read?", tool_context=tool_context))
    asyncio.run(tool.func("Oussama", "approve?", tool_context=tool_context))

    david, oussama = plan.steps[2], plan.steps[3]
    assert david.assignee_name == "David" and oussama.assignee_name == "Oussama"
    # Neither delegate depends on the other — they're parallel siblings.
    assert david.depends_on == ["s1"]
    assert oussama.depends_on == ["s1"]
    assert david.wave == oussama.wave == 1
    # The genuinely later step picks up BOTH, and lands one wave after them.
    assert plan.step("s3").depends_on == ["s1", david.id, oussama.id]
    assert plan.step("s3").wave == 2


def test_create_task_tool_appends_a_step_and_calls_run_node():
    """create_task mirrors delegate_to_human_agent's mechanics but for a
    generic follow-up task, not a named colleague — e.g. Sarah reads a
    compliance reply revealing a PEP and spins off an actual screening
    check instead of just writing "requires senior approval" in her own
    answer."""
    rm = MagicMock(upsert_steps=AsyncMock(), set_step_status=AsyncMock())
    service = svc.OrchestratorService(MagicMock(), rm, planner_model="m")
    plan = Plan(id="p", title="t", goal="g", steps=[
        Step(id="s1", kind="execute", description="review compliance reply",
            is_persona=True, assignee="sarah", assignee_name="Sarah"),
    ])
    name_to_step = {"s1": "s1"}
    tool = service._create_task_tool_for("sess1", "u1", plan, _fn_factory_holder(), name_to_step, "s1")

    tool_context = MagicMock()
    tool_context.run_node = AsyncMock(return_value="Screening complete: no sanctions hits.")

    result = asyncio.run(tool.func("Run a sanctions screening check on the UBO.",
                                   tool_context=tool_context))

    assert result == "Screening complete: no sanctions hits."
    assert len(plan.steps) == 2
    new_step = plan.steps[-1]
    assert new_step.description == "Run a sanctions screening check on the UBO."
    assert new_step.kind == "execute"
    assert new_step.is_persona is False  # a plain follow-up task, not a colleague
    assert new_step.is_dynamic_delegate is True  # same resume short-circuit as a delegate
    assert new_step.depends_on == ["s1"]
    tool_context.run_node.assert_awaited_once()
    assert tool_context.run_node.await_args.kwargs["use_sub_branch"] is True


def test_create_task_and_delegate_share_siblings_instead_of_chaining():
    """Both tools grow the SAME plan mid-turn (see _build_workflow, which
    passes them one shared siblings set) -- a create_task call and a
    delegate_to_human_agent call from the same caller must land as
    parallel siblings, not get sequentialized, exactly like two
    delegate_to_human_agent calls already must (see the sibling test
    above) -- otherwise a persona using both tools together regresses
    the wave-chaining bug that fix originally solved."""
    rm = MagicMock(upsert_steps=AsyncMock(), set_step_status=AsyncMock())
    service = svc.OrchestratorService(MagicMock(), rm, planner_model="m")
    plan = Plan(id="p", title="t", goal="g", steps=[
        Step(id="s1", kind="execute", description="review compliance reply",
            is_persona=True, assignee="sarah", assignee_name="Sarah"),
        Step(id="s2", kind="execute", description="final memo", depends_on=["s1"]),
    ])
    scheduler.assign_waves(plan)

    name_to_step = {"s1": "s1", "s2": "s2"}
    siblings: set = set()
    factory_holder = _fn_factory_holder()
    delegate_tool = service._delegate_tool_for("sess1", "u1", plan, factory_holder,
                                               name_to_step, "s1", siblings)
    task_tool = service._create_task_tool_for("sess1", "u1", plan, factory_holder,
                                              name_to_step, "s1", siblings)

    async def fake_search_human_agents(*, name=None, role=None):
        return [{"id": "oussama", "name": "Oussama", "role": "Investment approver"}]
    import unittest.mock as mock
    with mock.patch.object(svc.human_agents, "search_human_agents", fake_search_human_agents):
        tool_context = MagicMock()
        tool_context.run_node = AsyncMock(return_value="ok")
        asyncio.run(task_tool.func("Run a sanctions screening check.", tool_context=tool_context))
        asyncio.run(delegate_tool.func("Oussama", "sign off?", tool_context=tool_context))

    task_step, delegate_step = plan.steps[2], plan.steps[3]
    # Neither spawned step depends on the other -- parallel siblings.
    assert task_step.depends_on == ["s1"]
    assert delegate_step.depends_on == ["s1"]
    assert task_step.wave == delegate_step.wave == 1
    # The genuinely later step picks up BOTH.
    assert plan.step("s2").depends_on == ["s1", task_step.id, delegate_step.id]
    assert plan.step("s2").wave == 2


def test_apply_event_marks_a_completed_dynamic_delegate_step_as_completed():
    """_apply_event -- not a test harness that bypasses it -- must recognize
    the is_dynamic_delegate short-circuit's FunctionNode event as a real
    completion. output_for, the field _apply_event used to gate on alone,
    is confirmed empirically unset for a FunctionNode's event regardless of
    downstream dependents (checked directly against a real Runner) -- so
    before this fix the step stayed "running" in the read model forever,
    even though it had a real, correct result and correctly unblocked
    whatever depended on it via ADK's own session state (seen live: session
    ee477bcc88ed43b299a8d17356064855 -- Sarah/David/James stuck "running"
    after a resume while the step depending on them still finished)."""
    from google.adk.runners import InMemoryRunner
    from google.genai import types

    rm = MagicMock(upsert_steps=AsyncMock(), set_step_status=AsyncMock())
    service = svc.OrchestratorService(MagicMock(), rm, planner_model="m")
    plan = Plan(id="p", steps=[
        Step(id="a", kind="execute", is_persona=True, is_dynamic_delegate=True,
            status=Status.COMPLETED, result="James's original second opinion.",
            assignee_name="James"),
    ])
    factory = svc.nodes.make_llm_node_factory(model_name="x", tools=[])
    wf = svc.graph.to_workflow(plan, factory, name="t", max_concurrency=4)
    name_to_step = {svc.graph.node_name(s.id): s.id for s in plan.steps}

    runner = InMemoryRunner(node=wf, app_name="t")
    asyncio.run(runner.session_service.create_session(app_name="t", user_id="u", session_id="s"))
    asyncio.run(service._drive(
        runner, "s", "u", plan, name_to_step,
        types.Content(role="user", parts=[types.Part(text="go")])))

    assert plan.step("a").status is Status.COMPLETED
    completed_calls = [c for c in rm.set_step_status.call_args_list if c.args[2] == "completed"]
    assert completed_calls, "step should have been marked completed in the read model, not left running"
    assert completed_calls[0].kwargs.get("result") == "James's original second opinion."


def test_apply_event_does_not_complete_an_await_reply_step_on_the_interrupt_it_raises():
    """The event that RAISES an await_reply/ask interrupt also satisfies
    is_final_response() (it carries long_running_tool_ids, which
    is_final_response() treats as final) -- the opposite of complete. If
    that event were mistaken for completion, every await_reply/ask step
    would flip to "completed" the instant it parks, before anyone replies."""
    from google.adk.runners import InMemoryRunner
    from google.genai import types

    rm = MagicMock(upsert_steps=AsyncMock(), set_step_status=AsyncMock())
    service = svc.OrchestratorService(MagicMock(), rm, planner_model="m")
    plan = Plan(id="p", steps=[Step(id="a", kind="await_reply", question="Awaiting a reply")])
    factory = svc.nodes.make_llm_node_factory(model_name="x", tools=[])
    wf = svc.graph.to_workflow(plan, factory, name="t", max_concurrency=4)
    name_to_step = {svc.graph.node_name(s.id): s.id for s in plan.steps}

    runner = InMemoryRunner(node=wf, app_name="t")
    asyncio.run(runner.session_service.create_session(app_name="t", user_id="u", session_id="s"))
    asyncio.run(service._drive(
        runner, "s", "u", plan, name_to_step,
        types.Content(role="user", parts=[types.Part(text="go")])))

    assert plan.step("a").status is not Status.COMPLETED
    assert not any(c.args[2] == "completed" for c in rm.set_step_status.call_args_list)


def test_a_plain_step_reading_a_mail_reply_gets_delegation_tools_too():
    """Only the step directly downstream of an await_reply is positioned to
    notice the reply itself says e.g. "loop in Oussama" or "email x" -- it
    needs the tools to act on that even though it's a plain executor step,
    not a persona (seen live: session 7752a273b2054d4d921d9514eb933d85 --
    the final memo step correctly caught a data discrepancy in a reply but
    had no way to act on it, since is_persona=False steps never got
    delegate_to_human_agent/create_task at all before this)."""
    service = svc.OrchestratorService(MagicMock(), None, planner_model="m")
    plan = Plan(id="p", steps=[
        Step(id="s3", kind="await_reply", question="Awaiting a reply"),
        Step(id="s4", kind="execute", description="write the memo", depends_on=["s3"]),
        # A step NOT downstream of the reply must not get these tools --
        # otherwise every step in the plan ends up able to delegate, which
        # is a much bigger, unintended widening than "the step reading a
        # mail reply specifically".
        Step(id="s5", kind="execute", description="unrelated step"),
    ])
    wf, _ = service._build_workflow("sess1", "u1", plan, "x", None, None)
    nodes_by_name = {n.name: n for n in wf.graph.nodes}

    def tool_names(node):
        return {getattr(getattr(t, "func", None), "__name__", "?") for t in getattr(node, "tools", [])}

    assert {"find_human_agents", "delegate_to_human_agent", "create_task"} <= tool_names(nodes_by_name["s4"])
    assert not tool_names(nodes_by_name["s5"]) & {"delegate_to_human_agent", "create_task"}


def test_delegate_tool_unblocks_the_caller_even_when_the_delegate_errors(monkeypatch):
    """A failed delegate must not leave the caller stuck showing "blocked"
    forever on the plan card."""
    monkeypatch.setattr(svc.human_agents, "search_human_agents", AsyncMock(
        return_value=[{"id": "oussama", "name": "Oussama", "role": "Investment approver"}]))
    rm = MagicMock(upsert_steps=AsyncMock(), set_step_status=AsyncMock())
    service = svc.OrchestratorService(MagicMock(), rm, planner_model="m")
    plan = Plan(id="p", steps=[
        Step(id="s2", kind="execute", description="ask", is_persona=True,
             assignee="rabeb", assignee_name="Rabeb"),
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
             is_persona=True, assignee="sami", assignee_name="Sami"),
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
