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
from google.genai import types

from src.orchestrator.plan import Plan, Step
from src.orchestrator import graph


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


if __name__ == "__main__":
    test_node_name_sanitizes_digit_leading_ids(); print("ok  node_name sanitize")
    test_independent_steps_all_start_together(); print("ok  independent parallel")
    test_linear_chain_is_ordered(); print("ok  linear ordered")
    test_diamond_runs_each_step_once_with_parallel_and_join(); print("ok  diamond once + join")
    try:
        test_invalid_dag_rejected_before_build(); print("ok  invalid dag rejected")
    except ImportError:
        pass
    print("\nall graph tests passed")
