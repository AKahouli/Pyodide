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
        upsert_plan=AsyncMock(), upsert_steps=AsyncMock(), add_message=AsyncMock(),
        outstanding_interrupts=AsyncMock(return_value=[]),
        register_mail_wait=AsyncMock(), cancel_mail_waits=AsyncMock(),
        bind_mail_wait_interrupt=AsyncMock())
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


# --- the wait lifecycle: minted at projection, bound at park ----------------

def test_the_token_is_minted_before_any_mail_could_be_sent():
    """It cannot be minted when the step parks: by then the send step has run and
    the mail is gone. Projection is the last moment before that."""
    svc, rm = _service()
    asyncio.run(svc._project_plan("s1", _plan(), "u1"))

    rm.register_mail_wait.assert_awaited_once()
    kw = rm.register_mail_wait.await_args.kwargs
    assert (kw["session_id"], kw["step_id"], kw["user_id"]) == ("s1", "m", "u1")
    assert rm.register_mail_wait.await_args.args[0].startswith("YW-")
    # Unbound: there is no interrupt to resume until the step actually parks.
    assert kw.get("interrupt_id") is None
    # Only the await_reply step gets one — not the ask step.
    assert rm.register_mail_wait.await_count == 1


def test_a_new_plan_drops_the_previous_plans_waits():
    """A reply to a superseded plan's mail has nowhere to go, and leaving the
    wait open holds a mailbox subscription for work nobody is doing."""
    svc, rm = _service()
    asyncio.run(svc._project_plan("s1", _plan(), "u1"))
    rm.cancel_mail_waits.assert_awaited_once_with("s1")


def test_a_plan_with_no_await_step_registers_nothing():
    svc, rm = _service()
    plan = Plan(id="p", title="t", goal="g", steps=[Step(id="a", kind="execute")])
    asyncio.run(svc._project_plan("s1", plan, "u1"))
    rm.register_mail_wait.assert_not_awaited()


def test_parking_binds_the_interrupt_so_the_wait_becomes_deliverable():
    svc, rm = _service()
    interrupts = [("mail:plan@1/m@1", "m")]
    rm.outstanding_interrupts.return_value = interrupts
    asyncio.run(svc._finalize("s1", _plan(), interrupts))
    rm.bind_mail_wait_interrupt.assert_awaited_once_with("s1", "m", "mail:plan@1/m@1")


def test_an_ask_step_parking_binds_no_mail_wait():
    svc, rm = _service()
    interrupts = [("ask:plan@1/q@1", "q")]
    rm.outstanding_interrupts.return_value = interrupts
    asyncio.run(svc._finalize("s1", _plan(), interrupts))
    rm.bind_mail_wait_interrupt.assert_not_awaited()


# --- stamping the token into the outbound mail ------------------------------

def _fake_send_tool(sent: list):
    """A stand-in for the microsoft365 send_email tool as create_connector_tools
    builds it: a SearchToolADK whose func is named `{slug}_send_email` and whose
    signature comes from the connector's parameterSchema."""
    import inspect
    from src.smart_rag.tools.search.tools import SearchToolADK

    async def _connector_tool(**kwargs):
        sent.append(kwargs)
        return "sent"

    _connector_tool.__name__ = "microsoft365_send_email"
    params = [inspect.Parameter(n, inspect.Parameter.KEYWORD_ONLY, default=None)
              for n in ("to_recipients", "subject", "body")]
    _connector_tool.__signature__ = inspect.Signature(params)
    _connector_tool.__annotations__ = {}
    return SearchToolADK(_connector_tool, {"function": {"name": "microsoft365_send_email",
                                                        "description": "Send an email.",
                                                        "parameters": {}}})


def test_the_send_tool_stamps_the_token_the_executor_never_sees():
    sent = []
    tool = _fake_send_tool(sent)
    token = "YW-abcdefghijklmnop12"
    wrapped = nodes.stamp_send_email_tool(tool, token_provider=AsyncMock(return_value=token))

    asyncio.run(wrapped.func(to_recipients=["r@example.com"],
                             subject="Which company?", body="<p>Hi</p>"))

    assert len(sent) == 1
    # Both carriers stamped, and the real tool got the stamped values.
    assert sent[0]["subject"] == f"Which company? [{token}]"
    assert token in sent[0]["body"] and "display:none" in sent[0]["body"]
    assert sent[0]["to_recipients"] == ["r@example.com"]
    # Transparent to the executor: same name, so the model sees the tool the
    # connector published.
    assert wrapped.func.__name__ == "microsoft365_send_email"


def test_a_send_with_no_token_still_sends():
    """Better a mail that lands unroutable than a step that refuses to run."""
    sent = []
    wrapped = nodes.stamp_send_email_tool(_fake_send_tool(sent),
                                          token_provider=AsyncMock(return_value=None))
    asyncio.run(wrapped.func(to_recipients=["r@example.com"], subject="Q", body="<p>Hi</p>"))
    assert sent[0]["subject"] == "Q", "nothing to stamp, nothing stamped"


def test_only_the_send_step_feeding_a_wait_gets_a_stamped_tool():
    svc, rm = _service()
    rm.mail_token_for = AsyncMock(return_value="YW-abcdefghijklmnop12")
    plan = Plan(id="p", title="t", goal="g", steps=[
        Step(id="send", kind="execute", description="email her"),
        Step(id="other", kind="execute", description="unrelated work"),
        Step(id="wait", kind="await_reply", question="awaiting", depends_on=["send"]),
    ])
    tools_for_step = svc._mail_stamping("s1", plan)
    base = [_fake_send_tool([])]

    # The step whose mail is awaited: wrapped.
    assert tools_for_step(plan.step("send"), base)[0] is not base[0]
    # An unrelated step keeps the connector's own tool, even though it could send.
    assert tools_for_step(plan.step("other"), base)[0] is base[0]


def test_a_plan_with_no_wait_builds_ordinary_tools():
    svc, _ = _service()
    plan = Plan(id="p", title="t", goal="g", steps=[Step(id="a", kind="execute")])
    assert svc._mail_stamping("s1", plan) is None


def test_only_send_email_is_recognised_among_a_connectors_tools():
    """A connector publishes ~19 actions; only send_email may be stamped."""
    import inspect
    from src.smart_rag.tools.search.tools import SearchToolADK

    def _tool(name):
        async def f(**kw):
            return None
        f.__name__ = name
        f.__signature__ = inspect.Signature([])
        f.__annotations__ = {}
        return SearchToolADK(f, {"function": {"name": name, "description": "", "parameters": {}}})

    assert nodes.is_send_email_tool(_tool("microsoft365_send_email"))
    for other in ("microsoft365_send_teams_message", "microsoft365_search_documents",
                  "microsoft365_create_meeting", "linkup_linkup_search"):
        assert not nodes.is_send_email_tool(_tool(other)), other


if __name__ == "__main__":
    test_await_reply_parks_then_resumes_with_the_reply_body()
    test_only_a_chat_answerable_interrupt_is_an_ask()
    test_the_node_factory_builds_await_reply_from_the_step_kind()
    test_a_mail_wait_never_becomes_the_sessions_chat_interrupt()
    test_an_ask_alongside_a_mail_wait_is_the_one_the_chat_answers()
    test_a_plan_parked_only_on_mail_does_not_complete()
    test_the_token_is_minted_before_any_mail_could_be_sent()
    test_a_new_plan_drops_the_previous_plans_waits()
    test_a_plan_with_no_await_step_registers_nothing()
    test_parking_binds_the_interrupt_so_the_wait_becomes_deliverable()
    test_an_ask_step_parking_binds_no_mail_wait()
    print("ok")
