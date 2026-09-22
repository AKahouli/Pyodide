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
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from google.adk.runners import InMemoryRunner
from google.adk.workflow import START, Workflow
from google.genai import types

from src.companion_ai import graph, hitl, mail_token, nodes
from src.companion_ai.plan import Plan, Status, Step
from src.companion_ai.service import OrchestratorService


def _task_turn(agent) -> str:
    """The task the injector delivers as the USER turn — it moved out of the
    system instruction (see nodes._inject_task_turn), replacing the plan's
    shared "run the plan" kickoff. Tests that used to look for the step's task
    in agent.instruction look here instead."""
    from types import SimpleNamespace as NS
    req = NS(contents=[NS(role="user", parts=[NS(
        text="run the plan", function_response=None, function_call=None)])])
    asyncio.run(agent.before_model_callback(callback_context=None, llm_request=req))
    return "\n".join(p.text for c in req.contents if c.role == "user"
                     for p in (c.parts or []) if getattr(p, "text", None))


# --- the node primitive, on the real ADK engine -----------------------------

async def _roundtrip():
    node = hitl.make_await_reply_node("await_reply", "Awaiting a reply from x@example.com")
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
    factory = nodes.make_llm_node_factory(model_name="x", tools=[])
    step = Step(id="a", kind="await_reply", question="Awaiting a reply")
    assert factory(step, "a").name == "a"


async def _run_single_node(node, name: str):
    wf = Workflow(name="single_node_test", edges=[(START, node)])
    r = InMemoryRunner(node=wf, app_name="t")
    await r.session_service.create_session(app_name="t", user_id="u", session_id="s")
    outputs = []
    async for ev in r.run_async(user_id="u", session_id="s",
            new_message=types.Content(role="user", parts=[types.Part(text="go")])):
        # _apply_event (service.py) reads a completed node's result from
        # ev.content.parts[0].text, not ev.output -- match that here, since a
        # bare-string return would (silently) never reach the read model.
        if ev.content and ev.content.parts and getattr(ev.content.parts[0], "text", None):
            outputs.append(ev.content.parts[0].text)
    return outputs


def test_a_completed_dynamic_delegate_step_replays_its_stored_result_instead_of_rerunning(monkeypatch):
    """delegate_to_human_agent's step runs its FIRST time inside a throwaway
    nested Workflow (service.py:_delegate_tool_for), at a node path ADK's own
    session replay can't match once resume_turn later rebuilds it as a plain
    top-level node -- so ADK can't tell it already ran and would silently
    re-call the LLM, producing a different answer and discarding the
    original (seen live: session e95815c5aded45b4bda9348fdb765c0d, where
    James's and Sarah's answers changed and shortened after a resume).
    nodes.py must short-circuit an already-completed one instead."""
    def _must_not_build_a_real_llm(*a, **k):
        raise AssertionError("an already-completed dynamic delegate must not re-call the LLM")
    monkeypatch.setattr(nodes, "build_llm", _must_not_build_a_real_llm)

    factory = nodes.make_llm_node_factory(model_name="x", tools=[])
    step = Step(id="f2c7bd13e74f", kind="execute", is_persona=True, is_dynamic_delegate=True,
                status=Status.COMPLETED, result="James's original second opinion.",
                assignee="james", assignee_name="James")

    node = factory(step, "f2c7bd13e74f")
    outputs = asyncio.run(_run_single_node(node, "f2c7bd13e74f"))

    assert outputs == ["James's original second opinion."]


def test_replay_completed_short_circuits_any_completed_step_without_rerunning(monkeypatch):
    """The continuation re-drive / continue_turn pass a plain 'run the plan'
    message, which ADK treats as a fresh invocation and re-runs the WHOLE graph
    (confirmed at the event level: session 1e8d0f72, a completed s1 re-ran its
    entire GitHub backlog pull on the second pass). With replay_completed=True,
    an already-COMPLETED plain step must emit its stored result and re-execute
    nothing — no LLM call at all."""
    def _must_not_build_a_real_llm(*a, **k):
        raise AssertionError("a completed step must not re-call the LLM on a re-drive")
    monkeypatch.setattr(nodes, "build_llm", _must_not_build_a_real_llm)

    factory = nodes.make_llm_node_factory(model_name="x", tools=[], replay_completed=True)
    step = Step(id="s1", kind="execute", status=Status.COMPLETED,
                result="## backlog summary (already produced)")

    node = factory(step, "s1")
    outputs = asyncio.run(_run_single_node(node, "s1"))
    assert outputs == ["## backlog summary (already produced)"]


def test_without_replay_completed_a_completed_step_is_still_a_live_llm_agent():
    """resume_turn must NOT set replay_completed — there ADK's resume_part
    genuinely replays completed nodes from history, and a FunctionNode swap
    would diverge from that recorded shape. So a completed step still builds a
    real LlmAgent (ADK, not us, decides not to re-invoke it)."""
    from google.adk.agents import LlmAgent
    factory = nodes.make_llm_node_factory(model_name="x", tools=[])  # replay_completed defaults False
    step = Step(id="s1", kind="execute", status=Status.COMPLETED, result="done")
    assert isinstance(factory(step, "s1"), LlmAgent)


def test_a_completed_dynamic_await_reply_step_replays_too_not_just_execute_ones():
    """The is_dynamic_delegate+COMPLETED short-circuit above must be checked
    BEFORE the kind=="await_reply" branch, not after it -- otherwise a
    create_task(kind='await_reply') step that resume_turn resolved
    out-of-band (marked COMPLETED with the real reply in .result, see
    service.py) still gets rebuilt as a bare hitl.make_await_reply_node
    regardless of its status, discarding that answer and re-parking under a
    brand new interrupt id nothing can ever deliver to again. Live example:
    session 9283fc115614466a8c207f7326c90ae8 -- Hamdi's reply was matched
    and applied to the step, yet the very next resume immediately re-parked
    it asking for the same reply again, because kind=="await_reply" was
    checked first and always won."""
    factory = nodes.make_llm_node_factory(model_name="x", tools=[])
    step = Step(id="b6772c4fe81c", kind="await_reply", is_dynamic_delegate=True,
                status=Status.COMPLETED, result="Go ahead with a pilot.")

    node = factory(step, "b6772c4fe81c")
    outputs = asyncio.run(_run_single_node(node, "b6772c4fe81c"))

    assert outputs == ["Go ahead with a pilot."]


def test_an_executor_never_sees_the_plan_wide_goal_or_another_steps_task():
    """Every executor shares one full toolset, so a step told the whole goal
    (and every other step's job) has both motive and means to reach for a tool
    that is not its own -- proven in production: search steps that read a goal
    mentioning "email Rabeb" sent their own unstamped copy alongside the real
    sender. Only the planner/orchestrator holds the whole plan; each step gets
    just its own description."""
    plan = Plan(id="p", title="t", goal="Email Rabeb, then research her employer", steps=[
        Step(id="a", kind="execute", description="Send an email to x@example.com."),
        Step(id="b", kind="execute", description="Search the web for Tesla news."),
    ])
    factory = nodes.make_llm_node_factory(model_name="x", tools=[])

    for step in plan.steps:
        agent = factory(step, step.id)
        rendered = agent.instruction + "\n" + _task_turn(agent)
        assert step.description in rendered
        assert plan.goal not in rendered
        other = next(s for s in plan.steps if s.id != step.id)
        assert other.description not in rendered


def test_a_client_prompts_literal_description_token_gets_substituted():
    """A client-supplied executor prompt may carry a literal "{description}"
    token (the documented convention — PROMPTS.txt: "leave it exactly as
    {description}, filled in by the server per step"). Left unresolved, ADK's
    own instruction templating treats it as a session-variable lookup and
    raises KeyError('Context variable not found: `description`') — seen live
    once the client's own prompt started actually being used."""
    step = Step(id="a", kind="execute", description="Search Bitcoin price.")
    factory = nodes.make_llm_node_factory(
        model_name="x", tools=[],
        custom_instruction="Do this step:\n{description}\nReturn concisely.")

    agent = factory(step, "a")

    # No unresolved token in what ADK templates (the system instruction) — that
    # was the KeyError. The task itself now rides in the user turn.
    assert "{description}" not in agent.instruction
    assert "{description}" not in _task_turn(agent)
    assert "Search Bitcoin price." in _task_turn(agent)


def test_a_persona_step_never_gets_a_competing_execution_agent_identity():
    """"You are an execution agent" right after "You are Rabeb." is two
    contradicting self-descriptions in one prompt. A persona step must not
    carry the generic identity line; a plain step still should."""
    factory = nodes.make_llm_node_factory(model_name="x", tools=[])

    persona_step = Step(id="a", kind="execute", description="Should we invest?",
                        is_persona=True, assignee_name="Rabeb", assignee_role="Investment analyst.")
    plain_step = Step(id="b", kind="execute", description="Search the web for Tesla news.")

    assert "You are an execution agent" not in factory(persona_step, "a").instruction
    assert "You are an assistant acting for Rabeb" in factory(persona_step, "a").instruction
    assert "You are an execution agent" in factory(plain_step, "b").instruction


def test_a_client_prompt_carrying_the_description_replaces_the_builtin_one():
    """Live bug: the configured executor prompt was a copy of
    EXECUTOR_INSTRUCTION, so it got stacked ON TOP of the built-in one and
    the step's task -- plus the whole "you are not told the plan's wider
    goal..." block -- was sent to the model TWICE, with contradictory framing
    between the two copies ("You are an execution agent" / "Do exactly this
    and nothing else" against the persona-aware "You are working on ONE
    step" / "using whatever consultation your role above requires").

    A prompt carrying {description} IS the executor instruction, so it must
    replace the built-in one, not duplicate it."""
    factory = nodes.make_llm_node_factory(
        model_name="x", tools=[],
        custom_instruction=nodes.EXECUTOR_INSTRUCTION.replace(
            "{identity}", "You are an execution agent working on ONE step of a larger plan.")
        .replace("{do_this_line}", "Do exactly this and nothing else:"))

    step = Step(id="a", kind="execute", description="Should we migrate to Databricks?",
                is_persona=True, assignee_name="Hamdi Imed", assignee_role="data lead")
    agent = factory(step, "a")
    instruction = agent.instruction

    # Task lives in the user turn exactly once; the built-in rules block appears
    # exactly once in system (replaced, not stacked).
    assert _task_turn(agent).count("Should we migrate to Databricks?") == 1
    assert instruction.count("Should we migrate to Databricks?") == 0
    assert instruction.count("You are not told the plan's wider goal") == 1
    assert "{description}" not in instruction


def test_a_client_prompt_without_the_description_still_prepends():
    """A prompt that cannot carry the task (no {description}) must stay an
    extra preamble ahead of the built-in instruction -- dropping the built-in
    one there would lose the task entirely."""
    factory = nodes.make_llm_node_factory(
        model_name="x", tools=[], custom_instruction="Always answer in French.")
    step = Step(id="a", kind="execute", description="Search the web for Tesla news.")
    agent = factory(step, "a")
    instruction = agent.instruction

    assert "Always answer in French." in instruction
    assert _task_turn(agent).count("Search the web for Tesla news.") == 1
    assert instruction.count("Search the web for Tesla news.") == 0
    assert "You are not told the plan's wider goal" in instruction


def test_a_delegate_step_is_told_to_relay_not_represent():
    """Regression: a delegate_to_human_agent-spawned step (is_persona AND
    is_dynamic_delegate) got the SAME "you represent {assignee_name} ...
    draft as if you were them, then get the real decision from
    {assignee_name} themselves" preamble as a top-level persona step. But a
    delegate's description is ALREADY the message addressed to
    assignee_name (e.g. "Hi Firas -- ... Do you confirm?"), not an open
    question needing an as-them draft -- telling the model it both IS Firas
    and must email Firas and await Firas's reply is self-referential, and a
    confirmed live trigger for the step stalling on repeated
    find_human_agents lookups instead of ever sending the email. A delegate
    step must be told to relay the question and wait, never to "represent"
    or "prepare a draft as they would"."""
    factory = nodes.make_llm_node_factory(model_name="x", tools=[])

    delegate_step = Step(id="a", kind="execute",
                         description="Hi Firas -- do you confirm this recommendation?",
                         is_persona=True, is_dynamic_delegate=True,
                         assignee_name="Firas Kahia", assignee_role="Team lead.")
    instruction = factory(delegate_step, "a").instruction

    assert "You represent Firas Kahia" not in instruction
    assert "PREPARE, not decide" not in instruction
    assert "Firas Kahia is being asked the question below directly" in instruction
    assert "get Firas Kahia's ACTUAL answer" in instruction


def test_a_persona_step_is_never_told_and_nothing_else():
    """"Do exactly this and nothing else" contradicts a persona's own mandate
    to consult others first. A persona step must be told consultation is
    part of "doing this"; a plain step keeps the original, stricter wording."""
    factory = nodes.make_llm_node_factory(model_name="x", tools=[])

    persona_step = Step(id="a", kind="execute", description="Should we invest?",
                        is_persona=True, assignee_name="Rabeb", assignee_role="Investment analyst.")
    plain_step = Step(id="b", kind="execute", description="Search the web for Tesla news.")

    # do_this_line rides in the task's user turn now, not the system instruction.
    assert "Do exactly this and nothing else:" not in _task_turn(factory(persona_step, "a"))
    assert "using whatever consultation your role above requires" in _task_turn(factory(persona_step, "a"))
    assert "Do exactly this and nothing else:" in _task_turn(factory(plain_step, "b"))


def test_a_persona_step_is_told_to_act_on_a_reply_already_in_context_not_just_note_it():
    """Seen live (session b931fb5e59a94de7875683dfffe9af77): a persona correctly
    read a real email reply's content and correctly judged escalation was
    needed, then only wrote "requires senior-management approval" as a
    condition in her own answer instead of actually calling
    delegate_to_human_agent for it -- exactly the "I'll check with so-and-so"
    non-pattern the preamble already warns against, just for a reply instead
    of a colleague. A plain step gets no such instruction, since it never has
    delegate_to_human_agent to act with in the first place."""
    factory = nodes.make_llm_node_factory(model_name="x", tools=[])

    persona_step = Step(id="a", kind="execute", description="Give the final decision.",
                        is_persona=True, assignee_name="Sarah", assignee_role="Compliance officer.")
    plain_step = Step(id="b", kind="execute", description="Search the web for Tesla news.")

    instruction = factory(persona_step, "a").instruction
    assert "act on it directly" in instruction
    assert "restating it as still pending" in instruction
    assert "act on it directly" not in factory(plain_step, "b").instruction


def test_instruction_for_step_reaches_a_plain_steps_own_instruction():
    """nodes.py has no visibility into the plan's edges on its own -- whether
    a step is the one directly downstream of an await_reply (and so may need
    to act on instructions the reply itself contains) is something only
    _build_workflow can compute, and instruction_for_step is how it hands
    that down, mirroring tools_for_step's existing pattern."""
    factory = nodes.make_llm_node_factory(
        model_name="x", tools=[],
        instruction_for_step=lambda step: "ACT ON THE REPLY" if step.id == "b" else None)
    step_a = Step(id="a", kind="execute", description="do a")
    step_b = Step(id="b", kind="execute", description="do b")

    assert "ACT ON THE REPLY" not in factory(step_a, "a").instruction
    assert "ACT ON THE REPLY" in factory(step_b, "b").instruction


def test_the_instruction_template_carries_no_goal_placeholder():
    """A returning {goal} placeholder would put the leak straight back."""
    assert "{goal}" not in nodes.EXECUTOR_INSTRUCTION


# --- the routing decision in _finalize --------------------------------------

def _service():
    rm = MagicMock(
        set_step_status=AsyncMock(), set_waiting=AsyncMock(), set_session_status=AsyncMock(),
        upsert_plan=AsyncMock(), upsert_steps=AsyncMock(), add_message=AsyncMock(),
        add_message_component=AsyncMock(),
        outstanding_interrupts=AsyncMock(return_value=[]),
        register_mail_wait=AsyncMock(), cancel_mail_waits=AsyncMock(),
        cancel_mail_wait=AsyncMock(),
        set_mail_wait_expected_from=AsyncMock(), bind_mail_wait_interrupt=AsyncMock())
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


def test_a_send_that_fails_leaves_no_wait_behind():
    """The wait must only exist if a mail a reply could answer exists.

    The row used to be written before the send was attempted, so a send that
    raised (MCP transport, auth, a 4xx from Graph) still left a wait: the step
    then parked on a reply to an email that was never sent, and nothing could
    ever resume it — the plan waited forever on mail that does not exist.
    Minting still happens first (the token has to be IN the mail); only
    persisting waits for the send to come back.
    """
    import inspect
    import pytest
    from src.smart_rag.tools.search.tools import SearchToolADK
    registered = []

    async def _explodes(**kwargs):
        raise RuntimeError("graph 502")
    _explodes.__name__ = "microsoft365_send_email"
    params = [inspect.Parameter(n, inspect.Parameter.KEYWORD_ONLY, default=None)
              for n in ("to_recipients", "subject", "body")]
    _explodes.__signature__ = inspect.Signature(params)
    _explodes.__annotations__ = {}
    failing = SearchToolADK(_explodes, {"function": {"name": "microsoft365_send_email",
                                                     "description": "", "parameters": {}}})

    async def on_sent(token, expected_from=None):
        registered.append(token)

    wrapped = nodes.stamp_send_email_tool(
        failing, token_provider=AsyncMock(return_value="YW-abcdefghijklmnop12"),
        on_sent=on_sent)

    with pytest.raises(RuntimeError):
        asyncio.run(wrapped.func(to_recipients=["r@example.com"], subject="Q", body="<p>Hi</p>"))

    assert registered == [], "a failed send must not register a wait"


def test_a_successful_send_registers_the_wait_after_the_mail_is_away():
    sent = []
    registered = []

    async def on_sent(token, expected_from=None):
        registered.append((token, expected_from))

    wrapped = nodes.stamp_send_email_tool(
        _fake_send_tool(sent), token_provider=AsyncMock(return_value="YW-abcdefghijklmnop12"),
        on_sent=on_sent)

    asyncio.run(wrapped.func(to_recipients=["r@example.com"], subject="Q", body="<p>Hi</p>"))

    assert len(sent) == 1
    # The recipients are passed through so the wait can verify the sender.
    assert registered == [("YW-abcdefghijklmnop12", ["r@example.com"])]


def test_the_send_step_feeding_a_wait_carries_that_wait_s_own_token():
    """Every step's send is stamped, but only the one the planner already wired
    to an await_reply carries that sibling's pre-registered token — the rest get
    a freshly minted one to rebind later. Getting this backwards routes a reply
    to the wrong wait."""
    svc, rm = _service()
    rm.mail_token_for = AsyncMock(return_value="YW-abcdefghijklmnop12")
    plan = Plan(id="p", title="t", goal="g", steps=[
        Step(id="send", kind="execute", description="email her"),
        Step(id="other", kind="execute", description="unrelated work"),
        Step(id="wait", kind="await_reply", question="awaiting", depends_on=["send"]),
    ])
    tools_for_step = svc._mail_stamping("s1", "u1", plan)

    def token_of(step_id):
        sent = []
        wrapped = tools_for_step(plan.step(step_id), [_fake_send_tool(sent)])[0]
        asyncio.run(wrapped.func(to_recipients=["r@example.com"], subject="Q", body="<p>Hi</p>"))
        return mail_token.extract(sent[0]["subject"], sent[0]["body"])

    # The step whose mail is awaited carries the wait's own registered token.
    assert token_of("send") == "YW-abcdefghijklmnop12"
    # An unrelated step still gets stamped, but with its own eager token.
    assert token_of("other") not in (None, "YW-abcdefghijklmnop12")


def test_every_step_s_send_is_stamped_even_with_no_wait_in_the_plan():
    """Any step may call create_task(kind='await_reply') after its mail is
    already gone, so a plan with no wait today can grow one mid-turn. An
    unstamped send would leave that wait nothing to rebind onto."""
    svc, _ = _service()
    plan = Plan(id="p", title="t", goal="g", steps=[Step(id="a", kind="execute")])
    tools_for_step = svc._mail_stamping("s1", "u1", plan)
    sent = []
    wrapped = tools_for_step(plan.step("a"), [_fake_send_tool(sent)])[0]
    asyncio.run(wrapped.func(to_recipients=["r@example.com"], subject="Q", body="<p>Hi</p>"))
    assert mail_token.extract(sent[0]["subject"], sent[0]["body"])


def test_a_step_eagerly_mints_a_pending_token_on_send():
    """A step might send its mail before deciding to spin up
    create_task(kind='await_reply') — the await_reply sibling doesn't exist yet
    at send time (create_task creates it AFTER), so there is no sibling to look
    up the way the static case does. Without eager minting, that mail goes
    out with no token at all and no reply can ever be routed back to
    whatever wait gets created a moment later. See the session that
    surfaced this: a step sent a follow-up email, then called
    create_task(kind='await_reply') — the new step blocked forever because
    nothing had minted a token for its sender's mail."""
    svc, rm = _service()
    plan = Plan(id="p", title="t", goal="g",
               steps=[Step(id="s3", kind="execute", description="handle the reply")])
    tools_for_step = svc._mail_stamping("s1", "u1", plan)
    sent = []
    wrapped = tools_for_step(plan.step("s3"), [_fake_send_tool(sent)])[0]
    asyncio.run(wrapped.func(to_recipients=["r@example.com"], subject="Q", body="<p>Hi</p>"))

    rm.register_mail_wait.assert_awaited_once()
    kw = rm.register_mail_wait.await_args.kwargs
    assert (kw["session_id"], kw["step_id"], kw["user_id"]) == ("s1", "__pending__:s3", "u1")
    token = rm.register_mail_wait.await_args.args[0]
    assert token.startswith("YW-")
    assert token in sent[0]["subject"]


# --- the reply that never comes ---------------------------------------------

def test_an_unanswered_wait_becomes_a_question_to_the_owner():
    """A step parked on mail is parked on an interrupt no arriving mail will ever
    match once the wait expires — without this it waits forever and nobody is
    told why."""
    svc, rm = _service()
    rm.expire_mail_waits = AsyncMock(return_value=[{
        "token": "YW-x", "session_id": "s1", "step_id": "m", "user_id": "u1",
        "interrupt_id": "mail:plan@1/m@1", "expected_from": "x@example.com",
    }])

    assert asyncio.run(svc.expire_mail_waits()) == 1
    # The session now points at that interrupt, so the owner's chat reply is
    # routed to the parked step and answers it by hand.
    rm.set_waiting.assert_awaited_once_with("s1", "mail:plan@1/m@1")
    rm.set_step_status.assert_awaited_once()
    assert rm.set_step_status.await_args.kwargs["blocked_reason"] == "no reply from x@example.com"
    # And the owner is actually told, rather than the plan going quiet.
    assert "reply" in rm.add_message.await_args.args[3].lower()


def test_an_unclaimed_pending_wait_expires_quietly():
    """A step with create_task access eagerly mints a token on every mail it
    sends, whether or not it ever follows up with create_task(kind=
    'await_reply') — most of the time it won't. That row never parks (no
    step is really waiting on it), so it never gets an interrupt_id. Without
    this guard, expiry would try to route a chat reply to a step that
    doesn't exist and could clobber a session's real waiting state with
    set_waiting(session_id, None)."""
    svc, rm = _service()
    rm.expire_mail_waits = AsyncMock(return_value=[{
        "token": "YW-x", "session_id": "s1", "step_id": "__pending__:s3",
        "user_id": "u1", "interrupt_id": None, "expected_from": None,
    }])

    asyncio.run(svc.expire_mail_waits())
    rm.set_waiting.assert_not_awaited()
    rm.set_step_status.assert_not_awaited()
    rm.add_message.assert_not_awaited()


def test_nothing_expires_when_every_reply_arrived():
    svc, rm = _service()
    rm.expire_mail_waits = AsyncMock(return_value=[])
    assert asyncio.run(svc.expire_mail_waits()) == 0
    rm.set_waiting.assert_not_awaited()


def test_registering_a_wait_always_sets_a_deadline():
    svc, rm = _service()
    asyncio.run(svc._project_plan("s1", _plan(), "u1"))
    expires_at = rm.register_mail_wait.await_args.kwargs["expires_at"]
    assert expires_at is not None, "a wait with no deadline waits forever"
    assert expires_at > datetime.now(timezone.utc)


def test_the_planner_is_told_when_to_await_a_reply():
    """The prompt is the whole mechanism here — there is no code path that adds
    an await_reply step, the planner either emits one or the plan sends a mail
    and invents the answer. Pins the contract the prompt must keep stating.
    (That the model obeys is checked against the live planner, not here.)"""
    from src.companion_ai.service import PLANNER_INSTRUCTION

    assert '"await_reply"' in PLANNER_INSTRUCTION
    # It must be a separate step from the send, linked by depends_on — that link
    # is what carries the routing token to the right wait.
    assert "MUST depends_on the step" in PLANNER_INSTRUCTION
    # And it must not be reached for mail that expects no answer.
    assert "needs no answer" in PLANNER_INSTRUCTION


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

    # The Teams sibling recognises only send_teams_message, and never the mail tool.
    assert nodes.is_send_teams_tool(_tool("microsoft365_send_teams_message"))
    for other in ("microsoft365_send_email", "microsoft365_search_documents",
                  "microsoft365_create_meeting"):
        assert not nodes.is_send_teams_tool(_tool(other)), other


def test_teams_chat_id_is_read_from_the_send_result():
    """The Teams wait is bound to the chat the message landed in — parsed from
    send_teams_message's JSON result. A channel send (no chatId) or a failure
    yields None, so the wrapper knows the reply cannot be routed."""
    import json
    # Explicit top-level chat_id (what send_teams_message surfaces).
    explicit = json.dumps({"status": "success", "chat_id": "19:abc@thread.v2", "data": {"id": "1"}})
    assert nodes._teams_chat_id(explicit) == "19:abc@thread.v2"
    # Fallback: Graph echoed chatId on the message resource.
    echoed = json.dumps({"status": "success", "data": {"id": "1", "chatId": "19:def@thread.v2"}})
    assert nodes._teams_chat_id(echoed) == "19:def@thread.v2"
    # Neither present (channel send / no chat) → None so the wrapper warns.
    assert nodes._teams_chat_id(json.dumps({"status": "success", "data": {"id": "1"}})) is None
    assert nodes._teams_chat_id('{"status":"error","message":"nope"}') is None
    assert nodes._teams_chat_id("not json") is None
    assert nodes._teams_chat_id(None) is None


if __name__ == "__main__":
    test_await_reply_parks_then_resumes_with_the_reply_body()
    test_only_a_chat_answerable_interrupt_is_an_ask()
    test_the_node_factory_builds_await_reply_from_the_step_kind()
    test_an_executor_never_sees_the_plan_wide_goal_or_another_steps_task()
    test_the_instruction_template_carries_no_goal_placeholder()
    test_a_mail_wait_never_becomes_the_sessions_chat_interrupt()
    test_an_ask_alongside_a_mail_wait_is_the_one_the_chat_answers()
    test_a_plan_parked_only_on_mail_does_not_complete()
    test_the_token_is_minted_before_any_mail_could_be_sent()
    test_a_new_plan_drops_the_previous_plans_waits()
    test_a_plan_with_no_await_step_registers_nothing()
    test_parking_binds_the_interrupt_so_the_wait_becomes_deliverable()
    test_an_ask_step_parking_binds_no_mail_wait()
    print("ok")


def test_every_step_is_told_to_register_a_wait_after_sending_mail():
    """Live failure twice (sessions a198ff8e, 24a0417c): Firas replied "do me a
    web search first", the persona spun that off with create_task(execute), and
    the spawned step compiled the list, EMAILED it to him, then stopped —
    registering no await_reply. His answer had nothing to match, and the session
    reported 'completed' with the real question still open.

    The model was not disobeying. "Send the mail, then call
    create_task(kind='await_reply')" lived ONLY in the persona preamble, which
    nodes.py attaches under `if step.is_persona` — and a create_task(execute)
    step is born is_persona=False, so it got the bare EXECUTOR_INSTRUCTION,
    which never mentioned waits at all.

    Deliberately NOT fixed by making spun-off steps inherit the persona: the
    preamble also says "get the actual decision from {assignee_name} by email",
    so a step spun off to run a check would email the persona instead of doing
    the work. The rule belongs to every step that sends mail, not to personas.
    """
    factory = nodes.make_llm_node_factory(model_name="x", tools=[])

    for step in (
        # a plain spun-off task — the case that lost the reply
        Step(id="a", kind="execute", description="Email Firas the list.",
             is_dynamic_delegate=True, assignee_name="worky executer"),
        # a persona step
        Step(id="b", kind="execute", description="Ask Hamdi.", is_persona=True,
             assignee_name="Hamdi Imed", assignee_role="data lead"),
        # a delegate step
        Step(id="c", kind="execute", description="Hi Firas - confirm?",
             is_persona=True, is_dynamic_delegate=True, assignee_name="Firas Kahia"),
    ):
        instruction = factory(step, "n").instruction
        assert "create_task(kind='await_reply')" in instruction, \
            f"step {step.id} was never told to register a wait:\n{instruction[:300]}"
        assert "REPLY matters" in instruction or "reply matters" in instruction.lower()


def test_a_delivered_reply_is_attributed_to_its_sender_not_the_plan():
    """ADK renders injected content as "[<author>] said: ...", and the author is
    the workflow -- named plan_<session_id> -- so an unlabelled reply reaches the
    next step looking like an instruction from the PLAN itself. Seen live in
    session 2e7fa392c64e4a35b9f77e70d49d275d: Firas replied "do me a search about
    new mcps ... then i can tell what we can implement", and the step read
    "[plan_2e7fa392...] said:" as the plan's own wording, concluded the searches
    "are already part of the plan's other steps", and did nothing at all."""
    from src.grpc_server import companion_ai_servicer as srv

    svc_mock = MagicMock(resume_turn=AsyncMock())
    rm = MagicMock(claim_mail_wait=AsyncMock(return_value={
        "session_id": "sess1", "step_id": "s2", "user_id": "u1",
        "interrupt_id": "mail:task_s2@1/s2@1"}))
    servicer = srv.CompanionAiServicer(svc_mock, rm)

    request = MagicMock(
        token="YW-abcdefghijklmnop12",
        reply_body="do me a search about new mcps in the market",
        reply_from="firasworky@gmail.com",
        agents=[], connectors=[])
    asyncio.run(servicer._resume_with_reply(
        request, {"session_id": "sess1", "step_id": "s2", "user_id": "u1",
                  "interrupt_id": "mail:task_s2@1/s2@1"}, "m"))

    answer = svc_mock.resume_turn.await_args.kwargs["answer"]
    assert answer.startswith("Email reply from firasworky@gmail.com")
    # The reply's own words survive intact after the attribution line.
    assert answer.rstrip().endswith("do me a search about new mcps in the market")


def test_recipients_extracted_as_bare_lowercased_addresses():
    """expected_from is built from EVERY recipient — a reply from any of them
    resolves the wait — as bare, lower-cased addresses; empty when none."""
    assert nodes._recipients({"to_recipients": ["rabeb@yellowsys.fr"]}) == ["rabeb@yellowsys.fr"]
    assert nodes._recipients({"to_recipients": ["Rabeb <Rabeb@Yellowsys.FR>"]}) == ["rabeb@yellowsys.fr"]
    assert nodes._recipients({"to_recipients": "rabeb@yellowsys.fr"}) == ["rabeb@yellowsys.fr"]
    assert nodes._recipients({"to_recipients": ["a@x.fr", "B@x.fr"]}) == ["a@x.fr", "b@x.fr"]
    assert nodes._recipients({"to_recipients": []}) == []
    assert nodes._recipients({}) == []
    print("ok  recipients: all, bare and lower-cased")


def test_dep_gate_deferral_emits_no_terminal_event():
    """The live replay-barrier divergence (session e37a716) came from the
    dep-gate deferring a prematurely-fired step with a TEXT response — a terminal
    event (message_as_output) that entered ADK's replay-barrier sequence AHEAD of
    the await the step depended on, deadlocking the resume. The deferral must
    therefore produce NO terminal event, so it never enters the barrier. Runs a
    real gated node on the ADK engine and asserts it records nothing terminal."""
    import asyncio
    from google.adk.agents import LlmAgent
    from google.adk.models import BaseLlm
    from google.adk.models.llm_response import LlmResponse
    from google.adk.runners import Runner
    from google.adk.sessions import InMemorySessionService
    from google.adk.workflow import START, Workflow
    from google.adk.workflow.utils._rehydration_utils import is_terminal_event
    from google.genai import types as gt
    from src.companion_ai import nodes as nm
    from src.companion_ai.plan import Step

    class _Dummy(BaseLlm):
        def __init__(self): super().__init__(model="fake")
        async def generate_content_async(self, req, stream=False):
            yield LlmResponse(content=gt.Content(role="model", parts=[gt.Part(text="REAL")]))

    step = Step(id="d", kind="execute", description="deferred", depends_on=["x"])
    # gate: dep 'x' is unmet → defer
    gate = nm._defer_if_deps_unmet(step, lambda s: ["x"])
    agent = LlmAgent(name="d", model=_Dummy(), instruction="i",
                     before_model_callback=nm._compose_before_model(gate))

    async def run():
        ss = InMemorySessionService()
        r = Runner(app_name="t", agent=Workflow(name="t", edges=[(START, agent)]),
                   session_service=ss)
        await ss.create_session(app_name="t", user_id="u", session_id="s")
        yielded = [e async for e in r.run_async(user_id="u", session_id="s",
                   new_message=gt.Content(role="user", parts=[gt.Part(text="go")]))]
        sess = await ss.get_session(app_name="t", user_id="u", session_id="s")
        return yielded, sess.events

    yielded, recorded = asyncio.run(run())
    assert not any(is_terminal_event(e) for e in yielded), "deferral yielded a terminal event"
    # nothing terminal recorded for the node either (only the user input may exist)
    node_terms = [e for e in recorded if is_terminal_event(e)
                  and e.node_info and e.node_info.path]
    assert not node_terms, f"deferral recorded a terminal node event: {node_terms}"


def test_teams_chat_id_unwraps_the_mcp_text_envelope():
    """The send_teams_message MCP tool returns its payload as a JSON string under
    "text" — the chat id must be read from inside it, else the Teams wait never
    gets a conversation_id and the poller stays blind (session c7b084e1)."""
    import json
    envelope = {"text": json.dumps({
        "status": "success",
        "chat_id": "19:abc_def@unq.gbl.spaces",
        "data": {"id": "1790066864309", "chatId": "19:abc_def@unq.gbl.spaces"}})}
    assert nodes._teams_chat_id(envelope) == "19:abc_def@unq.gbl.spaces"
    # a JSON-string envelope works too (result arriving as a str)
    assert nodes._teams_chat_id(json.dumps(envelope)) == "19:abc_def@unq.gbl.spaces"


def test_teams_chat_id_still_reads_the_flat_shapes():
    """Back-compat: a flat dict/string with chat_id (or data.chatId) still works."""
    assert nodes._teams_chat_id({"chat_id": "19:x@unq.gbl.spaces"}) == "19:x@unq.gbl.spaces"
    assert nodes._teams_chat_id({"data": {"chatId": "19:y@unq.gbl.spaces"}}) == "19:y@unq.gbl.spaces"
    assert nodes._teams_chat_id({"text": "not json"}) is None
    assert nodes._teams_chat_id(None) is None


def test_finalize_cancels_an_await_whose_send_failed_and_its_dead_branch():
    """An await_reply whose upstream send FAILED can never be answered — parking it
    strands the session on a dead interrupt and blocks later amends (session
    0a08ea4b). _finalize cancels it (and its wait) and cascades to the branch
    below it, instead of blocking or phantom-completing them."""
    svc, rm = _service()
    plan = Plan(id="p", title="t", goal="g", steps=[
        Step(id="s0", kind="execute", description="Message Adam", status=Status.FAILED),
        Step(id="m", kind="await_reply", question="Await Adam", depends_on=["s0"]),
        Step(id="r", kind="execute", description="Report", depends_on=["m"]),
    ])
    interrupts = [("mail:plan@1/m@1", "m")]
    rm.outstanding_interrupts.return_value = []   # after cancel, nothing is outstanding

    asyncio.run(svc._finalize("s1", plan, interrupts))

    assert plan.step("m").status is Status.CANCELLED   # the zombie await
    assert plan.step("r").status is Status.CANCELLED    # dead branch, not phantom-completed
    rm.cancel_mail_wait.assert_awaited_once_with("s1", "m")
    # session is no longer held hostage by the dead await
    rm.set_session_status.assert_awaited()


def test_finalize_still_blocks_a_healthy_await():
    """Guard: an await whose send SUCCEEDED (dep completed) still parks normally."""
    svc, rm = _service()
    plan = Plan(id="p", title="t", goal="g", steps=[
        Step(id="s0", kind="execute", description="Message Adem", status=Status.COMPLETED),
        Step(id="m", kind="await_reply", question="Await Adem", depends_on=["s0"]),
    ])
    interrupts = [("mail:plan@1/m@1", "m")]
    rm.outstanding_interrupts.return_value = interrupts

    asyncio.run(svc._finalize("s1", plan, interrupts))

    assert plan.step("m").status is Status.BLOCKED
    rm.cancel_mail_wait.assert_not_awaited()
