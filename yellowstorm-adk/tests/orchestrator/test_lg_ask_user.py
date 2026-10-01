"""ask_user: a step that needs input to finish its OWN work suspends IN PLACE
(no interrupt), a sibling branch keeps running through it, and the SAME step
resumes with the answer on re-drive.

Distinct from a planned `kind='ask'` step (its own node, answer flows downstream)
and from create_task(kind='ask') (spawns a DOWNSTREAM ask). Here the answer comes
back INTO the asking step.

    <venv>/bin/python -m pytest tests/orchestrator/test_lg_ask_user.py -q
"""
from __future__ import annotations

import asyncio
from collections import defaultdict

from langchain_core.messages import AIMessage
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

from src.companion_ai.langgraph.runner import LgRunner
from src.companion_ai.plan import Plan, Step


class AskModel:
    """DRAFT calls ask_user then drafts with the answer; SLOW is a slow sibling;
    everything else just completes."""
    def __init__(self):
        self.seen = {}
        self.calls = defaultdict(int)

    def bind_tools(self, tools):
        return self

    async def ainvoke(self, messages):
        human = next((m.content for m in messages
                      if getattr(m, "type", "") == "human"), "")
        title = next((l[len("Étape : "):].strip() for l in human.splitlines()
                      if l.startswith("Étape : ")), "")
        self.calls[title] += 1
        tool_msgs = [m for m in messages if getattr(m, "type", "") == "tool"]
        if title == "DRAFT":
            if tool_msgs:                       # ask_user returned the answer
                answer = tool_msgs[-1].content
                self.seen["DRAFT"] = answer
                return AIMessage(content=f"DRAFTED_TO::{answer}")
            return AIMessage(content="", tool_calls=[{
                "name": "ask_user", "args": {"question": "quel destinataire ?"},
                "id": "au1"}])
        if title == "SLOW":
            await asyncio.sleep(0.12)
        self.seen[title] = human
        return AIMessage(content=f"DONE_{title}")


async def test_ask_user_suspends_in_place_sibling_runs_then_resumes():
    plan = Plan(id="p", title="t", goal="g", steps=[
        Step(id="draft", title="DRAFT", description="draft the mail", depends_on=[]),
        Step(id="send", title="SEND", description="send it", depends_on=["draft"]),
        # independent slow sibling — must run to completion while draft is parked
        Step(id="slow", title="SLOW", description="slow work", depends_on=[]),
        Step(id="slow2", title="SLOW2", description="after slow", depends_on=["slow"]),
    ])
    runner = LgRunner("fake", read_model=None)
    model = AskModel()
    async with AsyncSqliteSaver.from_conn_string(":memory:") as saver:
        await saver.setup()
        r1 = await runner.run(plan, "s-au", saver, model=model)
        # draft suspended in place, parked as an ask carrying its DYNAMIC question
        assert [p[1] for p in r1["parked"]] == ["draft"], r1["parked"]
        assert r1["questions"]["draft"] == "quel destinataire ?", r1["questions"]
        assert not r1["done"]
        res1 = r1["values"]["results"]
        assert "draft" not in res1 and "send" not in res1     # asking branch held
        assert res1.get("slow") == "DONE_SLOW"                # sibling ran THROUGH it
        assert res1.get("slow2") == "DONE_SLOW2"              # ...to completion
        assert model.calls["DRAFT"] == 1                       # asked once, then suspended

        # answer it -> the SAME step resumes and finishes; downstream runs
        r2 = await runner.resume("s-au", "draft", "boss@example.com", saver, model=model)
        assert r2["done"], r2
        res2 = r2["values"]["results"]
        assert res2["draft"] == "DRAFTED_TO::boss@example.com"   # same step, resumed
        assert res2["send"] == "DONE_SEND"                       # downstream ran after
        assert model.seen["DRAFT"] == "boss@example.com"        # the LLM saw the answer
        assert model.calls["DRAFT"] == 3    # drive1: 1 (ask+suspend); drive2: 2 (ask, then draft)


class TwoAskModel:
    """Two independent steps that each call ask_user, plus their downstreams."""
    def __init__(self):
        self.calls = defaultdict(int)

    def bind_tools(self, tools):
        return self

    async def ainvoke(self, messages):
        human = next((m.content for m in messages
                      if getattr(m, "type", "") == "human"), "")
        title = next((l[len("Étape : "):].strip() for l in human.splitlines()
                      if l.startswith("Étape : ")), "")
        self.calls[title] += 1
        tool_msgs = [m for m in messages if getattr(m, "type", "") == "tool"]
        if title in ("A", "B"):
            if tool_msgs:
                return AIMessage(content=f"{title}_DONE::{tool_msgs[-1].content}")
            return AIMessage(content="", tool_calls=[{
                "name": "ask_user", "args": {"question": f"valeur pour {title} ?"},
                "id": f"au_{title}"}])
        return AIMessage(content=f"DONE_{title}")


async def test_answering_one_parallel_ask_does_not_rerun_the_other():
    """The bug the live run hit: answering one open ask re-drove the plan and
    RE-RAN the other parked ask (card flickered/could diverge). With the durable
    `asked` set, the other ask is NOT re-run until its own answer arrives."""
    plan = Plan(id="p", title="t", goal="g", steps=[
        Step(id="a", title="A", description="ask A", depends_on=[]),
        Step(id="b", title="B", description="ask B", depends_on=[]),
    ])
    runner = LgRunner("fake", read_model=None)
    model = TwoAskModel()
    async with AsyncSqliteSaver.from_conn_string(":memory:") as saver:
        await saver.setup()
        r1 = await runner.run(plan, "s-2ask", saver, model=model)
        assert sorted(p[1] for p in r1["parked"]) == ["a", "b"], r1["parked"]
        assert model.calls["A"] == 1 and model.calls["B"] == 1

        # answer A only
        r2 = await runner.resume("s-2ask", "a", "va", saver, model=model)
        assert not r2["done"]                                  # B still open
        assert [p[1] for p in r2["parked"]] == ["b"], r2["parked"]
        assert r2["values"]["results"]["a"] == "A_DONE::va"    # A finished
        assert "b" not in r2["values"]["results"]             # B still parked
        assert model.calls["A"] == 3                           # A: ask+suspend, then ask+done
        assert model.calls["B"] == 1                           # B NOT re-run by A's answer

        # now answer B
        r3 = await runner.resume("s-2ask", "b", "vb", saver, model=model)
        assert r3["done"]
        assert r3["values"]["results"]["b"] == "B_DONE::vb"
        assert model.calls["B"] == 3


if __name__ == "__main__":
    asyncio.run(test_ask_user_suspends_in_place_sibling_runs_then_resumes())
    asyncio.run(test_answering_one_parallel_ask_does_not_rerun_the_other())
    print("OK  ask_user suspends in place; sibling runs; same step resumes; "
          "answering one ask doesn't re-run the other")
