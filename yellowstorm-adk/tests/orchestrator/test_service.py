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


def test_resume_turn_completes_a_dynamic_await_reply_step_out_of_band():
    """A create_task(kind='await_reply')-spawned step's first park happened
    inside a throwaway nested run (ctx.run_node) whose node path a later
    flat resume rebuild can never reproduce — so hitl.resume_part's
    node-path-keyed matching can never actually reach IT; ADK just re-blocks
    it under a brand new interrupt id and the real answer is silently
    dropped. Live example: a persona's create_task(kind='await_reply') step
    got its reply matched and claimed in mail_waits, yet stayed blocked
    forever because the resume never landed on the right node. resume_turn
    must apply the answer directly to the step instead of relying on that
    match. It must still drive with hitl.resume_part, though (see the next
    test) — a generic trigger was tried and reverted after live sessions
    showed it makes the CALLER (e.g. the persona that spawned this step)
    replay as a fresh turn instead of a continuation, redoing its entire
    reasoning including sending a second real email."""
    session = MagicMock()
    session.session_service.get_session = AsyncMock(return_value=object())
    rm = MagicMock()
    rm.snapshot = AsyncMock(return_value={
        "session": {"id": "s1", "status": "blocked", "interrupt_id": None},
        "plan": {"id": "p1", "title": "T", "goal": "G", "status": "blocked",
                "executor_id": "exec1", "executor_name": "Worky executor"},
        "steps": [
            {"step_id": "s0", "description": "persona step", "kind": "execute",
             "status": "completed", "wave": 0, "depends_on": "", "result": "sent",
             "is_persona": True, "assignee": "hamdi", "assignee_name": "Hamdi Imed"},
            {"step_id": "n1", "description": "", "kind": "await_reply",
             "status": "blocked", "wave": 1, "depends_on": "s0", "result": None,
             "is_dynamic_delegate": True},
        ],
    })
    rm.outstanding_interrupts = AsyncMock(return_value=[("mail:task_n1@1/n_n1@1", "n1")])
    rm.set_step_status = AsyncMock()

    service = svc.OrchestratorService(lambda node, app_name: session, rm, planner_model="m")
    service._build_workflow = MagicMock(return_value=(MagicMock(), {}))
    service._drive = AsyncMock(return_value=[])
    service._finalize = AsyncMock()

    plan = asyncio.run(service.resume_turn(
        session_id="s1", user_id="u1", answer="Go ahead, migrate.", model="m",
        interrupt_id="mail:task_n1@1/n_n1@1"))

    assert plan.step("n1").status is Status.COMPLETED
    assert plan.step("n1").result == "Go ahead, migrate."
    rm.set_step_status.assert_awaited_once_with(
        "s1", "n1", "completed", result="Go ahead, migrate.")

    # Still driven with hitl.resume_part (using the stale-but-real id) — it
    # doesn't need to match anything current since this step's own node
    # never gets rebuilt as a real await_reply this turn (short-circuited
    # above); what matters is that the trigger correctly resolves to a real
    # prior invocation so ADK replays the caller instead of re-running it.
    trigger = service._drive.await_args.args[-1]
    assert trigger.parts[0].text is None
    assert trigger.parts[0].function_response is not None


def test_resume_turn_still_uses_hitl_resume_part_for_an_ordinary_step():
    """A top-level ask/await_reply step's node path IS stable across resume
    (the same flat top-level workflow both times) — this must keep going
    through ADK's normal interrupt matching, not the out-of-band shortcut
    above, which is only for a step that never had a stable path to begin
    with."""
    session = MagicMock()
    session.session_service.get_session = AsyncMock(return_value=object())
    rm = MagicMock()
    rm.snapshot = AsyncMock(return_value={
        "session": {"id": "s1", "status": "waiting", "interrupt_id": "ask:plan_s1@1/q@1"},
        "plan": {"id": "p1", "title": "T", "goal": "G", "status": "blocked",
                "executor_id": None, "executor_name": None},
        "steps": [
            {"step_id": "q", "description": "", "kind": "ask", "question": "Which format?",
             "status": "blocked", "wave": 0, "depends_on": "", "result": None},
        ],
    })
    rm.outstanding_interrupts = AsyncMock(return_value=[("ask:plan_s1@1/q@1", "q")])
    rm.set_step_status = AsyncMock()

    service = svc.OrchestratorService(lambda node, app_name: session, rm, planner_model="m")
    service._build_workflow = MagicMock(return_value=(MagicMock(), {}))
    service._drive = AsyncMock(return_value=[])
    service._finalize = AsyncMock()

    asyncio.run(service.resume_turn(
        session_id="s1", user_id="u1", answer="CSV", model="m",
        interrupt_id="ask:plan_s1@1/q@1"))

    rm.set_step_status.assert_not_awaited()
    trigger = service._drive.await_args.args[-1]
    assert trigger.parts[0].text is None
    assert trigger.parts[0].function_response is not None


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


def test_delegate_tool_appends_a_scheduled_step_and_never_runs_it_nested(monkeypatch):
    monkeypatch.setattr(svc.human_agents, "search_human_agents", AsyncMock(
        return_value=[{"id": "oussama", "name": "Oussama", "role": "Investment approver"}]))
    rm = MagicMock(upsert_steps=AsyncMock(), set_step_status=AsyncMock(),
                   rebind_mail_wait=AsyncMock())
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

    # Asking a colleague is asynchronous — they answer by email, hours or days
    # later — so the delegate is a scheduled step and its answer lands THERE.
    # It must never be run nested: run_node buffers a sub-node's events until
    # it finishes, while ADK rebuilds the LLM contents from session events
    # before every call, so a nested sub-agent could not see its own previous
    # tool calls and re-issued them until the budget cap (verified live: 0
    # model rounds, 0 function calls in context on all 25 of its calls).
    tool_context.run_node.assert_not_awaited()
    assert "Oussama" in result
    # The caller must be told plainly not to wait or invent an answer.
    assert "not hand" in result.lower() or "arrives there" in result.lower() \
        or "own step" in result.lower(), result
    assert "never guess" in result.lower() or "do not wait" in result.lower() \
        or "do NOT wait" in result, result

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
    rm.upsert_steps.assert_awaited_once()

    # The caller is not blocked on it any more — it ends its own turn instead.
    caller_calls = [c for c in rm.set_step_status.call_args_list if c.args[1] == "s2"]
    assert [c.args[2] for c in caller_calls] == []
    assert plan.step("s2").blocked_reason is None


def test_delegate_tool_propagates_dependency_to_siblings_for_an_accurate_wave(monkeypatch):
    """s3 already depends on the caller (s1). Once s1 dynamically spawns a
    delegate, s3 can't really start until that finishes either — s1's own
    node doesn't complete until its delegate call does, so s3 must land in
    a later wave than the delegate, not the same one."""
    monkeypatch.setattr(svc.human_agents, "search_human_agents", AsyncMock(
        return_value=[{"id": "david", "name": "David", "role": "Risk manager"}]))
    rm = MagicMock(upsert_steps=AsyncMock(), set_step_status=AsyncMock(),
                   rebind_mail_wait=AsyncMock())
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
    rm = MagicMock(upsert_steps=AsyncMock(), set_step_status=AsyncMock(),
                   rebind_mail_wait=AsyncMock())
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
    rm = MagicMock(upsert_steps=AsyncMock(), set_step_status=AsyncMock(),
                   rebind_mail_wait=AsyncMock())
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


def test_create_task_execute_is_scheduled_not_run_nested():
    """create_task mirrors delegate_to_human_agent's mechanics but for a
    generic follow-up task, not a named colleague — e.g. Sarah reads a
    compliance reply revealing a PEP and spins off an actual screening
    check instead of just writing "requires senior approval" in her own
    answer.

    kind='execute' builds an LlmAgent, so like a delegate it must NOT run
    nested: run_node buffers a sub-node's events until it finishes, while ADK
    rebuilds the LLM contents from session events before every call, so the
    sub-agent could not see its own previous tool calls and re-issued them
    until the budget cap. ('ask'/'await_reply' are different — they build
    one-shot wait nodes with no LLM loop, and DO run here so they park and
    register their interrupt; see the await_reply tests.)"""
    rm = MagicMock(upsert_steps=AsyncMock(), set_step_status=AsyncMock(),
                   rebind_mail_wait=AsyncMock())
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

    tool_context.run_node.assert_not_awaited()
    assert "own step" in result.lower(), result
    assert len(plan.steps) == 2
    new_step = plan.steps[-1]
    assert new_step.description == "Run a sanctions screening check on the UBO."
    assert new_step.kind == "execute"
    assert new_step.is_persona is False  # a plain follow-up task, not a colleague
    assert new_step.is_dynamic_delegate is True  # same resume short-circuit as a delegate
    assert new_step.depends_on == ["s1"]


def test_create_task_step_inherits_the_plans_executor_name_not_the_generic_label():
    """A dynamically-created step (create_task/await_reply spawned mid-turn
    from inside a persona's own tool calls) is born after plan_turn's
    one-time stamping pass. Regression: it used to derive the executor name
    by scanning for a non-persona sibling step, which fails whenever the
    WHOLE plan is persona-assigned (e.g. the planner routed straight to a
    human agent, with no plain step anywhere) — live example: a plan with
    only "Ask Oussama" + his own delegate to Rabeb, no plain step at all,
    still showed the generic "Executor" label on his await_reply sub-step.
    The executor identity now lives on the plan itself, set once at
    plan_turn, so it's always available regardless of step composition."""
    rm = MagicMock(upsert_steps=AsyncMock(), set_step_status=AsyncMock(),
                   rebind_mail_wait=AsyncMock())
    service = svc.OrchestratorService(MagicMock(), rm, planner_model="m")
    plan = Plan(id="p", title="t", goal="g", executor_id="exec1", executor_name="Worky executor",
                steps=[
        # Every step is a persona — no plain sibling to copy from.
        Step(id="s1", kind="execute", description="review compliance reply",
            is_persona=True, assignee="sarah", assignee_name="Sarah"),
    ])
    name_to_step = {"s1": "s1"}
    tool = service._create_task_tool_for("sess1", "u1", plan, _fn_factory_holder(), name_to_step, "s1")

    tool_context = MagicMock()
    tool_context.run_node = AsyncMock(return_value="done")

    asyncio.run(tool.func("Email someone and wait.", kind="await_reply", tool_context=tool_context))

    # kind='await_reply' now creates TWO steps: the bare await_reply wait
    # (generic executor, unrelated to the caller's own identity) and a
    # follow-up step that inherits the PERSONA caller's identity — see the
    # next test for that half.
    await_step = plan.steps[-2]
    assert await_step.assignee_name == "Worky executor"
    assert await_step.assignee == "exec1"


def test_create_task_await_reply_followup_step_inherits_the_personas_identity():
    """The follow-up step is what actually gives the real, final answer once
    the reply is in — see service.py's create_task docstring on why the
    caller's own tool call can't survive that long. It must run AS the
    persona (not the generic executor), or the "final answer" comes out in
    nobody's voice."""
    rm = MagicMock(upsert_steps=AsyncMock(), set_step_status=AsyncMock(),
                   rebind_mail_wait=AsyncMock())
    service = svc.OrchestratorService(MagicMock(), rm, planner_model="m")
    plan = Plan(id="p", title="t", goal="g", executor_id="exec1", executor_name="Worky executor",
                steps=[
        Step(id="s1", kind="execute", description="review compliance reply",
            is_persona=True, assignee="sarah", assignee_name="Sarah", assignee_role="Compliance officer."),
    ])
    name_to_step = {"s1": "s1"}
    tool = service._create_task_tool_for("sess1", "u1", plan, _fn_factory_holder(), name_to_step, "s1")

    tool_context = MagicMock()
    tool_context.run_node = AsyncMock(return_value="done")
    asyncio.run(tool.func("Give the real final answer once Hamdi replies.",
                          kind="await_reply", tool_context=tool_context))

    followup = plan.steps[-1]
    assert followup.is_persona is True
    assert followup.assignee_name == "Sarah"
    assert followup.assignee_role == "Compliance officer."
    assert followup.depends_on == [plan.steps[-2].id]  # depends on the AWAIT step, not the caller


def test_create_task_step_falls_back_to_the_generic_label_with_no_executor_on_the_plan():
    """The plan carries no executor identity at all (e.g. a snapshot from
    before this field existed) — DEFAULT_EXECUTOR_LABEL is still the right
    fallback for the await_reply step itself, not a crash or a blank."""
    rm = MagicMock(upsert_steps=AsyncMock(), set_step_status=AsyncMock(),
                   rebind_mail_wait=AsyncMock())
    service = svc.OrchestratorService(MagicMock(), rm, planner_model="m")
    plan = Plan(id="p", title="t", goal="g", steps=[
        Step(id="s1", kind="execute", description="review compliance reply",
            is_persona=True, assignee="sarah", assignee_name="Sarah"),
    ])
    name_to_step = {"s1": "s1"}
    tool = service._create_task_tool_for("sess1", "u1", plan, _fn_factory_holder(), name_to_step, "s1")

    tool_context = MagicMock()
    tool_context.run_node = AsyncMock(return_value="done")

    asyncio.run(tool.func("Email someone and wait.", kind="await_reply", tool_context=tool_context))

    assert plan.steps[-2].assignee_name == svc.DEFAULT_EXECUTOR_LABEL


def test_create_task_await_reply_rebinds_the_callers_pending_token_onto_the_new_step():
    """create_task(kind='await_reply') creates the wait AFTER the caller has
    already sent its mail — _mail_stamping minted that mail's token eagerly
    under a placeholder (__pending__:<caller>) since the real waiting step
    didn't exist yet. This must retarget that token onto the real new AWAIT
    step (not the follow-up step that depends on it), or the reply that
    arrives has no wait to match against and the step blocks forever —
    exactly the bug a live session hit: a step emailed a follow-up, called
    create_task(kind='await_reply'), and the new step stayed blocked with no
    way for any reply to ever reach it."""
    rm = MagicMock(upsert_steps=AsyncMock(), set_step_status=AsyncMock(),
                   rebind_mail_wait=AsyncMock())
    service = svc.OrchestratorService(MagicMock(), rm, planner_model="m")
    plan = Plan(id="p", title="t", goal="g",
               steps=[Step(id="s3", kind="execute", description="handle the reply")])
    name_to_step = {"s3": "s3"}
    tool = service._create_task_tool_for("sess1", "u1", plan, _fn_factory_holder(), name_to_step, "s3")

    tool_context = MagicMock()
    tool_context.run_node = AsyncMock(return_value="done")
    asyncio.run(tool.func("Email someone and wait.", kind="await_reply", tool_context=tool_context))

    await_step = plan.steps[-2]
    rm.rebind_mail_wait.assert_awaited_once_with("sess1", "__pending__:s3", await_step.id)


def test_create_task_execute_never_touches_mail_waits():
    """Only kind='await_reply' means a wait was possibly minted for this
    step — an ordinary follow-up task has nothing to rebind."""
    rm = MagicMock(upsert_steps=AsyncMock(), set_step_status=AsyncMock(),
                   rebind_mail_wait=AsyncMock())
    service = svc.OrchestratorService(MagicMock(), rm, planner_model="m")
    plan = Plan(id="p", title="t", goal="g",
               steps=[Step(id="s3", kind="execute", description="handle the reply")])
    name_to_step = {"s3": "s3"}
    tool = service._create_task_tool_for("sess1", "u1", plan, _fn_factory_holder(), name_to_step, "s3")

    tool_context = MagicMock()
    tool_context.run_node = AsyncMock(return_value="done")
    asyncio.run(tool.func("Run a quick check.", kind="execute", tool_context=tool_context))

    rm.rebind_mail_wait.assert_not_awaited()


def test_create_task_and_delegate_share_siblings_instead_of_chaining():
    """Both tools grow the SAME plan mid-turn (see _build_workflow, which
    passes them one shared siblings set) -- a create_task call and a
    delegate_to_human_agent call from the same caller must land as
    parallel siblings, not get sequentialized, exactly like two
    delegate_to_human_agent calls already must (see the sibling test
    above) -- otherwise a persona using both tools together regresses
    the wave-chaining bug that fix originally solved."""
    rm = MagicMock(upsert_steps=AsyncMock(), set_step_status=AsyncMock(),
                   rebind_mail_wait=AsyncMock())
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


def test_create_task_does_not_chain_onto_an_already_blocked_step_from_an_earlier_turn():
    """`siblings` is a FRESH set() every _build_workflow call (i.e. every
    turn) — it only protects steps spawned in THIS same LLM tool-call burst.
    A dynamic step created on an EARLIER turn, already parked on its own
    external reply, is not part of this burst and must not retroactively
    gain a dependency on a brand new, unrelated step just because it shares
    the same caller and isn't in the (empty, since this is a new turn)
    siblings set. Live example: a step already holding a real reply
    (status=BLOCKED, its own separate mail wait, matched and everything) got
    wired to depend on a second, completely unrelated await_reply created on
    a later resume — corrupting its dependency graph even though its answer
    had already arrived."""
    rm = MagicMock(upsert_steps=AsyncMock(), set_step_status=AsyncMock(),
                   rebind_mail_wait=AsyncMock())
    service = svc.OrchestratorService(MagicMock(), rm, planner_model="m")
    plan = Plan(id="p", title="t", goal="g", steps=[
        Step(id="s1", kind="execute", description="persona step", is_persona=True,
            assignee="hamdi", assignee_name="Hamdi Imed"),
        # Spawned on an EARLIER turn, already parked on its own reply --
        # simulates crossing a resume boundary, where this turn's siblings
        # set starts fresh and empty even though this step still exists.
        Step(id="earlier-wait", kind="await_reply", depends_on=["s1"],
            status=Status.BLOCKED, is_dynamic_delegate=True),
    ])
    scheduler.assign_waves(plan)

    name_to_step = {"s1": "s1", "earlier-wait": "earlier-wait"}
    siblings: set = set()  # fresh, as it would be on a new _build_workflow call
    task_tool = service._create_task_tool_for("sess1", "u1", plan, _fn_factory_holder(),
                                              name_to_step, "s1", siblings)

    tool_context = MagicMock()
    tool_context.run_node = AsyncMock(return_value="ok")
    asyncio.run(task_tool.func("Email someone else and wait.", kind="await_reply",
                               tool_context=tool_context))

    earlier = plan.step("earlier-wait")
    assert earlier.depends_on == ["s1"], (
        "an already-blocked step from an earlier turn must not be retroactively "
        "chained onto a brand new, unrelated dynamic step")


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

    rm = MagicMock(upsert_steps=AsyncMock(), set_step_status=AsyncMock(),
                   rebind_mail_wait=AsyncMock())
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

    rm = MagicMock(upsert_steps=AsyncMock(), set_step_status=AsyncMock(),
                   rebind_mail_wait=AsyncMock())
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


def test_delegating_never_blocks_the_caller_on_the_delegate(monkeypatch):
    """The caller must never be left showing "blocked" on the plan card.

    This used to be a real hazard: the caller was flipped to blocked for the
    duration of a nested delegate run, so any failure in there could strand
    it. Now the delegate is simply a scheduled step and the caller ends its
    own turn, so the caller is never blocked at all — the hazard is gone by
    construction rather than by an unwind path."""
    monkeypatch.setattr(svc.human_agents, "search_human_agents", AsyncMock(
        return_value=[{"id": "oussama", "name": "Oussama", "role": "Investment approver"}]))
    rm = MagicMock(upsert_steps=AsyncMock(), set_step_status=AsyncMock(),
                   rebind_mail_wait=AsyncMock())
    service = svc.OrchestratorService(MagicMock(), rm, planner_model="m")
    plan = Plan(id="p", steps=[
        Step(id="s2", kind="execute", description="ask", is_persona=True,
             assignee="rabeb", assignee_name="Rabeb"),
    ])
    tool = service._delegate_tool_for("sess1", "u1", plan, _fn_factory_holder(), {}, "s2")

    tool_context = MagicMock()
    tool_context.run_node = AsyncMock(side_effect=AssertionError("must not run nested"))

    result = asyncio.run(tool.func("Oussama", "task", tool_context=tool_context))

    assert "Oussama" in result
    tool_context.run_node.assert_not_awaited()
    caller_calls = [c for c in rm.set_step_status.call_args_list if c.args[1] == "s2"]
    assert [c.args[2] for c in caller_calls] == []
    assert plan.step("s2").status is not Status.BLOCKED
    assert plan.step("s2").blocked_reason is None


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


# --- end-to-end: a persona's create_task(kind='await_reply') across a real
# turn boundary, on the real ADK engine (no mocked run_node/tool_context) ---

def test_persona_create_task_await_reply_survives_a_real_turn_boundary():
    """The actual bug this whole mechanism exists for: a persona's own tool
    call cannot stay alive across a turn boundary (a real email reply can
    take hours or days) — so nothing was ever positioned to use the reply
    once it arrived, and the persona's turn-1 placeholder ("draft sent,
    awaiting reply") silently became the plan's permanent final answer. Live
    example: session 4fe2162b307d411d875a2aed918702db — Hamdi's reply
    correctly landed in the await_reply step's own .result, but nothing
    ever produced a real recommendation from it.

    Drives the REAL _build_workflow/_drive/_finalize/resume_turn (not
    mocked) through two actual turns on the real ADK engine, with a
    scripted LLM standing in for the model. Confirms the follow-up step
    create_task now spawns alongside the await_reply step is what reads the
    reply and gives the real answer — not a resumption of the persona's own
    turn-1 tool call, which structurally can't happen."""
    from pydantic import PrivateAttr
    from google.adk.models import BaseLlm
    from google.adk.models.llm_response import LlmResponse
    from google.adk.runners import Runner
    from google.adk.sessions import InMemorySessionService
    from google.genai import types
    import unittest.mock as mock
    from src.companion_ai import nodes as nodes_mod

    class _ScriptedLlm(BaseLlm):
        _n: int = PrivateAttr(default=0)

        def __init__(self):
            super().__init__(model="fake")
            object.__setattr__(self, "_n", 0)

        async def generate_content_async(self, llm_request, stream=False):
            object.__setattr__(self, "_n", self._n + 1)
            n = self._n
            instr = llm_request.config.system_instruction or ""
            is_followup = "Give the real final answer" in instr
            seen_reply = any(
                "APPROVED THE PILOT" in (getattr(p, "text", "") or "")
                for c in llm_request.contents for p in (c.parts or []))
            if is_followup:
                yield LlmResponse(content=types.Content(role="model", parts=[
                    types.Part(text=f"REAL FINAL ANSWER — reply seen: {seen_reply}")]))
                return
            if n == 1:
                yield LlmResponse(content=types.Content(role="model", parts=[
                    types.Part(function_call=types.FunctionCall(
                        name="create_task",
                        args={"description": "Give the real final answer once Hamdi "
                                              "replies, using exactly what he decided.",
                              "kind": "await_reply"},
                        id="call_1"))
                ]))
                return
            yield LlmResponse(content=types.Content(role="model", parts=[
                types.Part(text="Draft sent to Hamdi, awaiting his reply.")]))

    session_id = "sess1"
    plan = Plan(id="p", title="t", goal="g", executor_id="exec1", executor_name="Worky executor",
               steps=[Step(id="s1", kind="execute", is_persona=True,
                          assignee="hamdi", assignee_name="Hamdi Imed",
                          description="Should we migrate?")])

    rm = MagicMock()
    rm.upsert_steps = AsyncMock(); rm.set_step_status = AsyncMock()
    rm.upsert_plan = AsyncMock(); rm.cancel_mail_waits = AsyncMock()
    rm.bind_mail_wait_interrupt = AsyncMock(); rm.set_waiting = AsyncMock()
    rm.set_session_status = AsyncMock(); rm.add_message = AsyncMock()
    rm.rebind_mail_wait = AsyncMock(); rm.register_mail_wait = AsyncMock()
    rm.mail_token_for = AsyncMock(return_value=None)
    rm.snapshot = AsyncMock(); rm.outstanding_interrupts = AsyncMock()

    session_service = InMemorySessionService()

    def runner_factory(node, app_name):
        return Runner(app_name=app_name, agent=node, session_service=session_service)

    scripted = _ScriptedLlm()
    with mock.patch.object(nodes_mod, "build_llm", lambda *a, **k: scripted):
        service = svc.OrchestratorService(runner_factory, rm, planner_model="m")

        # TURN 1: s1 sends its draft, calls create_task(kind='await_reply'),
        # ends its own turn with a placeholder — this part already worked.
        wf, n2s = service._build_workflow(session_id, "u1", plan, "fake", None, None)
        runner1 = runner_factory(wf, f"orch_{session_id}")
        asyncio.run(session_service.create_session(
            app_name=f"orch_{session_id}", user_id="u1", session_id=session_id))
        interrupts = asyncio.run(service._drive(
            runner1, session_id, "u1", plan, n2s,
            types.Content(role="user", parts=[types.Part(text="go")])))
        asyncio.run(service._finalize(session_id, plan, interrupts))

        await_step = next(s for s in plan.steps if s.kind == "await_reply")
        followup_step = next(s for s in plan.steps if s.depends_on == [await_step.id])
        assert followup_step.is_persona is True
        assert followup_step.assignee_name == "Hamdi Imed"
        assert await_step.status is Status.BLOCKED
        # s1 itself must NOT have fabricated a decision — this is the exact
        # false-completion failure mode that made the bug hard to see.
        assert "REAL FINAL ANSWER" not in (plan.step("s1").result or "")

        # TURN 2: the reply arrives. resume_turn (real, unmocked) must get
        # the FOLLOW-UP step — not s1 — to actually read it and answer.
        # The real interrupt id from turn 1 (not reconstructed) — its
        # "n_" node-name prefix is conditional on the step id's first
        # character (see graph.node_name), so guessing it is unreliable.
        interrupt_id = next(iid for iid, step_id in interrupts if step_id == await_step.id)

        def step_row(s):
            return {"step_id": s.id, "description": s.description, "kind": s.kind,
                    "question": s.question, "status": s.status.value, "wave": s.wave,
                    "depends_on": ",".join(s.depends_on), "result": s.result,
                    "assignee": s.assignee, "assignee_name": s.assignee_name,
                    "assignee_role": s.assignee_role, "is_persona": s.is_persona,
                    "is_dynamic_delegate": s.is_dynamic_delegate}

        rm.snapshot.return_value = {
            "session": {"id": session_id, "status": "blocked", "interrupt_id": None},
            "plan": {"id": plan.id, "title": plan.title, "goal": plan.goal, "status": "blocked",
                    "executor_id": plan.executor_id, "executor_name": plan.executor_name},
            "steps": [step_row(s) for s in plan.steps],
        }
        rm.outstanding_interrupts.return_value = [(interrupt_id, await_step.id)]

        plan2 = asyncio.run(service.resume_turn(
            session_id=session_id, user_id="u1",
            answer="Hamdi says: APPROVED THE PILOT.", model="fake",
            interrupt_id=interrupt_id))

        followup_final = plan2.step(followup_step.id)
        assert followup_final.status is Status.COMPLETED
        assert followup_final.result == "REAL FINAL ANSWER — reply seen: True"
