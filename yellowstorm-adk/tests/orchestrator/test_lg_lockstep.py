"""Regression guard for langchain-ai/langgraph#6320 (super-step wave lockstep).

The old StateGraph tick/Send/worker loop had a JOIN barrier (`worker -> tick`):
every step in a wave had to finish before the NEXT round started, so a fast
branch's downstream step waited for a slow, unrelated sibling in the same wave.
The Functional-API executor is future-driven (asyncio.wait FIRST_COMPLETED), so
each branch advances on its own dependencies. This proves it end-to-end through
the real LgRunner (not the offline prototype).

    <venv>/bin/python -m pytest tests/orchestrator/test_lg_lockstep.py -q
"""
from __future__ import annotations

import asyncio
import time

from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

from src.companion_ai.langgraph.runner import LgRunner
from src.companion_ai.plan import Plan, Step


class TimedModel:
    """Sleeps a per-title duration and records when each step started, so we can
    assert a fast branch's downstream did not wait for a slow sibling."""
    def __init__(self, durations: dict):
        self.durations = durations
        self.started: dict = {}
        self._t0 = time.monotonic()

    async def ainvoke(self, messages):
        human = messages[-1].content
        title = next((l[len("Étape : "):].strip() for l in human.splitlines()
                      if l.startswith("Étape : ")), "")
        self.started[title] = time.monotonic() - self._t0
        await asyncio.sleep(self.durations.get(title, 0.02))

        class _R:
            content = f"DONE_{title}"
        return _R()


async def test_fast_branch_does_not_wait_for_slow_sibling():
    # Branch A: A1(slow) -> A2 ;  Branch B: B1(fast) -> B2. The two branches are
    # independent — B2 must start right after B1, NOT after slow A1.
    plan = Plan(id="p", title="t", goal="g", steps=[
        Step(id="a1", title="A1", description="slow root", depends_on=[]),
        Step(id="a2", title="A2", description="after a1", depends_on=["a1"]),
        Step(id="b1", title="B1", description="fast root", depends_on=[]),
        Step(id="b2", title="B2", description="after b1", depends_on=["b1"]),
    ])
    model = TimedModel({"A1": 0.30, "A2": 0.05, "B1": 0.03, "B2": 0.05})
    runner = LgRunner("fake", read_model=None)   # offline: no projection
    async with AsyncSqliteSaver.from_conn_string(":memory:") as saver:
        await saver.setup()
        r = await runner.run(plan, "s-lock", saver, model=model)
    assert r["done"], r
    # B2 started long before A1 (~0.30s) finished -> no wave barrier
    assert model.started["B2"] < 0.20, (
        f"B2 started at {model.started['B2']:.3f}s — blocked by slow sibling A1")
    # and before A2 (which legitimately waits on slow A1)
    assert model.started["B2"] < model.started["A2"], (
        f"B2 {model.started['B2']:.3f} should precede A2 {model.started['A2']:.3f}")


if __name__ == "__main__":
    asyncio.run(test_fast_branch_does_not_wait_for_slow_sibling())
    print("OK  lockstep gone (fast branch advances independently)")
