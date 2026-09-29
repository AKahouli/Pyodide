"""Tool-calling loop in an execute node (offline, fake model + fake LC tool).

Proves: the node binds tools, executes a tool call the model emits, feeds the
ToolMessage back, and returns the model's final text once it stops calling tools.
"""
from __future__ import annotations

import asyncio

from langchain_core.messages import AIMessage
from langchain_core.tools import tool
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

from src.companion_ai.lg.runner import LgRunner
from src.companion_ai.plan import Plan, Step

_calls = []


@tool
def lookup(city: str) -> str:
    """Return the weather for a city."""
    _calls.append(city)
    return f"sunny in {city}"


class ToolThenAnswerModel:
    """First .ainvoke -> a tool call; second -> a final answer citing the result.
    bind_tools returns self (the tools are known to the test)."""
    def bind_tools(self, tools):
        return self

    async def ainvoke(self, messages):
        has_tool_result = any(getattr(m, "type", "") == "tool" for m in messages)
        if not has_tool_result:
            return AIMessage(content="", tool_calls=[
                {"name": "lookup", "args": {"city": "Paris"}, "id": "c1"}])
        last_tool = next(m for m in reversed(messages) if getattr(m, "type", "") == "tool")
        return AIMessage(content=f"final: {last_tool.content}")


async def test_execute_node_runs_tool_loop():
    _calls.clear()
    plan = Plan(id="p", title="t", goal="g", steps=[
        Step(id="s1", title="S1", description="check weather in Paris"),
    ])
    runner = LgRunner("fake", read_model=None, tools_for=lambda step: [lookup])
    async with AsyncSqliteSaver.from_conn_string(":memory:") as saver:
        await saver.setup()
        res = await runner.run(plan, "s-tool", saver, model=ToolThenAnswerModel())
    assert _calls == ["Paris"]                          # tool actually executed
    assert res["values"]["results"]["s1"] == "final: sunny in Paris"


async def test_execute_node_no_tools_single_call():
    """No tools -> plain single model call, no bind_tools needed."""
    class Plain:
        async def ainvoke(self, messages):
            return AIMessage(content="done")

    plan = Plan(id="p", title="t", goal="g",
                steps=[Step(id="s1", title="S1", description="x")])
    runner = LgRunner("fake", read_model=None)  # no tools_for
    async with AsyncSqliteSaver.from_conn_string(":memory:") as saver:
        await saver.setup()
        res = await runner.run(plan, "s-notool", saver, model=Plain())
    assert res["values"]["results"]["s1"] == "done"


async def test_tool_produced_file_becomes_artifact():
    """A tool result carrying a storage path must be projected as a step artifact
    (ADK _capture_artifacts parity)."""
    arts = []

    @tool
    def make_chart(title: str) -> str:
        """Generate a chart and return its storage info as JSON."""
        import json
        return json.dumps({"ceph_path": "s3://bucket/chart.png",
                           "filename": "chart.png", "mime_type": "image/png"})

    class ToolThenDone:
        def bind_tools(self, tools):
            return self

        async def ainvoke(self, messages):
            if any(getattr(m, "type", "") == "tool" for m in messages):
                return AIMessage(content="done")
            return AIMessage(content="", tool_calls=[
                {"name": "make_chart", "args": {"title": "Q3"}, "id": "c1"}])

    class RM:
        async def upsert_plan(self, *a, **k): pass
        async def upsert_steps(self, *a, **k): pass
        async def set_session_status(self, *a, **k): pass
        async def set_step_status(self, *a, **k): pass
        async def add_step_artifact(self, sid, step_id, **art):
            arts.append((step_id, art))

    plan = Plan(id="p", title="t", goal="g", steps=[Step(id="s1", title="S1", description="chart")])
    runner = LgRunner("fake", read_model=RM(), tools_for=lambda s: [make_chart])
    async with AsyncSqliteSaver.from_conn_string(":memory:") as saver:
        await saver.setup()
        await runner.run(plan, "s-art", saver, model=ToolThenDone())
    assert len(arts) == 1
    sid, art = arts[0]
    assert sid == "s1"
    assert art["file_path"] == "s3://bucket/chart.png"
    assert art["filename"] == "chart.png"
    assert art["artifact_kind"] == "image"


async def test_persona_step_injects_assignee_fact():
    """A persona step injects only the FACT of who it's assigned to (into the human
    turn) — no hardcoded behavior guidance in code; that lives in the agentstore
    prompt. A plain step gets no assignee line."""
    seen = {}

    class CaptureModel:
        async def ainvoke(self, messages):
            seen["human"] = messages[-1].content
            return AIMessage(content="ok")

    class RM:
        async def upsert_plan(self, *a, **k): pass
        async def upsert_steps(self, *a, **k): pass
        async def set_session_status(self, *a, **k): pass
        async def set_step_status(self, *a, **k): pass

    plan = Plan(id="p", title="t", goal="g", steps=[
        Step(id="s1", title="Validate", description="manager decision",
             is_persona=True, assignee_name="Reviewer", assignee_role="Manager"),
    ])
    runner = LgRunner("fake", read_model=RM())
    async with AsyncSqliteSaver.from_conn_string(":memory:") as saver:
        await saver.setup()
        await runner.run(plan, "s-persona", saver, model=CaptureModel())
    assert "Reviewer" in seen["human"] and "Manager" in seen["human"]
    # plain step: no assignee line
    seen.clear()
    plan2 = Plan(id="p", title="t", goal="g", steps=[Step(id="s1", title="X", description="do x")])
    async with AsyncSqliteSaver.from_conn_string(":memory:") as saver:
        await saver.setup()
        await runner.run(plan2, "s-plain", saver, model=CaptureModel())
    assert "assignée à" not in seen["human"]


async def test_step_failed_sentinel_marks_step_failed():
    """A node whose model self-reports STEP_FAILED must be projected 'failed',
    not 'completed' (ADK parity)."""
    calls = []

    class FailModel:
        async def ainvoke(self, messages):
            return AIMessage(content="STEP_FAILED: could not verify addresses")

    class RM:
        async def upsert_plan(self, *a, **k): pass
        async def upsert_steps(self, *a, **k): pass
        async def set_session_status(self, *a, **k): pass
        async def set_step_status(self, sid, step_id, status, *, result=None, **k):
            calls.append((step_id, status))

    plan = Plan(id="p", title="t", goal="g", steps=[Step(id="s1", title="S1", description="x")])
    runner = LgRunner("fake", read_model=RM())
    async with AsyncSqliteSaver.from_conn_string(":memory:") as saver:
        await saver.setup()
        await runner.run(plan, "s-fail", saver, model=FailModel())
    assert ("s1", "failed") in calls
    assert ("s1", "completed") not in calls


def test_injected_context_param_is_stripped():
    """A connector tool with an ADK-injected context param must convert to an
    OpenAI tool schema (what bind_tools does) without choking on the non-JSON
    Context class, and the model-facing schema must NOT expose it."""
    from langchain_core.utils.function_calling import convert_to_openai_tool
    from src.companion_ai.lg.tools import _to_lc_tool

    class ToolContext:  # stand-in for google.adk.agents.context.Context
        pass

    async def github_add_comment(*, path: str, body: str, tool_context: "ToolContext" = None):
        return "ok"

    class RawTool:
        func = staticmethod(github_add_comment)
        name = "github_add_comment"
        description = "add a comment"

    lc = _to_lc_tool(RawTool())
    schema = convert_to_openai_tool(lc)          # must not raise
    props = schema["function"]["parameters"]["properties"]
    assert "tool_context" not in props           # injected param hidden from the model
    assert {"path", "body"} <= set(props)


if __name__ == "__main__":
    asyncio.run(test_execute_node_runs_tool_loop())
    asyncio.run(test_execute_node_no_tools_single_call())
    test_injected_context_param_is_stripped()
    print("OK")
