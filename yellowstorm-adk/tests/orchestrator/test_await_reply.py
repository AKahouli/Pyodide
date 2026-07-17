"""await_reply — a step parked until an email reply arrives.

Same block-and-resume machinery as ask-the-user, with one difference that
carries all the weight: only an incoming reply may answer it, never the chat.
The interrupt id prefix (`mail:` vs `ask:`) is what keeps them apart, so a
session holding both routes a chat message to the question and leaves the mail
wait parked.

    <adk venv>/bin/python tests/orchestrator/test_await_reply.py
"""
import asyncio
import os
import sys
from unittest.mock import AsyncMock, MagicMock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from google.adk.runners import InMemoryRunner
from google.adk.workflow import START, Workflow
from google.genai import types

from src.companion_ai import graph, hitl, nodes
from src.companion_ai.plan import Plan, Status, Step
from src.companion_ai.service import OrchestratorService


# --- the node primitive, on the real ADK engine -----------------------------

async def _roundtrip():
    node = hitl.make_await_reply_node("await_reply", "Awaiting a reply from rabeb@example.com")
    wf = Workflow(name="mail_test", edges=[(START, node)])
    r = InMemoryRunner(node=wf, app_name="m")
    await r.session_service.create_session(app_name="m", user_id="u", session_id="s")

    ids = []
    async for ev in r.run_async(user_id="u", session_id="s",
            new_message=types.Content(role="user", parts=[types.Part(text="go")])):
        ids += hitl.interrupt_ids(ev)

    # The webhook resumes it out of band with the reply body — same shape as a
    # human answer, which is what makes the two paths one code path.
    state = {}
    reply = "I work at Yellow Systems."
    async for ev in r.run_async(user_id="u", session_id="s",
            new_message=types.Content(role="user", parts=[hitl.resume_part(ids[0], {"value": reply})])):
        if ev.actions and ev.actions.state_delta:
            state.update(dict(ev.actions.state_delta))
    return ids, state


def test_await_reply_parks_then_resumes_with_the_reply_body():
    ids, state = asyncio.run(_roundtrip())
    assert ids and ids[0].startswith("mail:"), ids
    assert state.get("await_reply") == "I work at Yellow Systems.", state


def test_only_a_chat_answerable_interrupt_is_an_ask():
    assert hitl.is_ask("ask:plan@1/a@1")
    assert not hitl.is_ask("mail:plan@1/a@1")


def test_the_node_factory_builds_await_reply_from_the_step_kind():
    factory = nodes.make_llm_node_factory(model_name="x", goal="g", tools=[])
    step = Step(id="a", kind="await_reply", question="Awaiting a reply")
    assert factory(step, "a").name == "a"


# --- the routing decision in _finalize --------------------------------------

def _service():
    rm = MagicMock(
        set_step_status=AsyncMock(), set_waiting=AsyncMock(), set_session_status=AsyncMock(),
        upsert_plan=AsyncMock(), add_message=AsyncMock(),
        outstanding_interrupts=AsyncMock(return_value=[]))
    svc = OrchestratorService(MagicMock(), rm, planner_model="m")
    return svc, rm


def _plan():
    return Plan(id="p", title="t", goal="g", steps=[
        Step(id="q", kind="ask", question="Which format?"),
        Step(id="m", kind="await_reply", question="Awaiting a reply"),
    ])


def test_a_mail_wait_never_becomes_the_sessions_chat_interrupt():
    """The heart of it: a chat reply is routed to sessions.interrupt_id, so a
    mail wait landing there would answer a step whose reply never arrived."""
    svc, rm = _service()
    interrupts = [("mail:plan@1/m@1", "m")]
    rm.outstanding_interrupts.return_value = interrupts
    asyncio.run(svc._finalize("s1", _plan(), interrupts))

    rm.set_waiting.assert_not_awaited()
    # Parked on the outside world, not on the owner.
    rm.set_session_status.assert_awaited_once_with("s1", "blocked")
    # And nothing is posted to the chat — there is no question for the owner.
    rm.add_message.assert_not_awaited()


def test_an_ask_alongside_a_mail_wait_is_the_one_the_chat_answers():
    svc, rm = _service()
    interrupts = [("mail:plan@1/m@1", "m"), ("ask:plan@1/q@1", "q")]
    rm.outstanding_interrupts.return_value = interrupts
    asyncio.run(svc._finalize("s1", _plan(), interrupts))

    rm.set_waiting.assert_awaited_once_with("s1", "ask:plan@1/q@1")
    reasons = {c.args[1]: c.kwargs["blocked_reason"] for c in rm.set_step_status.await_args_list}
    assert reasons == {"m": "awaiting email reply", "q": "awaiting user input"}, reasons


def test_a_plan_parked_only_on_mail_does_not_complete():
    """Without this the completion branch marks the waiting step completed and
    the plan answers itself with an empty reply."""
    svc, rm = _service()
    interrupts = [("mail:plan@1/m@1", "m")]
    rm.outstanding_interrupts.return_value = interrupts
    plan = _plan()
    asyncio.run(svc._finalize("s1", plan, interrupts))

    assert plan.status is Status.BLOCKED, plan.status
    assert plan.step("m").status is Status.BLOCKED


if __name__ == "__main__":
    test_await_reply_parks_then_resumes_with_the_reply_body()
    test_only_a_chat_answerable_interrupt_is_an_ask()
    test_the_node_factory_builds_await_reply_from_the_step_kind()
    test_a_mail_wait_never_becomes_the_sessions_chat_interrupt()
    test_an_ask_alongside_a_mail_wait_is_the_one_the_chat_answers()
    test_a_plan_parked_only_on_mail_does_not_complete()
    print("ok")
