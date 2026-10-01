"""LgService end-to-end wiring (offline): plan_turn projects + runs + parks,
resume_turn resumes the claimed wait. Uses a fake orchestrator (no ADK planner /
DB) + a FakeReadModel mirroring plan_steps/mail_waits + a real AsyncSqliteSaver.
"""
from __future__ import annotations

import asyncio

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


class FakeReadModel:
    def __init__(self):
        self.plan = None
        self.steps = {}
        self.session_status = None
        self.waits = {}
        self.messages = []

    async def ensure_session(self, sid, uid, x, status):
        self.session_status = status

    async def add_message(self, mid, sid, role, content, turn_id=None):
        self.messages.append((role, content))

    async def upsert_plan(self, sid, pid, title, goal, status, *, executor_id=None, executor_name=None):
        self.plan = {"id": pid, "title": title, "goal": goal, "status": status,
                     "executor_id": executor_id, "executor_name": executor_name}

    async def upsert_steps(self, sid, steps):
        cols = ("step_id", "ordinal", "wave", "status", "kind", "question", "title",
                "description", "depends_on", "assignee", "assignee_name",
                "assignee_role", "is_persona", "is_dynamic_delegate")
        for s in steps:
            row = dict(zip(cols, s)); row.setdefault("result", None); row.setdefault("interrupt_id", None)
            self.steps[row["step_id"]] = row

    async def set_step_status(self, sid, step_id, status, *, result=None, blocked_reason=None, interrupt_id=None):
        r = self.steps[step_id]; r["status"] = status
        if result is not None: r["result"] = result
        r["blocked_reason"] = blocked_reason; r["interrupt_id"] = interrupt_id

    async def set_session_status(self, sid, status): self.session_status = status
    async def set_waiting(self, sid, iid): self.session_status = "waiting"

    async def snapshot(self, sid):
        steps = sorted(self.steps.values(), key=lambda r: r["ordinal"])
        return {"session": {"id": sid, "status": self.session_status,
                            "interrupt_id": None}, "plan": self.plan, "steps": steps}

    async def register_mail_wait(self, token, *, session_id, step_id, user_id, **kw):
        self.waits[token] = {"token": token, "session_id": session_id, "step_id": step_id,
                             "interrupt_id": None, "status": "waiting",
                             "conversation_id": kw.get("conversation_id"),
                             "expected_from": kw.get("expected_from")}

    async def bind_mail_wait_interrupt(self, sid, step_id, iid):
        for w in self.waits.values():
            if w["session_id"] == sid and w["step_id"] == step_id and w["status"] == "waiting":
                w["interrupt_id"] = iid

    async def mail_wait_target(self, sid, step_id):
        for w in self.waits.values():
            if w["session_id"] == sid and w["step_id"] == step_id and w["status"] == "waiting":
                return (w["conversation_id"], w["expected_from"])
        return None

    async def cancel_mail_wait(self, sid, step_id):
        for w in self.waits.values():
            if w["session_id"] == sid and w["step_id"] == step_id and w["status"] == "waiting":
                w["status"] = "cancelled"

    async def claim_mail_wait(self, token, reply_from=None):
        w = self.waits.get(token)
        if not w or w["status"] != "waiting" or w["interrupt_id"] is None:
            return None
        w["status"] = "matched"; return dict(w)


class FakeOrch:
    """Stands in for OrchestratorService: LgService reuses _make_plan +
    _project_plan + _add_message/_add_error_message/_assistant_answer +
    fail_session + expire_mail_waits."""
    def __init__(self, rm, plan):
        self._rm = rm; self._plan = plan

    async def _make_plan(self, sid, uid, message, *, planner_model=None,
                         planner_prompt=None, planner_connectors=None,
                         plan_session=None, requester=None):
        return self._plan

    async def _add_message(self, sid, role, content):
        if content:
            await self._rm.add_message("m", sid, role, content)

    async def _add_error_message(self, sid, content, title=None):
        if content:
            await self._rm.add_message("m", sid, "assistant", content)

    @staticmethod
    def _assistant_answer(plan):
        depended = {d for s in plan.steps for d in s.depends_on}
        terminals = [s.result for s in plan.steps if s.id not in depended and s.result]
        parts = terminals or [s.result for s in plan.steps if s.result]
        return "\n\n".join(parts)

    async def _project_plan(self, sid, plan, uid):
        await self._rm.upsert_plan(sid, plan.id, plan.title, plan.goal, "running",
                                   executor_id=plan.executor_id, executor_name=plan.executor_name)
        rows = [(s.id, i, s.wave, s.status.value, s.kind, s.question or "", s.title or "",
                 s.description or "", ",".join(s.depends_on), "", "", "",
                 s.is_persona, s.is_dynamic_delegate) for i, s in enumerate(plan.steps)]
        await self._rm.upsert_steps(sid, rows)
        for s in plan.steps:                      # mirrors _register_mail_waits
            if s.kind == "await_reply":
                await self._rm.register_mail_wait(f"YW-{s.id}", session_id=sid,
                                                  step_id=s.id, user_id=uid,
                                                  conversation_id=f"chat-{s.id}")

    async def fail_session(self, sid, exc): pass
    async def expire_mail_waits(self): return 0


async def test_lgservice_plan_then_resume():
    plan = Plan(id="pl", title="T", goal="G", status=Status.PENDING, steps=[
        Step(id="pl_send", title="SEND", description="mail X", depends_on=[]),
        Step(id="pl_wait", title="WAIT", kind="await_reply", depends_on=["pl_send"]),
        Step(id="pl_act", title="ACT", description="act on reply", depends_on=["pl_wait"]),
    ])
    rm = FakeReadModel()
    model = EchoModel()
    async with AsyncSqliteSaver.from_conn_string(":memory:") as saver:
        await saver.setup()
        svc = LgService(FakeOrch(rm, plan), rm, saver, model=model)

        await svc.plan_turn(session_id="S", user_id="u", message="do it", model="m")
        assert rm.steps["pl_send"]["status"] == "completed"
        assert rm.steps["pl_wait"]["status"] == "blocked"
        assert rm.session_status == "blocked"

        wait = await rm.claim_mail_wait("YW-pl_wait", "reviewer@example.com")
        assert wait and wait["interrupt_id"]

        out = await svc.resume_turn(session_id="S", user_id="u", answer="REPLY!",
                                    model="m", step_id=wait["step_id"],
                                    interrupt_id=wait["interrupt_id"])
        # await step is LLM-powered now: it processes the reply itself
        assert "REPLY!" in model.seen["WAIT"]
        assert rm.steps["pl_wait"]["status"] == "completed"
        assert rm.steps["pl_act"]["status"] == "completed"
        assert out.step("pl_act") is not None
        # the assistant reply was posted to chat on completion
        assert ("assistant", "DONE_ACT") in rm.messages
        assert rm.session_status == "completed"


async def test_lgservice_direct_answer():
    """A no-step plan with an answer (chit-chat 'hi') must post the reply."""
    plan = Plan(id="pl", title="", goal="", status=Status.PENDING, steps=[])
    plan.answer = "Bonjour ! Comment puis-je aider ?"
    rm = FakeReadModel()
    async with AsyncSqliteSaver.from_conn_string(":memory:") as saver:
        await saver.setup()
        svc = LgService(FakeOrch(rm, plan), rm, saver, model=EchoModel())
        await svc.plan_turn(session_id="S", user_id="u", message="hi", model="m")
    assert ("assistant", "Bonjour ! Comment puis-je aider ?") in rm.messages
    assert rm.session_status == "completed"


if __name__ == "__main__":
    asyncio.run(test_lgservice_plan_then_resume())
    asyncio.run(test_lgservice_direct_answer())
    print("OK")
