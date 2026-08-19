"""Plan -> Workflow translation, executed on the real ADK engine (no LLM).

Runs under the project venv (ADK 2.3.0). Uses FunctionNode workers so we verify
the graph the translator builds actually schedules correctly: each step runs
EXACTLY ONCE (JoinNode prevents fan-in double-runs), independent steps overlap,
dependents wait.

    <adk venv>/bin/python tests/orchestrator/test_graph.py
"""
import asyncio
import os
import sys
import time
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from google.adk.runners import InMemoryRunner
from google.adk.workflow import BaseNode
from google.genai import types

from src.companion_ai.plan import Plan, Step
from src.companion_ai import graph


def _fn_factory(runs: Counter, when: dict, t0_ref: list, delay: float = 0.2):
    """Factory of FunctionNode workers that record run count + start time."""
    from google.adk.workflow import FunctionNode

    def factory(step: Step, name: str):
        async def fn():
            when.setdefault(step.id, round(time.monotonic() - t0_ref[0], 2))
            await asyncio.sleep(delay)
            runs[step.id] += 1
            return {name: "ok"}
        fn.__name__ = name
        return FunctionNode(func=fn, name=name)

    return factory


async def _run(plan: Plan, delay: float = 0.2):
    runs, when, t0 = Counter(), {}, [time.monotonic()]
    wf = graph.to_workflow(plan, _fn_factory(runs, when, t0, delay),
                           name="test_plan", max_concurrency=8)
    t0[0] = time.monotonic()
    runner = InMemoryRunner(node=wf, app_name="t")
    await runner.session_service.create_session(app_name="t", user_id="u", session_id="s")
    async for _ in runner.run_async(
        user_id="u", session_id="s",
        new_message=types.Content(role="user", parts=[types.Part(text="go")]),
    ):
        pass
    return runs, when


def test_diamond_runs_each_step_once_with_parallel_and_join():
    # a -> (b, c) -> d ; d has TWO deps -> must go through a JoinNode
    plan = Plan(title="t", goal="g", steps=[
        Step(id="a"),
        Step(id="b", depends_on=["a"]),
        Step(id="c", depends_on=["a"]),
        Step(id="d", depends_on=["b", "c"]),
    ])
    runs, when = asyncio.run(_run(plan, delay=0.3))
    # every step ran exactly once — the JoinNode prevented d from double-running
    assert dict(runs) == {"a": 1, "b": 1, "c": 1, "d": 1}, dict(runs)
    # b and c started together (parallel), d started after both
    assert abs(when["b"] - when["c"]) < 0.15, when
    assert when["d"] >= when["b"] + 0.3 - 0.05 and when["d"] >= when["c"] + 0.3 - 0.05, when


def test_independent_steps_all_start_together():
    plan = Plan(title="t", goal="g", steps=[Step(id="a"), Step(id="b"), Step(id="c")])
    runs, when = asyncio.run(_run(plan, delay=0.2))
    assert dict(runs) == {"a": 1, "b": 1, "c": 1}
    assert max(when.values()) - min(when.values()) < 0.15, when  # all parallel


def test_linear_chain_is_ordered():
    plan = Plan(title="t", goal="g", steps=[
        Step(id="a"), Step(id="b", depends_on=["a"]), Step(id="c", depends_on=["b"]),
    ])
    runs, when = asyncio.run(_run(plan, delay=0.2))
    assert dict(runs) == {"a": 1, "b": 1, "c": 1}
    assert when["a"] < when["b"] < when["c"], when


def test_invalid_dag_rejected_before_build():
    import pytest
    plan = Plan(title="t", goal="g", steps=[
        Step(id="a", depends_on=["b"]), Step(id="b", depends_on=["a"]),
    ])
    with pytest.raises(ValueError, match="cycle"):
        graph.to_workflow(plan, lambda s, n: None)


def test_node_name_sanitizes_digit_leading_ids():
    assert graph.node_name("9abc").isidentifier()
    assert graph.node_name("a-b.c").isidentifier()


def _node_names(wf):
    names = set()
    for a, b in wf.edges:
        names.add(a.name)
        names.add(b.name)
    return names


def test_plan_done_sink_present_even_with_a_single_terminal():
    # Regression: plan_done used to be gated on len(terminals) > 1, so a
    # single-terminal plan built no such node. Since to_workflow() is rebuilt
    # fresh every turn from the CURRENT plan.steps, and create_task can append
    # steps that shrink a prior turn's multi-terminal set down to one, that
    # gate let "plan_done" silently vanish from a later turn's graph even
    # though an earlier turn's session events already recorded its
    # completion — permanently stalling ADK's replay barrier, which waits
    # forever for a "plan_done@N" event that will never come (RuntimeError:
    # "Replay divergence detected ..."). plan_done's own output isn't
    # consumed anywhere, so it must always be built, regardless of terminal
    # count.
    plan = Plan(title="t", goal="g", steps=[Step(id="a")])
    wf = graph.to_workflow(plan, lambda s, n: BaseNode(name=n))
    assert "plan_done" in _node_names(wf)


def test_plan_done_sink_stays_present_after_terminals_shrink_across_turns():
    # Same regression, reproduced across two turns: turn 1 has two
    # independent terminals (a, b) -> plan_done joins both. Turn 2 (as
    # create_task/a consolidating step would do) adds c depending on BOTH a
    # and b, shrinking the terminal set to just {c}. plan_done must still be
    # present in turn 2's freshly rebuilt graph, under the same name, so ADK's
    # replay barrier can find a matching completion for the "plan_done@N" key
    # it already recorded from turn 1.
    def factory(step, name):
        return BaseNode(name=name)

    plan_turn1 = Plan(title="t", goal="g", steps=[Step(id="a"), Step(id="b")])
    wf1 = graph.to_workflow(plan_turn1, factory, name="p")
    assert "plan_done" in _node_names(wf1)

    plan_turn2 = Plan(title="t", goal="g", steps=[
        Step(id="a"), Step(id="b"), Step(id="c", depends_on=["a", "b"]),
    ])
    wf2 = graph.to_workflow(plan_turn2, factory, name="p")
    assert "plan_done" in _node_names(wf2)


def test_plan_done_never_enters_the_replay_barrier():
    """The plan_done sink must emit NO terminal event.

    Root cause of a live crash: ADK's replay barrier pins every node that
    emits a terminal event (anything with a non-None `output`, per
    is_terminal_event) to a fixed chronological slot in the session's
    recorded history. A stock JoinNode always yields Event(output=...), so
    the sink got pinned to whatever slot it first fired at.

    That deadlocks a growing plan: to_workflow is rebuilt each turn, and
    create_task/delegate_to_human_agent append steps mid-session. Seen live
    — a wave-2 step fanned out into two wave-3 children (one dead-ending
    into the sink, one continuing into wave 4), pushing the sink
    structurally LATER while history insisted it had already completed
    EARLIER (recovered_sequence ['s1@1', 'plan_done@1', 'n_70cd...@1'] —
    plan_done pinned at index 1, ahead of a node it must now follow). The
    barrier then waited forever: RuntimeError("Replay divergence detected:
    Timed out waiting for sequence key ... to be unblocked.").

    Emitting no output keeps the sink out of the barrier, so its position
    floats freely as the plan grows. Real steps must STILL be pinned.
    """
    from google.adk.workflow.utils._rehydration_utils import is_terminal_event

    runs, when, t0 = Counter(), {}, [time.monotonic()]
    # Two independent terminals, so the sink genuinely fans in.
    plan = Plan(title="t", goal="g", steps=[Step(id="a"), Step(id="b")])
    wf = graph.to_workflow(plan, _fn_factory(runs, when, t0, 0.0),
                           name="test_plan", max_concurrency=8)

    async def go():
        runner = InMemoryRunner(node=wf, app_name="t")
        await runner.session_service.create_session(app_name="t", user_id="u", session_id="s")
        async for _ in runner.run_async(
            user_id="u", session_id="s",
            new_message=types.Content(role="user", parts=[types.Part(text="go")])):
            pass
        return await runner.session_service.get_session(
            app_name="t", user_id="u", session_id="s")

    session = asyncio.run(go())
    pinned = [e.node_info.path for e in session.events
              if is_terminal_event(e) and e.node_info and e.node_info.path]

    assert not any("plan_done" in p for p in pinned), \
        f"plan_done must not be pinned in the replay barrier, got {pinned}"
    # The real steps still are — otherwise replay ordering breaks entirely.
    assert any(p.endswith("a@1") for p in pinned), pinned
    assert any(p.endswith("b@1") for p in pinned), pinned
    assert dict(runs) == {"a": 1, "b": 1}, dict(runs)


def test_intermediate_fanin_join_never_enters_the_replay_barrier():
    """A fan-in join for a step with >=2 deps must ALSO emit no terminal event,
    for the same reason as the sink.

    Root cause of a live crash (session with 'Écrire à Firas' / 'Attendre
    Firas'): a step with two deps got a STOCK JoinNode, which yields
    Event(output=...) and so got pinned in the replay barrier. As the plan
    grew via converse amends, the join's structural position shifted, and a
    later mail-reply resume timed out: RuntimeError("Replay divergence
    detected: Timed out waiting for sequence key 'join_<id>@1' to be
    unblocked."). Making the intermediate join silent (like the sink) keeps it
    out of the barrier while it still fires exactly once after all deps.
    """
    from google.adk.workflow.utils._rehydration_utils import is_terminal_event

    runs, when, t0 = Counter(), {}, [time.monotonic()]
    # a -> (b, c) -> d ; d has TWO deps, so it goes through join_d.
    plan = Plan(title="t", goal="g", steps=[
        Step(id="a"), Step(id="b", depends_on=["a"]),
        Step(id="c", depends_on=["a"]), Step(id="d", depends_on=["b", "c"]),
    ])
    wf = graph.to_workflow(plan, _fn_factory(runs, when, t0, 0.0),
                           name="test_plan", max_concurrency=8)

    async def go():
        runner = InMemoryRunner(node=wf, app_name="t")
        await runner.session_service.create_session(app_name="t", user_id="u", session_id="s")
        async for _ in runner.run_async(
            user_id="u", session_id="s",
            new_message=types.Content(role="user", parts=[types.Part(text="go")])):
            pass
        return await runner.session_service.get_session(
            app_name="t", user_id="u", session_id="s")

    session = asyncio.run(go())
    pinned = [e.node_info.path for e in session.events
              if is_terminal_event(e) and e.node_info and e.node_info.path]

    assert not any("join_d" in p for p in pinned), \
        f"the fan-in join must not be pinned in the replay barrier, got {pinned}"
    # d still ran exactly once after both deps — the join fired despite being silent.
    assert dict(runs) == {"a": 1, "b": 1, "c": 1, "d": 1}, dict(runs)
    assert any(p.endswith("d@1") for p in pinned), pinned


if __name__ == "__main__":
    test_node_name_sanitizes_digit_leading_ids(); print("ok  node_name sanitize")
    test_independent_steps_all_start_together(); print("ok  independent parallel")
    test_linear_chain_is_ordered(); print("ok  linear ordered")
    test_diamond_runs_each_step_once_with_parallel_and_join(); print("ok  diamond once + join")
    test_plan_done_sink_present_even_with_a_single_terminal(); print("ok  plan_done present, single terminal")
    test_plan_done_sink_stays_present_after_terminals_shrink_across_turns(); print("ok  plan_done stable across shrinking terminals")
    try:
        test_invalid_dag_rejected_before_build(); print("ok  invalid dag rejected")
    except ImportError:
        pass
    print("\nall graph tests passed")
