"""Increment 2 (HITL) checks for the LangGraph orchestrator.

Offline: fake chat model + a FakeReadModel that mirrors the real plan_steps +
mail_waits SQL semantics (so the reply-correlation wiring is exercised too) +
a real AsyncSqliteSaver. Proves:
  1. ask: park -> waiting(interrupt_id) -> resume -> downstream acts on the answer,
  2. await_reply: send -> park -> claim_mail_wait(token) -> resume -> act on reply,
  3. multi-await: two parked awaits, resume ONLY the second by its interrupt id;
     the first stays parked and its branch does not advance.
"""
from __future__ import annotations

import asyncio
from email.utils import parseaddr

from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

from src.companion_ai.lg.runner import LgRunner
from src.companion_ai.plan import Plan, Step


class EchoCtxModel:
    """Returns DONE_<title>; also records each node's full prompt so we can assert
    that a dependent received an upstream (or reply) result in its context."""
    def __init__(self):
        self.seen = {}

    async def ainvoke(self, messages):
        human = messages[-1].content
        title = next((l[len("Étape : "):].strip() for l in human.splitlines()
                      if l.startswith("Étape : ")), "")
        self.seen[title] = human
        await asyncio.sleep(0)

        class _R:
            content = f"DONE_{title}"
        return _R()


class FakeReadModel:
    """In-memory mirror of the parts of ReadModel the runner touches."""
    def __init__(self):
        self.plan = None
        self.steps = {}          # step_id -> row dict
        self.session_status = None
        self.waiting_iid = None
        self.waits = {}          # token -> mail_wait row

    # ---- plan_steps ----
    async def upsert_plan(self, session_id, plan_id, title, goal, status, *,
                          executor_id=None, executor_name=None):
        self.plan = {"id": plan_id, "title": title, "goal": goal, "status": status,
                     "executor_id": executor_id, "executor_name": executor_name}

    async def upsert_steps(self, session_id, steps):
        cols = ("step_id", "ordinal", "wave", "status", "kind", "question", "title",
                "description", "depends_on", "assignee", "assignee_name",
                "assignee_role", "is_persona", "is_dynamic_delegate")
        for s in steps:
            row = dict(zip(cols, s))
            row.setdefault("result", None)
            row.setdefault("interrupt_id", None)
            self.steps[row["step_id"]] = row

    async def set_step_status(self, session_id, step_id, status, *, result=None,
                              blocked_reason=None, interrupt_id=None):
        row = self.steps[step_id]
        row["status"] = status
        if result is not None:                 # COALESCE(new, old)
            row["result"] = result
        row["blocked_reason"] = blocked_reason
        row["interrupt_id"] = interrupt_id     # written as given (None clears)

    async def set_session_status(self, session_id, status):
        self.session_status = status

    async def set_waiting(self, session_id, interrupt_id):
        self.session_status = "waiting"
        self.waiting_iid = interrupt_id

    async def snapshot(self, session_id):
        steps = sorted(self.steps.values(), key=lambda r: r["ordinal"])
        return {"session": {"id": session_id}, "plan": self.plan, "steps": steps}

    # ---- mail_waits ----
    async def register_mail_wait(self, token, *, session_id, step_id, user_id,
                                 interrupt_id=None, expected_from=None,
                                 conversation_id=None, **kw):
        self.waits[token] = {"token": token, "session_id": session_id,
                             "step_id": step_id, "interrupt_id": interrupt_id,
                             "status": "waiting", "expected_from": expected_from,
                             "conversation_id": conversation_id}

    async def bind_mail_wait_interrupt(self, session_id, step_id, interrupt_id):
        for w in self.waits.values():
            if (w["session_id"] == session_id and w["step_id"] == step_id
                    and w["status"] == "waiting"):
                w["interrupt_id"] = interrupt_id

    async def claim_mail_wait(self, token, reply_from=None):
        w = self.waits.get(token)
        if not w or w["status"] != "waiting" or w["interrupt_id"] is None:
            return None
        if w["expected_from"]:
            addr = parseaddr(reply_from or "")[1].lower()
            allowed = [a.strip() for a in w["expected_from"].lower().split(",")]
            if addr not in allowed:
                return None
        w["status"] = "matched"
        return dict(w)


def _await_branch(prefix, dep_start=None):
    send = Step(id=f"{prefix}send", title=f"{prefix}SEND", description="send mail",
                depends_on=[dep_start] if dep_start else [])
    wait = Step(id=f"{prefix}wait", title=f"{prefix}WAIT", kind="await_reply",
                description="await the reply", depends_on=[send.id])
    act = Step(id=f"{prefix}act", title=f"{prefix}ACT", description="act on reply",
               depends_on=[wait.id])
    return [send, wait, act]


async def test_ask_park_and_resume():
    plan = Plan(id="p", title="t", goal="g", steps=[
        Step(id="q", title="Q", kind="ask", question="approve?"),
        Step(id="after", title="AFTER", description="use the answer", depends_on=["q"]),
    ])
    rm = FakeReadModel()
    runner = LgRunner("fake", read_model=rm)
    model = EchoCtxModel()
    async with AsyncSqliteSaver.from_conn_string(":memory:") as saver:
        await saver.setup()
        r1 = await runner.run(plan, "s-ask", saver, model=model)
        assert len(r1["parked"]) == 1 and not r1["done"]
        iid, sid, kind = r1["parked"][0]
        assert (sid, kind) == ("q", "ask")
        assert rm.session_status == "waiting" and rm.waiting_iid == iid
        assert rm.steps["q"]["status"] == "blocked"

        r2 = await runner.resume("s-ask", iid, "YES", saver, model=model)
        assert r2["done"] and not r2["parked"]
        assert rm.steps["q"]["status"] == "completed"
        assert rm.steps["q"]["result"] == "YES"
        assert rm.session_status == "completed"
        assert "YES" in model.seen["AFTER"]        # downstream got the answer


async def test_await_reply_claim_and_resume():
    plan = Plan(id="p", title="t", goal="g", steps=_await_branch(""))
    rm = FakeReadModel()
    await rm.register_mail_wait("YW-TOK", session_id="s-mail", step_id="wait",
                                user_id="u", expected_from="reviewer@example.com")
    runner = LgRunner("fake", read_model=rm)
    model = EchoCtxModel()
    async with AsyncSqliteSaver.from_conn_string(":memory:") as saver:
        await saver.setup()
        r1 = await runner.run(plan, "s-mail", saver, model=model)
        assert [p[1] for p in r1["parked"]] == ["wait"]
        assert rm.steps["send"]["status"] == "completed"   # send ran before parking
        assert rm.session_status == "blocked"

        # wrong sender is rejected
        assert await rm.claim_mail_wait("YW-TOK", "stranger@x.com") is None
        wait = await rm.claim_mail_wait("YW-TOK", "Reviewer <reviewer@example.com>")
        assert wait and wait["step_id"] == "wait"

        r2 = await runner.deliver_reply("s-mail", wait["step_id"],
                                        "REPLY_BODY", saver, model=model)
        assert r2["done"]
        # the await step is now LLM-powered: it processes the reply itself
        assert "REPLY_BODY" in model.seen["WAIT"]           # await LLM saw the reply
        assert "REPLY_BODY" in model.seen["ACT"]            # fix A: reply propagates downstream
        assert rm.steps["wait"]["status"] == "completed"
        assert rm.steps["act"]["status"] == "completed"


async def test_multi_await_join_targeted_resume():
    """Real worky shape: two parallel send->await branches fanning into a report
    that needs BOTH replies. Replies arrive at different times; each reply is
    routed to its own step (state-driven, no interrupt); the report runs only once
    both are in, and delivering one reply does NOT touch the other branch."""
    plan = Plan(id="p", title="t", goal="g", steps=[
        Step(id="asend", title="ASEND", description="mail A", depends_on=[]),
        Step(id="aw", title="AW", kind="await_reply", depends_on=["asend"]),
        Step(id="bsend", title="BSEND", description="mail B", depends_on=[]),
        Step(id="bw", title="BW", kind="await_reply", depends_on=["bsend"]),
        Step(id="rep", title="REP", description="report", depends_on=["aw", "bw"]),
    ])
    rm = FakeReadModel()
    await rm.register_mail_wait("TOK-A", session_id="s2", step_id="aw", user_id="u")
    await rm.register_mail_wait("TOK-B", session_id="s2", step_id="bw", user_id="u")
    runner = LgRunner("fake", read_model=rm)
    model = EchoCtxModel()
    async with AsyncSqliteSaver.from_conn_string(":memory:") as saver:
        await saver.setup()
        r1 = await runner.run(plan, "s2", saver, model=model)
        assert sorted(p[1] for p in r1["parked"]) == ["aw", "bw"]

        # reply A arrives first
        wa = await rm.claim_mail_wait("TOK-A")
        r2 = await runner.deliver_reply("s2", wa["step_id"], "REPLY_A", saver, model=model)
        assert not r2["done"]                          # report still waits for B
        assert [p[1] for p in r2["parked"]] == ["bw"]  # only B waiting now
        assert "REPLY_A" in model.seen["AW"]           # await A's LLM saw the reply
        assert rm.steps["aw"]["status"] == "completed"
        assert rm.steps["rep"]["status"] == "pending"

        # reply B arrives; only B's branch advances
        wb = await rm.claim_mail_wait("TOK-B")
        r3 = await runner.deliver_reply("s2", wb["step_id"], "REPLY_B", saver, model=model)
        assert r3["done"]
        assert "REPLY_B" in model.seen["BW"]           # await B's LLM saw the reply
        assert rm.steps["rep"]["status"] == "completed"
        # report saw BOTH awaits' processed results in its context
        assert "DONE_AW" in model.seen["REP"] and "DONE_BW" in model.seen["REP"]


async def test_await_spawn_inserts_before_dependent_and_reparents():
    """The core win of the loop engine (fixes the lost-reply + wrong-order bug):
    an await whose reply demands a manager validation SPAWNS it; the loop inserts
    that step BEFORE the downstream step, re-points the downstream onto it, and the
    downstream runs AFTER the validation and can SEE it. In the old topology build
    the spawn was a late sibling and the downstream ran blind."""
    from langchain_core.messages import AIMessage

    seen = {}

    class Model:
        def bind_tools(self, tools):
            return self

        async def ainvoke(self, messages):
            human = next((m.content for m in messages
                          if getattr(m, "type", "") == "human"), "")
            title = next((l[len("Étape : "):].strip() for l in human.splitlines()
                          if l.startswith("Étape : ")), "")
            seen[title] = human
            has_tool = any(getattr(m, "type", "") == "tool" for m in messages)
            if title == "AW" and not has_tool:           # await: reply needs a manager
                return AIMessage(content="", tool_calls=[{
                    "name": "delegate_to_human_agent",
                    "args": {"agent_name": "Manager", "task": "Valider l'analyse"},
                    "id": "c1"}])
            if title == "AW":
                return AIMessage(content="Délégué au manager pour validation.")
            if title.startswith("Demander à Manager"):    # the spawned validation step
                return AIMessage(content="VALIDATION_OK")
            return AIMessage(content=f"DONE_{title}")

    plan = Plan(id="p", title="t", goal="g", steps=[
        Step(id="send", title="SEND", description="send mail", depends_on=[]),
        Step(id="aw", title="AW", kind="await_reply", description="await", depends_on=["send"]),
        Step(id="dep", title="DEP", description="update from the reply", depends_on=["aw"]),
    ])
    rm = FakeReadModel()
    await rm.register_mail_wait("YW-AW", session_id="s", step_id="aw", user_id="u")
    runner = LgRunner("fake", read_model=rm)
    model = Model()
    async with AsyncSqliteSaver.from_conn_string(":memory:") as saver:
        await saver.setup()
        r1 = await runner.run(plan, "s", saver, model=model)
        assert [p[1] for p in r1["parked"]] == ["aw"]
        w = await rm.claim_mail_wait("YW-AW")
        r2 = await runner.deliver_reply("s", w["step_id"],
                                        "Il faut la validation du manager", saver, model=model)
        assert r2["done"]

    # a manager step was spawned and ran
    mgr = [s for s in rm.steps.values() if (s["title"] or "").startswith("Demander à Manager")]
    assert len(mgr) == 1 and mgr[0]["status"] == "completed"
    mgr_id = mgr[0]["step_id"]
    # the downstream step was re-parented onto it, ran after, and SAW the validation
    assert mgr_id in rm.steps["dep"]["depends_on"]        # re-parented (blocking insert)
    assert rm.steps["dep"]["status"] == "completed"
    assert "VALIDATION_OK" in seen["DEP"]                 # dep ran AFTER manager, saw it


if __name__ == "__main__":
    for t in (test_ask_park_and_resume, test_await_reply_claim_and_resume,
              test_multi_await_join_targeted_resume,
              test_await_spawn_inserts_before_dependent_and_reparents):
        asyncio.run(t())
    print("OK")
