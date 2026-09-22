"""Unit tests for OrchestratorService pure helpers (no ADK/DB/LLM)."""
import asyncio
import json
import os
import sys
from unittest.mock import AsyncMock, MagicMock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import pytest

from src.companion_ai import scheduler, service as svc
from src.companion_ai.plan import Plan, Status, Step


@pytest.mark.asyncio
async def test_add_message_projects_active_turn_id():
    rm = MagicMock(add_message=AsyncMock())
    service = svc.OrchestratorService(MagicMock(), rm, planner_model="m")
    token = svc.active_turn_id.set("turn-1")
    try:
        await service._add_message("session-1", "assistant", "done")
    finally:
        svc.active_turn_id.reset(token)

    args = rm.add_message.await_args.args
    assert args[1:] == ("session-1", "assistant", "done", "turn-1")


@pytest.mark.asyncio
async def test_add_message_propagates_projection_failure():
    rm = MagicMock(add_message=AsyncMock(side_effect=RuntimeError("database unavailable")))
    service = svc.OrchestratorService(MagicMock(), rm, planner_model="m")

    with pytest.raises(RuntimeError, match="database unavailable"):
        await service._add_message("session-1", "assistant", "done")


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
    # Step ids are namespaced with plan.id (_namespace_step_ids): the planner
    # emits s1/s2 on every turn and one session is reused across turns, so bare
    # ids collided with an earlier turn's rows in the read-model — the per-plan
    # prefix makes them turn-unique. depends_on is remapped to match.
    assert [s.id for s in plan.steps] == [f"{plan.id}_s1", f"{plan.id}_s2"]
    assert plan.steps[1].depends_on == [f"{plan.id}_s1"]
    assert plan.steps[1].assignee_name == "Rabeb"
    assert plan.steps[1].assignee == "rabeb"


def test_make_plan_survives_a_flaky_planner_duplicate_blank_and_dangling_deps(monkeypatch):
    """A planner (seen live with glm-5.3-go) can emit a step twice, a blank id, a
    self-dep, or a dep on a step it never wrote. Any of these makes
    scheduler.validate raise and aborts the whole turn — nothing projected, the
    session hangs 'running'. _make_plan must drop the offenders and yield a valid
    plan instead."""
    from pydantic import PrivateAttr
    from google.adk.models import BaseLlm
    from google.adk.models.llm_response import LlmResponse
    from google.adk.runners import Runner
    from google.adk.sessions import InMemorySessionService
    from google.genai import types as genai_types

    class _ScriptedLlm(BaseLlm):
        _resp: object = PrivateAttr()

        def __init__(self, resp):
            super().__init__(model="fake")
            object.__setattr__(self, "_resp", resp)

        async def generate_content_async(self, llm_request, stream=False):
            yield self._resp

    plan_json = {
        "title": "messy", "goal": "g", "answer": "", "steps": [
            {"id": "s1", "kind": "execute", "title": "A", "description": "d", "depends_on": []},
            {"id": "s2", "kind": "execute", "title": "B", "description": "d", "depends_on": ["s1"]},
            {"id": "s2", "kind": "execute", "title": "B-dupe", "description": "d", "depends_on": ["s1"]},
            {"id": "", "kind": "execute", "title": "blank", "description": "d", "depends_on": []},
            {"id": "s3", "kind": "execute", "title": "C", "description": "d",
             "depends_on": ["s1", "s3", "ghost"]},   # self-dep + dangling
        ],
    }
    resp = LlmResponse(content=genai_types.Content(role="model", parts=[
        genai_types.Part(function_call=genai_types.FunctionCall(
            name="set_model_response", args=plan_json, id="c1"))]))
    monkeypatch.setattr(svc.nodes, "build_llm", lambda *a, **k: _ScriptedLlm(resp))

    session_service = InMemorySessionService()
    service = svc.OrchestratorService(
        lambda node, app_name: Runner(node=node, app_name=app_name, session_service=session_service),
        None, planner_model="fake")
    plan = asyncio.run(service._make_plan("sess1", "u1", "do messy things"))

    # duplicate s2 and blank id dropped → 3 unique steps, all namespaced
    assert [s.id for s in plan.steps] == [f"{plan.id}_s1", f"{plan.id}_s2", f"{plan.id}_s3"]
    # self-dep (s3) and dangling ("ghost") pruned; the real dep on s1 survives
    s3 = plan.steps[2]
    assert s3.depends_on == [f"{plan.id}_s1"]
    # and the whole thing is now a valid DAG the orchestrator won't choke on
    scheduler.validate(plan)      # must not raise
    scheduler.assign_waves(plan)


def test_dep_results_context_injects_only_completed_direct_dependencies():
    """A downstream step is handed the results of the COMPLETED steps it directly
    depends_on — not pending ones, not the whole plan, not transitive results.
    (Fixes: depends_on was ordering-only, so a step ran blind to upstream output.)"""
    s1 = Step(id="a", title="Search", description="d", status=Status.COMPLETED, result="FOUND=42")
    s2 = Step(id="b", title="Pending", description="d", status=Status.PENDING, result="not yet")
    s3 = Step(id="c", title="Use", description="d", depends_on=["a", "b"])
    plan = Plan(steps=[s1, s2, s3])
    ctx = svc.OrchestratorService._dep_results_context(plan)

    assert ctx(s1) is None                      # no deps → nothing injected
    out = ctx(s3)
    assert out and "FOUND=42" in out            # completed dep's result is injected
    assert "Search" in out                      # labelled by the dep's title
    assert "not yet" not in out                 # a pending dep is excluded

    # direct-only: a step depending on c (not yet completed) sees nothing —
    # a's result does not reach it transitively through c.
    s4 = Step(id="e", depends_on=["c"])
    plan.steps.append(s4)
    assert svc.OrchestratorService._dep_results_context(plan)(s4) is None


def test_plan_turn_fails_the_session_on_an_empty_planner_response():
    """A broken/empty planner output (0 steps AND empty answer — seen live with
    glm-5.3-go returning {steps:[], answer:"", ops:[...]} for a real task) must
    NOT silently 'complete': retry the planner once, and if it's still empty, FAIL
    the session with a message naming the cause."""
    rm = MagicMock(ensure_session=AsyncMock(), add_message=AsyncMock(),
                   set_session_status=AsyncMock())
    service = svc.OrchestratorService(MagicMock(), rm, planner_model="m")

    calls = {"n": 0}
    async def empty_plan(*a, **k):
        calls["n"] += 1
        return Plan(id="p", title="", goal="", answer="", steps=[])
    service._make_plan = empty_plan

    posted = {}
    async def capture_err(session_id, content, title="x"):
        posted["content"] = content
    service._add_error_message = capture_err

    asyncio.run(service.plan_turn(session_id="s", user_id="u", message="search X and email Y", model="m"))

    assert calls["n"] == 2, f"planner should be retried once (got {calls['n']} calls)"
    assert (posted.get("content") or "").strip(), "must post an ERROR naming the cause"
    rm.set_session_status.assert_awaited_with("s", "failed")   # fail, not complete


def test_fail_session_surfaces_a_planner_error_and_fails_a_running_session():
    """A planner LLM error (e.g. RateLimitError) raises OUTSIDE the drive, so the
    session is left 'running' with nothing shown — fail_session must post the
    cause as a chat error and mark the session failed."""
    rm = MagicMock(snapshot=AsyncMock(return_value={"session": {"status": "running"}}),
                   add_message=AsyncMock(), add_message_component=AsyncMock(),
                   set_session_status=AsyncMock())
    service = svc.OrchestratorService(MagicMock(), rm, planner_model="m")

    asyncio.run(service.fail_session("s", RuntimeError("Weekly usage limit reached")))

    rm.add_message.assert_awaited()  # the error message was posted
    rm.add_message_component.assert_awaited()  # ...as an error component
    rm.set_session_status.assert_awaited_with("s", "failed")


def test_fail_session_is_idempotent_when_the_drive_already_failed():
    """A drive-phase error already went through _fail_turn (session='failed' +
    message posted); the top-level net must NOT post a duplicate."""
    rm = MagicMock(snapshot=AsyncMock(return_value={"session": {"status": "failed"}}),
                   add_message=AsyncMock(), add_message_component=AsyncMock(),
                   set_session_status=AsyncMock())
    service = svc.OrchestratorService(MagicMock(), rm, planner_model="m")

    asyncio.run(service.fail_session("s", RuntimeError("boom")))

    rm.add_message.assert_not_awaited()
    rm.set_session_status.assert_not_awaited()


def test_plan_turn_keeps_a_genuine_direct_reply_completed():
    """The empty-plan guard must NOT fire on a real CASE A reply: 0 steps but a
    non-empty answer is chit-chat — complete it, don't fail it or retry."""
    rm = MagicMock(ensure_session=AsyncMock(), add_message=AsyncMock(),
                   set_session_status=AsyncMock())
    service = svc.OrchestratorService(MagicMock(), rm, planner_model="m")

    calls = {"n": 0}
    async def direct_reply(*a, **k):
        calls["n"] += 1
        return Plan(id="p", title="", goal="", answer="Bonjour ! Comment puis-je aider ?", steps=[])
    service._make_plan = direct_reply
    service._add_message = AsyncMock()

    asyncio.run(service.plan_turn(session_id="s", user_id="u", message="salut", model="m"))

    assert calls["n"] == 1, "a real direct reply must NOT trigger a retry"
    rm.set_session_status.assert_awaited_with("s", "completed")
def _planner_service(monkeypatch, responses):
    class FakeRunner:
        def __init__(self):
            self.session_service = MagicMock(
                get_session=AsyncMock(return_value=object()),
                create_session=AsyncMock(),
            )
            self.messages = []

        async def run_async(self, **kwargs):
            self.messages.append(kwargs["new_message"].parts[0].text)
            event = MagicMock()
            event.content.parts = [MagicMock(text=json.dumps(responses[len(self.messages) - 1]))]
            yield event

    runner = FakeRunner()
    monkeypatch.setattr(svc.nodes, "build_llm", lambda *a, **k: "fake")
    return svc.OrchestratorService(lambda node, app_name: runner, None, planner_model="fake"), runner


def test_make_plan_drops_duplicate_ids_and_keeps_the_plan(monkeypatch):
    # A flaky planner can emit the same id twice. Rather than retry or abort the
    # turn, _make_plan drops the duplicate and keeps the plan (ids namespaced by
    # plan.id downstream). One planner call, no correction round-trip.
    invalid = {"title": "t", "steps": [
        {"id": "s1", "description": "first"},
        {"id": "s1", "description": "second", "depends_on": ["s1"]},
    ]}
    service, runner = _planner_service(monkeypatch, [invalid])

    plan = asyncio.run(service._make_plan("sess", "user", "do work"))

    assert len(plan.steps) == 1
    assert plan.steps[0].id.endswith("s1")
    assert len(runner.messages) == 1


def test_make_plan_drops_blank_ids_and_keeps_the_plan(monkeypatch):
    # The sibling case: a blank id is dropped the same way, no retry, no raise.
    data = {"title": "t", "steps": [{"id": "s1"}, {"id": ""}]}
    service, runner = _planner_service(monkeypatch, [data])

    plan = asyncio.run(service._make_plan("sess", "user", "do work"))

    assert len(plan.steps) == 1
    assert plan.steps[0].id.endswith("s1")
    assert len(runner.messages) == 1


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


def test_resume_turn_resumes_a_dynamic_await_reply_step_normally_not_out_of_band():
    """A create_task(kind='await_reply') step now parks as a real TOP-LEVEL node
    (create_task no longer runs it as a nested ctx.run_node), so its node path
    and interrupt id are reproducible and it resumes through hitl.resume_part
    exactly like a planner-emitted await. The old out-of-band shortcut — mark the
    step completed and replay it as a stored-result node — is GONE: with a
    top-level node it swapped the recorded park events for a stored-result node
    and diverged ADK's replay barrier on the await's own sequence key (seen live:
    session 188cbdbe, 'Replay divergence … c593f1e04dfa@1'). This guards against
    re-introducing it: a dynamic await must NOT be force-completed at resume; the
    drive (via resume_part) completes it, same as any top-level await."""
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
             "is_dynamic_delegate": True, "interrupt_id": "mail:plan_s1@1/n1@1"},
        ],
    })
    rm.outstanding_interrupts = AsyncMock(return_value=[("mail:plan_s1@1/n1@1", "n1")])
    rm.set_step_status = AsyncMock()

    service = svc.OrchestratorService(lambda node, app_name: session, rm, planner_model="m")
    service._build_workflow = MagicMock(return_value=(MagicMock(), {}))
    service._drive = AsyncMock(return_value=[])
    service._finalize = AsyncMock()

    asyncio.run(service.resume_turn(
        session_id="s1", user_id="u1", answer="Go ahead, migrate.", model="m",
        interrupt_id="mail:plan_s1@1/n1@1"))

    # NOT force-completed out-of-band — no set_step_status(..., 'completed') before
    # the drive; the drive resolves it like any top-level await.
    for call in rm.set_step_status.await_args_list:
        assert not (call.args[1] == "n1" and call.args[2] == "completed"), \
            "dynamic await must not be force-completed out-of-band"
    # Driven with a real resume_part (function_response), keyed on the await's own
    # (reproducible, top-level) interrupt id.
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


def test_every_step_gets_the_same_toolset():
    """EXECUTOR_INSTRUCTION promises each step that every other step has the
    SAME tools it does, and orders any step sending a reply-critical mail to
    register an await_reply. Gating that toolset guessed upfront which steps
    would need to grow the plan and guessed wrong both ways: session
    7752a273b2054d4d921d9514eb933d85 -- a memo step caught a discrepancy in a
    reply with no way to act on it; session 6a76057bba4d75a63944128d -- a step
    was told to call create_task and answered "there is no create_task tool in
    my available toolset". A reply can name work no planner saw, so which step
    needs to delegate is not knowable at build time."""
    service = svc.OrchestratorService(MagicMock(), None, planner_model="m")
    plan = Plan(id="p", steps=[
        Step(id="s3", kind="await_reply", question="Awaiting a reply"),
        Step(id="s4", kind="execute", description="write the memo", depends_on=["s3"]),
        Step(id="s5", kind="execute", description="unrelated step"),
    ])
    wf, _ = service._build_workflow("sess1", "u1", plan, "x", None, None)
    nodes_by_name = {n.name: n for n in wf.graph.nodes}

    def tool_names(node):
        return {getattr(getattr(t, "func", None), "__name__", "?") for t in getattr(node, "tools", [])}

    expected = {"find_human_agents", "delegate_to_human_agent", "create_task"}
    assert expected <= tool_names(nodes_by_name["s4"])
    assert expected <= tool_names(nodes_by_name["s5"])


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
            contents_text = "\n".join(
                getattr(p, "text", "") or ""
                for c in llm_request.contents for p in (c.parts or []))
            # The step's task now rides in the user turn, not system_instruction
            # (see nodes._inject_task_turn) — look in both so the scripted model
            # still recognizes the follow-up step.
            is_followup = ("Give the real final answer" in instr
                           or "Give the real final answer" in contents_text)
            seen_reply = "APPROVED THE PILOT" in contents_text
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
        # _drive_loop, not raw _drive: create_task(await_reply) now leaves the
        # wait PENDING as a top-level step (never nested — nesting diverges ADK's
        # replay barrier), so it runs on this turn's rebuild inside _drive_loop —
        # the real production turn-1 path (_drive_until_quiescent → _drive_loop).
        interrupts = asyncio.run(service._drive_loop(
            runner1, session_id, "u1", plan, n2s,
            types.Content(role="user", parts=[types.Part(text="go")]),
            model="fake", connectors=None, executor_prompt=None))
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


def test_mixed_planner_await_and_create_task_await_no_stuck_step_no_divergence():
    """The live regression (session d3635052 / 8cf41ed8): a MIXED plan holding a
    planner-emitted await_reply (parks in pass 1) AND a persona step that spawns
    a create_task(await_reply). Running the spawned await needs a _drive_loop
    rebuild; that rebuild used to re-run the already-parked planner await under a
    SHIFTED node-path id — orphaning its mail wait and leaving it stuck RUNNING —
    and the nested-run design diverged ADK's replay barrier on the resume.

    Fix under test: the runtime await is a TOP-LEVEL step (never nested), and a
    blocked ask/await re-parks under its STORED interrupt id (fixed_iid). Asserts
    turn 1 parks both awaits with no stuck step and one stable id, and the resume
    runs the follow-up with the reply WITHOUT divergence or disturbing the other
    await."""
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
        def __init__(self): super().__init__(model="fake"); object.__setattr__(self, "_n", 0)
        async def generate_content_async(self, llm_request, stream=False):
            object.__setattr__(self, "_n", self._n + 1)
            txt = "\n".join((p.text or "") for c in llm_request.contents
                            for p in (c.parts or []) if getattr(p, "text", None))
            if "Give the real final answer" in txt:
                yield LlmResponse(content=types.Content(role="model",
                    parts=[types.Part(text="ACTED ON REPLY")])); return
            if self._n == 1:
                yield LlmResponse(content=types.Content(role="model", parts=[types.Part(
                    function_call=types.FunctionCall(name="create_task",
                        args={"description": "Give the real final answer once X replies.",
                              "kind": "await_reply"}, id="call_1"))])); return
            yield LlmResponse(content=types.Content(role="model",
                parts=[types.Part(text="Draft sent, awaiting reply.")]))

    session_id = "sessMIX"
    plan = Plan(id="p", title="t", goal="g", executor_id="exec1", executor_name="Worky executor", steps=[
        Step(id="s1", kind="execute", is_persona=True, assignee="hamdi", assignee_name="Hamdi",
             description="Ask Hamdi"),
        Step(id="s2", kind="await_reply", description="Await the collaboration reply", depends_on=[])])

    binds = []
    rm = MagicMock()
    for m in ("upsert_steps", "set_step_status", "upsert_plan", "cancel_mail_waits", "set_waiting",
              "set_session_status", "add_message", "rebind_mail_wait", "register_mail_wait",
              "snapshot", "outstanding_interrupts"):
        setattr(rm, m, AsyncMock())
    rm.mail_token_for = AsyncMock(return_value=None)
    rm.bind_mail_wait_interrupt = AsyncMock(side_effect=lambda sid, step_id, iid: binds.append((step_id, iid)))
    rm.outstanding_interrupts.return_value = []

    ss = InMemorySessionService()
    def runner_factory(node, app_name): return Runner(app_name=app_name, agent=node, session_service=ss)
    scripted = _ScriptedLlm()
    with mock.patch.object(nodes_mod, "build_llm", lambda *a, **k: scripted):
        service = svc.OrchestratorService(runner_factory, rm, planner_model="m")
        wf, n2s = service._build_workflow(session_id, "u1", plan, "fake", None, None)
        runner1 = runner_factory(wf, f"orch_{session_id}")
        asyncio.run(ss.create_session(app_name=f"orch_{session_id}", user_id="u1", session_id=session_id))
        interrupts = asyncio.run(service._drive_loop(
            runner1, session_id, "u1", plan, n2s,
            types.Content(role="user", parts=[types.Part(text="go")]),
            model="fake", connectors=None, executor_prompt=None))
        rm.outstanding_interrupts.return_value = list(interrupts)
        asyncio.run(service._finalize(session_id, plan, interrupts))

        s2 = plan.step("s2")
        spawned = next(s for s in plan.steps if s.kind == "await_reply" and s.is_dynamic_delegate)
        act = next(s for s in plan.steps if "final answer" in (s.description or "").lower())
        assert not [s.id for s in plan.steps if s.status == Status.RUNNING], "a step is stuck RUNNING"
        assert s2.status is Status.BLOCKED and spawned.status is Status.BLOCKED
        assert len({iid for sid, iid in binds if sid == "s2"}) == 1, "planner await id not stable"
        # BOTH awaits must be bound — _drive_loop returns the union of interrupts
        # across passes, so a step that parked before the rebuild isn't dropped
        # (the d624d1df stuck-'running', unbound-wait bug).
        bound = {sid for sid, _ in binds}
        assert "s2" in bound and spawned.id in bound, f"an await was not bound: {bound}"

        def row(s):
            return {"step_id": s.id, "description": s.description, "kind": s.kind, "question": s.question,
                    "status": s.status.value, "wave": s.wave, "depends_on": ",".join(s.depends_on),
                    "result": s.result, "assignee": s.assignee, "assignee_name": s.assignee_name,
                    "assignee_role": s.assignee_role, "is_persona": s.is_persona,
                    "is_dynamic_delegate": s.is_dynamic_delegate, "interrupt_id": s.interrupt_id}
        rm.snapshot.return_value = {
            "session": {"id": session_id, "status": "blocked", "interrupt_id": None},
            "plan": {"id": plan.id, "title": plan.title, "goal": plan.goal, "status": "blocked",
                     "executor_id": plan.executor_id, "executor_name": plan.executor_name},
            "steps": [row(s) for s in plan.steps]}
        rm.outstanding_interrupts.return_value = [(s2.interrupt_id, s2.id),
                                                  (spawned.interrupt_id, spawned.id)]
        plan2 = asyncio.run(service.resume_turn(session_id=session_id, user_id="u1",
                            answer="X says: APPROVED.", model="fake",
                            interrupt_id=spawned.interrupt_id))
        assert plan2.step(act.id).status is Status.COMPLETED, "follow-up (act) step didn't run"
        assert plan2.step("s2").status is Status.BLOCKED, "resume disturbed the other await"


def test_resume_targets_the_card_questionId_across_parallel_gates(monkeypatch):
    """Two confirm gates open at once (session 33dfebfa live bug): the session's
    single interrupt id made every approval hit whichever gate it pointed at, so
    a second card's approval landed on the first card's gate and mis-applied its
    edits. resume_turn must answer the gate the CARD names (its questionId), and
    if it has to fall back to a different gate, it must DROP the edits."""
    import unittest.mock as mock
    from google.genai import types
    gateA, gateB = "confirm::adk-AAAA", "confirm::adk-BBBB"

    rm = MagicMock()
    rm.snapshot = AsyncMock(return_value={
        "session": {"id": "s", "status": "waiting", "interrupt_id": gateA},  # default = A
        "plan": {"id": "p", "title": "t", "goal": "g", "status": "blocked",
                 "executor_id": "e", "executor_name": "E"},
        "steps": [
            {"step_id": "sA", "kind": "execute", "status": "blocked", "depends_on": "",
             "description": "email rabeb", "interrupt_id": gateA, "is_persona": False},
            {"step_id": "sB", "kind": "execute", "status": "blocked", "depends_on": "",
             "description": "email firas", "interrupt_id": gateB, "is_persona": True}]})
    rm.outstanding_interrupts = AsyncMock(return_value=[(gateA, "sA"), (gateB, "sB")])
    for m in ("set_step_status", "upsert_plan", "set_session_status", "add_message",
              "cancel_mail_waits", "bind_mail_wait_interrupt", "set_waiting"):
        setattr(rm, m, AsyncMock())

    service = svc.OrchestratorService(MagicMock(), rm, planner_model="m")
    monkeypatch.setattr(svc, "_ensure_session", AsyncMock())
    monkeypatch.setattr(service, "_build_workflow", lambda *a, **k: (MagicMock(), {}))
    captured = {}
    async def fake_drive(runner, session_id, user_id, plan, n2s, new_message, **kw):
        fr = new_message.parts[0].function_response
        captured["fc_id"] = fr.id
        captured["payload"] = (fr.response or {}).get("payload")
        return []
    monkeypatch.setattr(service, "_drive_until_quiescent", fake_drive)
    monkeypatch.setattr(service, "_finalize", AsyncMock())

    # Approve gate B (Firas) with its own questionId + edits. Must target B, not A.
    answer = '{"verdict":"approve","questionId":"confirm::adk-BBBB","edits":{"subject":"x"}}'
    asyncio.run(service.resume_turn(session_id="s", user_id="u", answer=answer, model="fake"))
    assert captured["fc_id"] == "adk-BBBB", f"answered the wrong gate: {captured['fc_id']}"
    assert captured["payload"] == {"subject": "x"}, "edits should ride to the targeted gate"

    # Now B's id has drifted (no longer outstanding); the approval must fall back
    # to A but DROP B's edits (never apply one send's edits to another).
    rm.outstanding_interrupts = AsyncMock(return_value=[(gateA, "sA")])
    captured.clear()
    asyncio.run(service.resume_turn(session_id="s", user_id="u", answer=answer, model="fake"))
    assert captured["fc_id"] == "adk-AAAA", "should fall back to the only outstanding gate"
    assert captured["payload"] is None, "edits for a gone gate must be dropped, not applied to A"


async def test_inject_steps_appends_to_live_plan_with_fresh_ids():
    """converse_turn amends a running plan by appending the planner's steps to
    the live Plan object; the drive loop then runs them (same path create_task
    uses). Fresh ids so they can't collide with running steps; the batch's own
    depends_on is remapped to those ids; the executor is stamped."""
    rm = MagicMock(upsert_steps=AsyncMock(), register_mail_wait=AsyncMock())
    service = svc.OrchestratorService(MagicMock(), rm, planner_model="m")
    live = Plan(id="p", title="t", goal="g", executor_id="exec1", executor_name="Worky",
                steps=[Step(id="s1", kind="execute", description="orig", status=Status.RUNNING)])
    new = [Step(id="s1", kind="execute", description="added A", depends_on=[]),
           Step(id="s2", kind="execute", description="added B", depends_on=["s1"])]

    n = await service._inject_steps("sess", "u", live, new)

    assert n == 2 and len(live.steps) == 3
    added = live.steps[1:]
    assert all(s.id != "s1" for s in added)              # no collision with the running step
    # A batch-root hangs off the frontier (the existing s1) so it lands in a NEW
    # wave — not wave 0 alongside the completed step, which would re-run it.
    assert added[0].depends_on == ["s1"]
    assert added[1].depends_on == [added[0].id]          # internal dep remapped
    assert all(s.assignee == "exec1" for s in added)     # executor stamped
    assert all(s.status is Status.PENDING for s in added)
    rm.upsert_steps.assert_awaited()                     # projected so the card grows
    rm.register_mail_wait.assert_not_awaited()           # no await_reply in this batch


async def test_inject_steps_registers_a_mail_wait_for_injected_await_reply():
    """An await_reply step ADDED by an amend must get its own routing token, or
    the reply it waits on can never match and the step hangs forever (seen live:
    session 1e8d0f72 — 'Attendre Firas' blocked with an empty mail_waits)."""
    rm = MagicMock(upsert_steps=AsyncMock(), register_mail_wait=AsyncMock(),
                   cancel_mail_waits=AsyncMock())
    service = svc.OrchestratorService(MagicMock(), rm, planner_model="m")
    live = Plan(id="p", title="t", executor_id="e", executor_name="W",
                steps=[Step(id="s1", kind="execute", status=Status.RUNNING)])
    new = [Step(id="w", kind="await_reply", description="wait for the reply")]

    await service._inject_steps("sess", "u", live, new)

    rm.register_mail_wait.assert_awaited_once()          # token minted for the new wait
    rm.cancel_mail_waits.assert_not_awaited()            # existing waits NOT dropped
    _, kw = rm.register_mail_wait.await_args
    assert kw["session_id"] == "sess" and kw["step_id"] == live.steps[-1].id


async def test_inject_steps_rejects_duplicate_ids_before_mutating_live_plan():
    rm = MagicMock(upsert_steps=AsyncMock(), register_mail_wait=AsyncMock())
    service = svc.OrchestratorService(MagicMock(), rm, planner_model="m")
    original = Step(id="s1", kind="execute", status=Status.RUNNING, wave=3)
    live = Plan(id="p", executor_id="e", executor_name="W", steps=[original])
    new = [Step(id="n", description="first"), Step(id="n", description="second")]

    with pytest.raises(ValueError, match="duplicate step ids"):
        await service._inject_steps("sess", "u", live, new)

    assert live.steps == [original]
    assert original.wave == 3
    rm.upsert_steps.assert_not_awaited()
    rm.register_mail_wait.assert_not_awaited()


async def test_apply_ops_cancel_persists_status_via_set_step_status():
    """A cancel op must persist through set_step_status — upsert_steps (what
    _project_step uses) does NOT touch `status` on conflict, so projecting a
    cancel that way leaves the read-model row 'pending' while memory says
    canceled (seen live: session e9adde, s2 stuck 'pending')."""
    rm = MagicMock(set_step_status=AsyncMock(), upsert_steps=AsyncMock())
    service = svc.OrchestratorService(MagicMock(), rm, planner_model="m")
    live = Plan(id="p", steps=[Step(id="s2", kind="execute", title="Transmettre",
                                    status=Status.PENDING)])

    notes = await service._apply_ops("sess", live, [{"op": "cancel", "step_id": "s2"}])

    assert live.step("s2").status is Status.CANCELLED
    rm.set_step_status.assert_awaited_once_with("sess", "s2", "canceled")
    assert any("cancelled" in n for n in notes)


async def test_apply_ops_refuses_a_non_pending_step():
    """Only a still-pending step can be safely amended; a running/completed one
    is already in ADK's replay history."""
    rm = MagicMock(set_step_status=AsyncMock(), upsert_steps=AsyncMock())
    service = svc.OrchestratorService(MagicMock(), rm, planner_model="m")
    live = Plan(id="p", steps=[Step(id="s1", kind="execute", title="Analyser",
                                    status=Status.COMPLETED, result="done")])

    notes = await service._apply_ops("sess", live, [{"op": "cancel", "step_id": "s1"}])

    assert live.step("s1").status is Status.COMPLETED          # untouched
    rm.set_step_status.assert_not_awaited()
    assert any("already completed" in n for n in notes)


def test_amend_message_embeds_plan_results_as_context():
    """CASE C: the amend planner is given the running plan AND its results, so it
    can paste an existing result into a new step ('email the summary') instead of
    asking the user what the summary is."""
    live = Plan(id="p", title="t", goal="g", steps=[
        Step(id="s1", kind="execute", title="Search Bitcoin",
             status=Status.COMPLETED, result="BTC is ~$63,000"),
        Step(id="s2", kind="execute", title="Summarize", status=Status.RUNNING),
    ])
    msg = svc.OrchestratorService._amend_message(live, "email that to Firas")
    assert "AMENDING" in msg                     # framed as an amend, not a fresh plan
    assert "BTC is ~$63,000" in msg              # the result is embedded for reuse
    assert "email that to Firas" in msg          # the user's request is carried
    assert "[s1]" in msg and "[s2]" in msg       # existing steps listed as done


async def test_drive_registers_live_plan_for_converse():
    """_drive_until_quiescent must expose the live plan in self._active while the
    drive loop runs (so converse_turn can reach it), and clear it after."""
    service = svc.OrchestratorService(MagicMock(), None, planner_model="m")
    plan = Plan(id="p", title="t", goal="g", steps=[])

    seen = {}

    async def fake_loop(*a, **k):
        seen["active"] = service._active.get("sess") is plan
        return []

    service._drive_loop = fake_loop
    await service._drive_until_quiescent(
        None, "sess", "u", plan, {}, None,
        model="m", connectors=None, executor_prompt=None)
    assert seen["active"] is True                         # live during the loop
    assert "sess" not in service._active                  # cleared after


def test_create_task_after_builds_a_join_not_just_a_fan_out():
    """A reply can ask for two things AND for something once both are in --
    "search new MCPs + search the new ADK version, then tell me what we can
    implement". Without `after` every spawned step hangs off the caller alone,
    so the third one runs in PARALLEL with the searches and reads nothing:
    only a fan-out is expressible. `after` lets the model name the siblings to
    wait for, which is what makes the spawned shape a real graph."""
    rm = MagicMock(upsert_steps=AsyncMock(), set_step_status=AsyncMock(),
                   rebind_mail_wait=AsyncMock())
    service = svc.OrchestratorService(MagicMock(), rm, planner_model="m")
    plan = Plan(id="p", title="t", goal="g", steps=[
        Step(id="act", kind="execute", description="act on Firas's reply"),
    ])
    tool = service._create_task_tool_for(
        "sess1", "u1", plan, _fn_factory_holder(), {"act": "act"}, "act")
    ctx = MagicMock()

    async def run():
        await tool.func("Search the market for new MCPs", tool_context=ctx)
        await tool.func("Search for the new Google ADK agents version", tool_context=ctx)
        a, b = plan.steps[1].id, plan.steps[2].id
        await tool.func("Recommend what to implement from both searches",
                        after=[a, b], tool_context=ctx)
        return a, b
    a, b = asyncio.run(run())

    search_a, search_b, join = plan.steps[1], plan.steps[2], plan.steps[3]
    # The two searches stay parallel -- neither waits on the other.
    assert search_a.depends_on == ["act"] and search_b.depends_on == ["act"]
    assert search_a.wave == search_b.wave
    # The join waits for both, so it runs strictly after them.
    assert set(join.depends_on) == {"act", a, b}
    assert join.wave > search_a.wave
    # Cycle guard: the steps it waits on must NOT be made to wait on it.
    assert join.id not in search_a.depends_on and join.id not in search_b.depends_on


def test_create_task_after_ignores_ids_that_are_not_real_steps():
    """A hallucinated id must not fail the whole call -- dropping it loses only
    the ordering, where raising would lose the step itself."""
    rm = MagicMock(upsert_steps=AsyncMock(), set_step_status=AsyncMock(),
                   rebind_mail_wait=AsyncMock())
    service = svc.OrchestratorService(MagicMock(), rm, planner_model="m")
    plan = Plan(id="p", title="t", goal="g", steps=[
        Step(id="act", kind="execute", description="act on the reply"),
    ])
    tool = service._create_task_tool_for(
        "sess1", "u1", plan, _fn_factory_holder(), {"act": "act"}, "act")

    result = asyncio.run(tool.func("Do the thing", after=["nope", "act"],
                                   tool_context=MagicMock()))

    assert "created" in result.lower()
    # "nope" dropped; "act" is the caller and already there, never duplicated.
    assert plan.steps[1].depends_on == ["act"]


def test_create_task_await_reply_is_refused_when_no_mail_was_ever_sent():
    """A wait whose token was never minted can never be claimed by an arriving
    reply, so the step parks on an interrupt nothing can resume and the plan
    blocks forever. Seen live in session 681a01cfcd014e80a851f2b33e2b823e: the
    model created the wait ALONGSIDE the step meant to send the mail instead of
    after it, so nothing had been sent at this moment; rebind_mail_wait missed
    silently and the session was stuck permanently. Refusing lets the model fix
    it inside the same turn."""
    rm = MagicMock(upsert_steps=AsyncMock(), set_step_status=AsyncMock(),
                   rebind_mail_wait=AsyncMock(return_value=0),
                   mail_token_for=AsyncMock(return_value=None))
    service = svc.OrchestratorService(MagicMock(), rm, planner_model="m")
    plan = Plan(id="p", title="t", goal="g", steps=[
        Step(id="act", kind="execute", description="act on the reply"),
    ])
    tool = service._create_task_tool_for(
        "sess1", "u1", plan, _fn_factory_holder(), {"act": "act"}, "act")

    result = asyncio.run(tool.func("Wait for Firas's next answer", kind="await_reply",
                                   tool_context=MagicMock()))

    assert "no email has been sent yet" in result.lower(), result
    assert "after=" in result, "must tell the model how to order it correctly"
    # Nothing half-created: no orphan step left behind in the plan.
    assert len(plan.steps) == 1


def test_create_task_await_reply_still_works_when_the_mail_did_go_out():
    """The guard must only catch the never-sent case -- a caller that really did
    send its mail rebinds one row and proceeds to build the wait plus its
    follow-up step."""
    rm = MagicMock(upsert_steps=AsyncMock(), set_step_status=AsyncMock(),
                   rebind_mail_wait=AsyncMock(return_value=1),
                   mail_token_for=AsyncMock(return_value=None))
    service = svc.OrchestratorService(MagicMock(), rm, planner_model="m")
    plan = Plan(id="p", title="t", goal="g", steps=[
        Step(id="act", kind="execute", description="email Firas"),
    ])
    tool = service._create_task_tool_for(
        "sess1", "u1", plan, _fn_factory_holder(), {"act": "act"}, "act")
    ctx = MagicMock(); ctx.run_node = AsyncMock()

    result = asyncio.run(tool.func("Wait for Firas's answer", kind="await_reply",
                                   tool_context=ctx))

    assert "await-reply step created" in result.lower(), result
    kinds = [s.kind for s in plan.steps]
    assert kinds == ["execute", "await_reply", "execute"]  # + the "Act on reply" follow-up


def test_the_act_on_reply_step_is_told_the_reply_already_arrived():
    """The follow-up must NOT inherit the wait's own wording. `description` is
    written as the WAIT's instruction ("wait for and read X's reply"), so
    reusing it verbatim tells the step that runs AFTER the reply to wait all
    over again. Seen live in session a936b31bf70246349a7df1463486020a: that step
    had Firas's reply in context, read its task as "wait for a reply", called
    create_task(kind='await_reply') again, and on refusal sent Firas a DUPLICATE
    of the original email."""
    rm = MagicMock(upsert_steps=AsyncMock(), set_step_status=AsyncMock(),
                   rebind_mail_wait=AsyncMock(return_value=1),
                   mail_token_for=AsyncMock(return_value=None))
    service = svc.OrchestratorService(MagicMock(), rm, planner_model="m")
    plan = Plan(id="p", title="t", goal="g", steps=[
        Step(id="act", kind="execute", description="email Firas"),
    ])
    tool = service._create_task_tool_for(
        "sess1", "u1", plan, _fn_factory_holder(), {"act": "act"}, "act")
    ctx = MagicMock(); ctx.run_node = AsyncMock()
    wait_wording = "Wait for and read Firas Kahia's email reply about new features"

    asyncio.run(tool.func(wait_wording, kind="await_reply", tool_context=ctx))

    wait_step, followup = plan.steps[1], plan.steps[2]
    # The wait itself still carries the caller's own wording.
    assert wait_step.description == wait_wording
    # The follow-up states the arrival as fact BEFORE that wording...
    assert followup.description.startswith("The reply you were waiting for HAS ALREADY ARRIVED")
    # ...forbids the two things that produced the duplicate email...
    low = followup.description.lower()
    assert "do not send another email" in low and "do not register another wait" in low
    # ...and still carries the caller's instruction for what to do with it.
    assert wait_wording in followup.description


def test_the_await_reply_refusal_points_at_acting_before_re_sending():
    """The refusal must not read as "just send the mail". In session
    a936b31bf70246349a7df1463486020a the model took exactly that advice and
    re-sent a question Firas had already answered, so checking for a reply
    already in hand has to come FIRST."""
    rm = MagicMock(upsert_steps=AsyncMock(), set_step_status=AsyncMock(),
                   rebind_mail_wait=AsyncMock(return_value=0),
                   mail_token_for=AsyncMock(return_value=None))
    service = svc.OrchestratorService(MagicMock(), rm, planner_model="m")
    plan = Plan(id="p", title="t", goal="g",
                steps=[Step(id="act", kind="execute", description="act on the reply")])
    tool = service._create_task_tool_for(
        "sess1", "u1", plan, _fn_factory_holder(), {"act": "act"}, "act")

    msg = asyncio.run(tool.func("Wait for his answer", kind="await_reply",
                                tool_context=MagicMock())).lower()

    assert "do not email anyone again" in msg
    # The "act on it" branch must be offered ahead of the "send it yourself" one.
    assert msg.index("act") < msg.index("send it yourself")


def test_a_step_result_keeps_the_answer_not_the_models_reasoning():
    """A reasoning model emits its thinking as an earlier content part and the
    answer as a later one, so taking parts[0] stored the deliberation as the
    step's result -- and that result becomes the next step's context. Seen live
    in session 3c6f49bdf4a7445c8f00f6bf57b1405c, where a completed step's result
    read 'The user says "run the plan." My task instruction is...' instead of
    its answer."""
    rm = MagicMock(upsert_steps=AsyncMock(), set_step_status=AsyncMock())
    service = svc.OrchestratorService(MagicMock(), rm, planner_model="m")
    plan = Plan(id="p", title="t", goal="g",
                steps=[Step(id="s1", kind="execute", description="answer the question")])

    ev = MagicMock()
    ev.node_info = MagicMock(path="s1", output_for=["s1"])
    ev.content.parts = [
        MagicMock(text="Let me think. The user says 'run the plan'. Hmm, maybe..."),
        MagicMock(text="No new features to implement."),
    ]
    ev.get_function_calls.return_value = []
    ev.get_function_responses.return_value = []
    ev.long_running_tool_ids = None
    ev.error_message = None   # a successful event carries no error
    ev.error_code = None
    ev.actions = MagicMock(state_delta={})

    asyncio.run(service._apply_event("sess1", plan, ev, {"s1": "s1"}, set()))

    assert plan.step("s1").result == "No new features to implement."
    assert "Let me think" not in (plan.step("s1").result or "")


def test_a_step_producing_several_files_records_every_one():
    """One tool call can return many files (the interpreter returns
    generated_files[]), and a step can call such a tool more than once. Each
    file becomes its own row so the client can list them all against the step
    that produced them."""
    recorded = []

    async def add_step_artifact(session_id, step_id, **artifact):
        recorded.append((session_id, step_id, artifact))

    rm = MagicMock(add_step_artifact=add_step_artifact)
    service = svc.OrchestratorService(MagicMock(), rm, planner_model="m")
    step = Step(id="s1", kind="execute", description="build the report")

    async def code_interpreter_shell_exec(**kwargs):
        return {"generated_files": [
            {"ceph_path": "ceph/a/chart.png", "path": "/home/ubuntu/chart.png"},
            {"ceph_path": "ceph/a/data.csv", "path": "/home/ubuntu/data.csv"},
        ]}

    tool = MagicMock(func=code_interpreter_shell_exec, custom_schema={})
    code_interpreter_shell_exec.__signature__ = None
    wrapped = service._capture_artifacts("sess1", step, [tool])[0]
    asyncio.run(wrapped.func())

    assert [a["filename"] for _, _, a in recorded] == ["chart.png", "data.csv"]
    assert [a["artifact_kind"] for _, _, a in recorded] == ["image", "data"]
    assert {(s, st) for s, st, _ in recorded} == {("sess1", "s1")}
    assert [a["file_path"] for _, _, a in recorded] == ["ceph/a/chart.png", "ceph/a/data.csv"]


def test_a_single_file_result_is_captured_and_a_fileless_one_is_not():
    """send_file_to_user returns the path on the result itself, not in a list.
    Every other tool call returns no file at all and must produce no row."""
    from src.companion_ai import nodes as n

    single = n.artifacts_from_tool_result(
        {"ceph_path": "ceph/x/report.pdf", "path": "/home/ubuntu/report.pdf"})
    assert len(single) == 1
    assert single[0]["filename"] == "report.pdf"
    assert single[0]["artifact_kind"] == "document"

    for fileless in ({"status": "ok"}, {"ceph_path": ""}, "just a string", None, {}):
        assert n.artifacts_from_tool_result(fileless) == [], fileless


def test_a_projection_failure_never_fails_the_tool_call():
    """The file exists whether or not the row lands. Losing a step's real work
    because a read-model write failed is the worse trade."""
    from src.companion_ai import nodes as n

    async def boom(_artifact):
        raise RuntimeError("read model down")

    async def original(**kwargs):
        return {"ceph_path": "ceph/x/report.pdf", "path": "/report.pdf"}

    original.__signature__ = None
    wrapped = n.capture_artifacts_tool(
        MagicMock(func=original, custom_schema={}), on_artifact=boom)

    assert asyncio.run(wrapped.func()) == {"ceph_path": "ceph/x/report.pdf",
                                           "path": "/report.pdf"}


def test_requester_context_names_the_user_and_forbids_delegating_to_them():
    """The planner/executor preamble must name the requester and rule out
    emailing or delegating work back to them — the fix for worky not knowing who
    it works for. It must also forbid messaging them on ANY channel (Teams too,
    not just email) and require relaying results back in the reply, not as an
    outbound message — a Teams message to the requester is a self-chat that fails
    (session f261efd3)."""
    ctx = svc.requester_context(
        {"name": "Rabeb Sdiri", "email": "rabeb@yellowsys.fr", "role": "Data Scientist"})
    assert "Rabeb Sdiri" in ctx and "rabeb@yellowsys.fr" in ctx and "Data Scientist" in ctx
    low = ctx.lower()
    assert "never" in low and ("delegat" in low or "assign" in low) and "email" in low
    assert "teams" in low                              # not just email
    assert "ask" in low                                # ask-step for input
    assert "reply" in low or "result" in low           # relay results back, not send them


def test_requester_context_is_empty_without_a_name_or_email():
    """No identity -> no preamble, so behaviour is unchanged for older clients."""
    assert svc.requester_context(None) == ""
    assert svc.requester_context({"name": "", "email": "", "role": "x"}) == ""
    # email alone is enough to name someone
    assert "a@b.fr" in svc.requester_context({"email": "a@b.fr"})


def test_with_requester_appends_but_preserves_the_base_prompt():
    assert svc._with_requester("BASE", None) == "BASE"
    out = svc._with_requester("BASE", {"name": "R", "email": "r@x.fr"})
    assert out.startswith("BASE\n\n") and "r@x.fr" in out
    # no base prompt -> just the context
    assert svc._with_requester(None, {"email": "r@x.fr"}).startswith("You are working for")


async def test_concurrent_amends_on_one_session_are_serialized():
    """Two 'update the plan' messages racing on the same session must NOT plan
    concurrently: the per-session lock serializes them so the second plans
    against the first's already-applied steps, not the same stale snapshot.
    Without the lock both would enter _make_plan at once (max_concurrent == 2)."""
    rm = MagicMock(upsert_steps=AsyncMock(), set_step_status=AsyncMock(),
                   register_mail_wait=AsyncMock())
    service = svc.OrchestratorService(MagicMock(), rm, planner_model="m")
    live = Plan(id="p", title="t", executor_id="e", executor_name="W",
                steps=[Step(id="s1", kind="execute", status=Status.RUNNING)])
    service._active["sess"] = live
    service._add_message = AsyncMock()

    inside = 0
    max_concurrent = 0
    seen_steps_at_plan = []

    async def fake_make_plan(session_id, user_id, message, **kw):
        nonlocal inside, max_concurrent
        inside += 1
        max_concurrent = max(max_concurrent, inside)
        # how many steps the live plan already has when THIS amend plans
        seen_steps_at_plan.append(len(service._active["sess"].steps))
        await asyncio.sleep(0)            # yield: a second coroutine runs here if unlocked
        await asyncio.sleep(0)
        inside -= 1
        return Plan(id="x", steps=[Step(id="n", kind="execute", description="added")])

    service._make_plan = fake_make_plan

    await asyncio.gather(
        service.converse_turn(session_id="sess", user_id="u", message="A"),
        service.converse_turn(session_id="sess", user_id="u", message="B"),
    )

    assert max_concurrent == 1                 # never overlapped -> serialized
    assert len(live.steps) == 3                # both amends applied (1 orig + 2 injected)
    # The second amend planned AFTER the first applied its step, so it saw a
    # bigger plan — proof it wasn't working from the same stale snapshot.
    assert seen_steps_at_plan == [1, 2]


def _schema_aware_planner_service(monkeypatch, *, schema_pass_fails):
    """A planner runner that knows whether the agent was built WITH output_schema.

    When schema_pass_fails, the structured pass raises (as a provider that can't
    do structured output would 400), so _make_plan must fall back to the
    schema-less prompt-mode pass. Both passes otherwise return the same valid plan
    JSON — the plan was always parsed from text, so prompt mode needs no schema.
    """
    _PLAN = {"title": "t", "goal": "g", "answer": "ok",
             "steps": [{"id": "s1", "kind": "execute", "title": "x",
                        "description": "do x", "depends_on": []}]}

    class SchemaAwareRunner:
        def __init__(self):
            self.session_service = MagicMock(
                get_session=AsyncMock(return_value=object()),
                create_session=AsyncMock(),
            )
            self.calls = []  # (had_output_schema, message_text)

        def bind(self, agent):
            self._agent = agent
            return self

        async def run_async(self, **kwargs):
            had_schema = getattr(self._agent, "output_schema", None) is not None
            self.calls.append((had_schema, kwargs["new_message"].parts[0].text))
            if had_schema and schema_pass_fails:
                raise RuntimeError("response_format not supported by this model")
            event = MagicMock()
            event.content.parts = [MagicMock(text=json.dumps(_PLAN))]
            yield event

    runner = SchemaAwareRunner()
    monkeypatch.setattr(svc.nodes, "build_llm", lambda *a, **k: "fake")
    return (svc.OrchestratorService(lambda node, app_name: runner.bind(node),
                                    None, planner_model="fake"),
            runner)


def test_make_plan_falls_back_to_prompt_mode_when_structured_output_unsupported(monkeypatch):
    # A model whose provider can't do structured output makes the schema pass
    # raise; _make_plan must retry schema-less (prompt mode) so the planner still
    # works on ANY model that can emit JSON — not only structured-output ones.
    service, runner = _schema_aware_planner_service(monkeypatch, schema_pass_fails=True)

    plan = asyncio.run(service._make_plan("sess", "user", "find bitcoin price"))

    assert [s.id.split("_")[-1] for s in plan.steps] == ["s1"]   # plan still built
    assert len(runner.calls) == 2                                # schema, then fallback
    assert runner.calls[0][0] is True                            # pass 0 had output_schema
    assert runner.calls[1][0] is False                           # fallback had none
    assert "strict JSON" in runner.calls[1][1]                   # contract restated in msg


def test_make_plan_uses_structured_output_and_does_not_fall_back_when_supported(monkeypatch):
    # A capable model succeeds on the structured pass: no fallback, one call —
    # unchanged from before the fallback was added (zero regression).
    service, runner = _schema_aware_planner_service(monkeypatch, schema_pass_fails=False)

    plan = asyncio.run(service._make_plan("sess", "user", "find bitcoin price"))

    assert len(plan.steps) == 1
    assert len(runner.calls) == 1
    assert runner.calls[0][0] is True                            # structured pass, no retry


def test_parse_verdict_plain_and_edit_on_card():
    # Plain-text verdicts still work.
    assert svc._parse_verdict("approve") == (True, None)
    assert svc._parse_verdict("Approuver") == (True, None)
    assert svc._parse_verdict("decline") == (False, None)
    assert svc._parse_verdict("no, change the subject") == (False, None)
    # Edit-on-card: JSON approval carries edits as the confirmation payload.
    ok, edits = svc._parse_verdict(
        '{"verdict":"approve","edits":{"subject":"URGENT","body":"new body"}}')
    assert ok is True and edits == {"subject": "URGENT", "body": "new body"}
    # Edits are dropped on a decline (nothing to send).
    assert svc._parse_verdict('{"verdict":"decline","edits":{"subject":"x"}}') == (False, None)
    # Malformed JSON degrades to a plain (non-approve) verdict, never raises.
    assert svc._parse_verdict('{"verdict":') == (False, None)


def test_mark_running_flips_pending_and_projects_at_model_start():
    # _mark_running (before_model_callback) marks a PENDING step RUNNING the
    # moment its request is sent to the model, and projects it — so the UI shows
    # in-progress at once instead of lagging until ADK's first event.
    step = Step(id="s1", kind="execute", description="do", status=Status.PENDING)
    seen = []
    async def on_start(s):
        seen.append((s.id, s.status))
    cb = svc.nodes._mark_running(step, on_start)
    asyncio.run(cb(object(), object()))
    assert step.status == Status.RUNNING
    assert seen == [("s1", Status.RUNNING)]


def test_mark_running_leaves_a_terminal_step_untouched():
    # A re-entered COMPLETED step is not flipped (so _trace_execution's re-run
    # diagnostic still fires) and is not re-projected.
    step = Step(id="s1", kind="execute", description="do", status=Status.COMPLETED)
    seen = []
    async def on_start(s):
        seen.append(s.id)
    cb = svc.nodes._mark_running(step, on_start)
    asyncio.run(cb(object(), object()))
    assert step.status == Status.COMPLETED
    assert seen == []


async def test_inject_steps_honors_planner_live_deps_and_parallelizes_independent(monkeypatch):
    """An amend's PLACEMENT is the planner's: a dep it names on a LIVE step is
    kept, and a step it leaves independent hangs off only the COMPLETED frontier
    so it runs parallel to an open branch instead of behind it (session c7b084e1:
    Imed got chained behind Adem's blocked reply)."""
    service = svc.OrchestratorService(MagicMock(), MagicMock(), planner_model="m")
    monkeypatch.setattr(service, "_project_step", AsyncMock())
    monkeypatch.setattr(service, "_mint_mail_waits", AsyncMock())

    live = Plan(steps=[
        Step(id="adem_send", description="ask Adem", status=Status.COMPLETED),
        Step(id="adem_wait", description="await Adem", depends_on=["adem_send"], status=Status.BLOCKED),
        Step(id="summary", description="summarize", status=Status.COMPLETED),
    ])
    new = [
        Step(id="s1", description="ask Imed", depends_on=[]),              # independent
        Step(id="s2", description="email the summary", depends_on=["summary"]),  # live dep
        Step(id="s3", description="notify after Imed", depends_on=["s1"]),       # in-batch dep
    ]
    await service._inject_steps("sess", "u", live, new)

    imed = next(s for s in live.steps if s.description == "ask Imed")
    mail = next(s for s in live.steps if s.description == "email the summary")
    notify = next(s for s in live.steps if s.description == "notify after Imed")

    # independent Imed -> completed leaf only (summary), NOT the blocked await
    assert imed.depends_on == ["summary"]
    assert "adem_wait" not in imed.depends_on
    # planner's dep on a LIVE step is honored, not discarded
    assert mail.depends_on == ["summary"]
    # in-batch dep still remapped to the new id
    assert notify.depends_on == [imed.id]
