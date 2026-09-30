"""LG converse (amend a plan mid-flight): after a plan runs, a new message adds a
step that must run via goto on the SAME checkpointed thread, see the prior step's
result, and not re-run completed work. Also CASE A (direct answer).
"""
from __future__ import annotations

import asyncio
import uuid

from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

from src.companion_ai.langgraph.service import LgService
from src.companion_ai.plan import Plan, Status, Step


class EchoModel:
    def __init__(self):
        self.seen = {}

    async def ainvoke(self, messages):
        human = messages[-1].content
        title = next((l[len("Étape : "):].strip() for l in human.splitlines()
                      if l.startswith("Étape : ")), "")
        self.seen[title] = human

        class _R:
            content = f"DONE_{title}"
            tool_calls = []
        return _R()


class RM:
    def __init__(self):
        self.plan = None; self.steps = {}; self.session_status = None; self.messages = []

    async def ensure_session(self, sid, uid, t, status): self.session_status = status
    async def add_message(self, mid, sid, role, content, turn_id=None): self.messages.append((role, content))
    async def upsert_plan(self, sid, pid, title, goal, status, **k):
        self.plan = {"id": pid, "title": title, "goal": goal, "status": status,
                     "executor_id": None, "executor_name": None}
    async def upsert_steps(self, sid, steps):
        cols = ("step_id","ordinal","wave","status","kind","question","title",
                "description","depends_on","assignee","assignee_name","assignee_role",
                "is_persona","is_dynamic_delegate")
        for s in steps:
            r = dict(zip(cols, s)); r.setdefault("result", None); r.setdefault("interrupt_id", None)
            self.steps[r["step_id"]] = r
    async def set_step_status(self, sid, step_id, status, *, result=None, blocked_reason=None, interrupt_id=None):
        r = self.steps[step_id]; r["status"] = status
        if result is not None: r["result"] = result
        r["interrupt_id"] = interrupt_id
    async def set_session_status(self, sid, status): self.session_status = status
    async def set_waiting(self, sid, iid): self.session_status = "waiting"
    async def snapshot(self, sid):
        steps = sorted(self.steps.values(), key=lambda r: r["ordinal"])
        return {"session": {"id": sid, "status": self.session_status, "interrupt_id": None},
                "plan": self.plan, "steps": steps}


class FakeOrch:
    def __init__(self, rm, plans):
        self._rm = rm; self._plans = list(plans)

    async def _make_plan(self, sid, uid, message, **k):
        return self._plans.pop(0)

    async def _project_plan(self, sid, plan, uid):
        await self._rm.upsert_plan(sid, plan.id, plan.title, plan.goal, "running")
        rows = [(s.id, i, s.wave, s.status.value, s.kind, "", s.title or "", s.description or "",
                 ",".join(s.depends_on), "", "", "", False, False) for i, s in enumerate(plan.steps)]
        await self._rm.upsert_steps(sid, rows)

    async def _add_message(self, sid, role, content):
        if content: await self._rm.add_message("m", sid, role, content)
    async def _add_error_message(self, sid, content, title=None):
        if content: await self._rm.add_message("m", sid, "assistant", content)

    @staticmethod
    def _assistant_answer(plan):
        dep = {d for s in plan.steps for d in s.depends_on}
        terms = [s.result for s in plan.steps if s.id not in dep and s.result]
        return "\n\n".join(terms or [s.result for s in plan.steps if s.result])

    @staticmethod
    def _amend_message(plan, message): return message
    @staticmethod
    def _pending_note(snap): return ""
    async def _apply_ops(self, sid, plan, ops, id_map=None):
        imap = id_map or {}
        notes = []
        for op in ops:
            step = plan.step(op.get("step_id", ""))
            if step is None or step.status is not Status.PENDING:
                continue
            if op.get("op") == "insert_before":
                gate = plan.step(imap.get(op.get("new", ""), op.get("new", "")))
                if gate is not None:
                    gate.depends_on = list(step.depends_on)
                    step.depends_on = [gate.id]
                    for s in (gate, step):    # sync read-model deps (real _apply_ops upserts)
                        await self._rm.upsert_steps(sid, [(s.id, 0, 0, s.status.value, s.kind, "",
                            s.title or "", s.description or "", ",".join(s.depends_on),
                            "", "", "", False, False)])
                    notes.append("inserted")
        return notes

    async def _inject_steps(self, sid, uid, live, new_steps, id_map_out=None):
        leaves = [s.id for s in live.steps if s.status is Status.COMPLETED
                  and not any(s.id in o.depends_on for o in live.steps)]
        id_map = {s.id: uuid.uuid4().hex[:12] for s in new_steps}
        if id_map_out is not None:
            id_map_out.update(id_map)
        for s in new_steps:
            s.id = id_map[s.id]
            s.depends_on = [id_map.get(d, d) for d in s.depends_on] or list(leaves)
            s.status = Status.PENDING
            live.steps.append(s)
            await self._rm.upsert_steps(sid, [(s.id, len(live.steps), 0, "pending", "execute",
                                               "", s.title or "", s.description or "",
                                               ",".join(s.depends_on), "", "", "", False, False)])
        return len(new_steps)


async def test_converse_adds_and_runs_step():
    model = EchoModel()
    rm = RM()
    initial = Plan(id="p1", title="T", goal="G", steps=[Step(id="s1", title="S1", description="first")])
    amend = Plan(id="p2", title="", goal="", steps=[Step(id="a1", title="A1", description="also this")])
    async with AsyncSqliteSaver.from_conn_string(":memory:") as saver:
        await saver.setup()
        svc = LgService(FakeOrch(rm, [initial, amend]), rm, saver, model=model)
        await svc.plan_turn(session_id="S", user_id="u", message="do", model="m")
        assert rm.steps["s1"]["status"] == "completed"

        await svc.converse_turn(session_id="S", user_id="u", message="also this", model="m")
        # the amend step ran on the same thread, saw s1's result, didn't re-run s1
        a_id = next(k for k in rm.steps if k not in ("s1",))
        assert rm.steps[a_id]["status"] == "completed"
        assert "DONE_S1" in model.seen["A1"]        # amend step got the prior result


async def test_converse_direct_answer():
    rm = RM()
    initial = Plan(id="p1", title="T", goal="G", steps=[Step(id="s1", title="S1", description="x")])
    chit = Plan(id="p2", title="", goal="", steps=[]); chit.answer = "Le plan tourne, étape 1 finie."
    async with AsyncSqliteSaver.from_conn_string(":memory:") as saver:
        await saver.setup()
        svc = LgService(FakeOrch(rm, [initial, chit]), rm, saver, model=EchoModel())
        await svc.plan_turn(session_id="S", user_id="u", message="do", model="m")
        await svc.converse_turn(session_id="S", user_id="u", message="ça avance ?", model="m")
    assert ("assistant", "Le plan tourne, étape 1 finie.") in rm.messages


async def test_runtime_create_task_spawns_and_runs():
    """A step that calls create_task must spawn a follow-up step that then runs on
    the same thread (the resolve-spawns loop + goto)."""
    from langchain_core.messages import AIMessage

    class SpawnModel:
        def bind_tools(self, tools):
            return self

        async def ainvoke(self, messages):
            human = next((m.content for m in messages if getattr(m, "type", "") == "human"), "")
            if "Follow up" in human:                      # the spawned step
                return AIMessage(content="did-followup")
            if any(getattr(m, "type", "") == "tool" for m in messages):
                return AIMessage(content="did-s1")        # after create_task ack
            return AIMessage(content="", tool_calls=[{                # s1 spawns
                "name": "create_task",
                "args": {"title": "Follow up", "description": "do more"}, "id": "c1"}])

    rm = RM()
    initial = Plan(id="p1", title="T", goal="G", steps=[Step(id="s1", title="S1", description="first")])
    async with AsyncSqliteSaver.from_conn_string(":memory:") as saver:
        await saver.setup()
        svc = LgService(FakeOrch(rm, [initial]), rm, saver, model=SpawnModel())
        await svc.plan_turn(session_id="S", user_id="u", message="do", model="m")
    # s1 completed AND a spawned "Follow up" step ran to completion
    assert rm.steps["s1"]["status"] == "completed"
    spawned = [r for k, r in rm.steps.items() if k != "s1"]
    assert len(spawned) == 1
    assert spawned[0]["title"] == "Follow up"
    assert spawned[0]["status"] == "completed"
    assert spawned[0]["result"] == "did-followup"


async def test_converse_insert_before_gates_existing_step():
    """The new runtime plan-edit: 'add a check before <step>' INSERTS a new step
    before an existing pending one — the new step inherits the target's deps and the
    target now waits on it (re-parent), so it gates the step instead of running as a
    parallel branch. This is what fixes 'ask me before responding' without dropping
    the step's existing gate."""
    model = EchoModel()
    rm = RM()
    initial = Plan(id="p1", title="T", goal="G", steps=[
        Step(id="q", title="Q", kind="ask", question="ok?"),
        Step(id="final", title="FINAL", description="do final", depends_on=["q"]),
    ])
    amend = Plan(id="p2", title="", goal="", steps=[Step(id="g", title="GATE", description="a check")])
    amend.ops = [{"op": "insert_before", "step_id": "final", "new": "g"}]
    async with AsyncSqliteSaver.from_conn_string(":memory:") as saver:
        await saver.setup()
        svc = LgService(FakeOrch(rm, [initial, amend]), rm, saver, model=model)
        await svc.plan_turn(session_id="S", user_id="u", message="do", model="m")
        assert rm.steps["q"]["status"] == "blocked"          # ask parked
        assert rm.steps["final"]["status"] != "completed"     # gated behind q

        await svc.converse_turn(session_id="S", user_id="u", message="add a check before final", model="m")
    g_id = next(k for k, v in rm.steps.items() if v["title"] == "GATE")
    # re-parent: final now waits on the gate; the gate inherited final's old dep (q)
    assert g_id in (rm.steps["final"]["depends_on"] or "")
    assert "q" in (rm.steps[g_id]["depends_on"] or "")
    # neither ran yet — both still gated behind the (blocked) ask, not a parallel branch
    assert rm.steps["final"]["status"] != "completed"
    assert rm.steps[g_id]["status"] != "completed"


if __name__ == "__main__":
    asyncio.run(test_converse_adds_and_runs_step())
    asyncio.run(test_converse_direct_answer())
    asyncio.run(test_runtime_create_task_spawns_and_runs())
    asyncio.run(test_converse_insert_before_gates_existing_step())
    print("OK")
