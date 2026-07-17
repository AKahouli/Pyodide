"""Several steps parked at once — proven on the real ADK engine (no LLM).

A wave can park more than one step (each asking its own question). Each parks
with its own interrupt id and is answerable on its own, in any order, from a
separate run — which is what lets a webhook answer one step while a human
answers another.

The trap this pins down: ADK emits an interrupt only on the run that raises it.
Resuming step A produces NO event for still-parked step B, so a run's events are
not the outstanding set. Anything deriving "nothing is parked" from one run's
events will complete B unanswered.

    <adk venv>/bin/python tests/orchestrator/test_multi_interrupt.py
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from google.adk.runners import InMemoryRunner
from google.genai import types

from src.companion_ai import graph, hitl
from src.companion_ai.plan import Plan, Step


def _ask_factory(step, name):
    return hitl.make_ask_user_node(name, step.question or "?")


async def _run(runner, message):
    """Drive one run; return the interrupt ids it raised and the state it wrote."""
    ids, state = [], {}
    async for ev in runner.run_async(user_id="u", session_id="s", new_message=message):
        ids += hitl.interrupt_ids(ev)
        if ev.actions and ev.actions.state_delta:
            state.update(dict(ev.actions.state_delta))
    return ids, state


async def _scenario(resume_order):
    """Two independent ask steps; answer them in `resume_order`."""
    plan = Plan(id="p", title="t", goal="g", steps=[
        Step(id="a", kind="ask", question="A?"),
        Step(id="b", kind="ask", question="B?"),
    ])
    wf = graph.to_workflow(plan, _ask_factory, name="plan_x")
    runner = InMemoryRunner(node=wf, app_name="h")
    await runner.session_service.create_session(app_name="h", user_id="u", session_id="s")

    parked, _ = await _run(runner, types.Content(role="user", parts=[types.Part(text="go")]))
    answers = {}
    for iid in [dict(zip("ab", parked))[k] for k in resume_order]:
        _, state = await _run(runner, types.Content(
            role="user", parts=[hitl.resume_part(iid, {"value": iid.split("/")[-1]})]))
        answers.update(state)
    return parked, answers


def test_a_wave_parks_every_ask_step_not_just_the_first():
    parked, _ = asyncio.run(_scenario("ab"))
    assert len(parked) == 2, f"expected both steps parked, got {parked}"
    # Interrupt ids derive from the node path, so they are already step-unique.
    assert len(set(parked)) == 2, f"interrupt ids are not distinct: {parked}"


def test_each_parked_step_resumes_independently_in_either_order():
    for order in ("ab", "ba"):
        parked, answers = asyncio.run(_scenario(order))
        assert len(answers) == 2, f"resume order {order!r}: expected both answered, got {answers}"
        assert answers["a"].startswith("a") and answers["b"].startswith("b"), \
            f"resume order {order!r}: answers landed on the wrong steps: {answers}"


def test_resuming_one_step_emits_no_interrupt_for_the_other():
    """The trap: a run's events cannot tell you what is still parked."""
    async def go():
        plan = Plan(id="p", title="t", goal="g", steps=[
            Step(id="a", kind="ask", question="A?"),
            Step(id="b", kind="ask", question="B?"),
        ])
        wf = graph.to_workflow(plan, _ask_factory, name="plan_x")
        runner = InMemoryRunner(node=wf, app_name="h")
        await runner.session_service.create_session(app_name="h", user_id="u", session_id="s")
        parked, _ = await _run(runner, types.Content(role="user", parts=[types.Part(text="go")]))
        # Answer only A. B is still genuinely waiting.
        reraised, _ = await _run(runner, types.Content(
            role="user", parts=[hitl.resume_part(parked[0], {"value": "AAA"})]))
        return parked, reraised

    parked, reraised = asyncio.run(go())
    assert len(parked) == 2
    assert reraised == [], (
        "ADK re-emitted a parked interrupt on resume; _finalize's durable "
        "outstanding-set workaround may no longer be needed")
    # ...and B is still resumable afterwards: covered by the either-order test.


if __name__ == "__main__":
    test_a_wave_parks_every_ask_step_not_just_the_first()
    test_each_parked_step_resumes_independently_in_either_order()
    test_resuming_one_step_emits_no_interrupt_for_the_other()
    print("ok")
