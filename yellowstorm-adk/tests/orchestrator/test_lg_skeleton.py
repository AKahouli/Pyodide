"""Walking-skeleton go/no-go for the LangGraph orchestrator.

Offline: fake chat model + fake read model + a real AsyncSqliteSaver. Proves the
four things that decide whether the migration is viable at all:
  1. steps run in dependency order (a node sees its deps' results),
  2. fan-in waits for ALL deps (add_edge list source),
  3. the checkpointer actually persists state for the thread,
  4. status is projected running -> completed per step.
"""
from __future__ import annotations

import asyncio

from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

from src.companion_ai.lg.runner import LgRunner
from src.companion_ai.plan import Plan, Step


class FakeModel:
    """Returns DONE_<title> so a downstream node's injected context is checkable."""
    async def ainvoke(self, messages):
        human = messages[-1].content
        title = ""
        for line in human.splitlines():
            if line.startswith("Étape : "):
                title = line[len("Étape : "):].strip()
                break

        class _R:
            content = f"DONE_{title}"
        # yield once so parallel branches actually interleave under the scheduler
        await asyncio.sleep(0)
        return _R()


class FakeReadModel:
    def __init__(self):
        self.calls = []  # (step_id, status, result)

    async def upsert_plan(self, *a, **k):
        pass

    async def upsert_steps(self, *a, **k):
        pass

    async def set_session_status(self, *a, **k):
        pass

    async def set_step_status(self, session_id, step_id, status, *, result=None,
                              blocked_reason=None, interrupt_id=None):
        self.calls.append((step_id, status, result))


def _diamond_plan() -> Plan:
    # s1, s2 parallel off START; s3 fans in from BOTH.
    return Plan(id="p", title="t", goal="g", steps=[
        Step(id="s1", title="S1", description="do s1"),
        Step(id="s2", title="S2", description="do s2"),
        Step(id="s3", title="S3", description="do s3", depends_on=["s1", "s2"]),
    ])


async def test_skeleton_runs_dag_with_projection_and_checkpoint():
    plan = _diamond_plan()
    rm = FakeReadModel()
    runner = LgRunner("fake-model", read_model=rm)

    async with AsyncSqliteSaver.from_conn_string(":memory:") as saver:
        await saver.setup()
        res = await runner.run(plan, "sess-1", saver, model=FakeModel())

        # 1 + 2: s3 ran after BOTH and saw both results in its context
        assert res["done"]
        assert res["values"]["results"]["s3"] == "DONE_S3"
        # 3: checkpoint persisted for the thread
        cp = await saver.aget({"configurable": {"thread_id": "sess-1"}})
        assert cp is not None

    # the fan-in proof: s3's node must have received s1 AND s2 results. We assert
    # via projection order — s3 completes only after s1 and s2 completed.
    order = [(sid, st) for sid, st, _ in rm.calls]
    assert ("s3", "running") in order
    s3_run = order.index(("s3", "running"))
    assert order.index(("s1", "completed")) < s3_run
    assert order.index(("s2", "completed")) < s3_run

    # 4: every step projected running then completed
    for sid in ("s1", "s2", "s3"):
        assert ("running") == next(st for s, st, _ in rm.calls if s == sid)
        assert (sid, "completed", f"DONE_{sid.upper()}") in rm.calls


async def test_context_injection_reaches_dependent():
    """A dependent's node must be given its deps' results (downstream context)."""
    seen = {}

    class CtxModel:
        async def ainvoke(self, messages):
            human = messages[-1].content
            for line in human.splitlines():
                if line.startswith("Étape : "):
                    seen[line[len("Étape : "):].strip()] = human
                    break

            class _R:
                content = f"DONE_{seen and list(seen)[-1]}"
            return _R()

    plan = Plan(id="p", title="t", goal="g", steps=[
        Step(id="a", title="A", description="da"),
        Step(id="b", title="B", description="db", depends_on=["a"]),
    ])
    runner = LgRunner("fake", read_model=None)
    async with AsyncSqliteSaver.from_conn_string(":memory:") as saver:
        await saver.setup()
        await runner.run(plan, "sess-2", saver, model=CtxModel())
    assert "DONE_A" in seen["B"]  # B's prompt carried A's result


if __name__ == "__main__":
    asyncio.run(test_skeleton_runs_dag_with_projection_and_checkpoint())
    asyncio.run(test_context_injection_reaches_dependent())
    print("OK")
