import asyncio
import uuid
from typing import Any

from google.adk.agents.context import Context
from google.adk.agents.llm_agent import LlmAgent
from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_response import LlmResponse
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.adk.workflow import FunctionNode, START, Workflow
from google.genai import types
from pydantic import BaseModel


class _Scripted(BaseLlm):
    def __init__(self, label: str, parts: list[Any]):
        super().__init__(model=f"scripted-{label}")
        object.__setattr__(self, "_label", label)
        object.__setattr__(self, "_parts", list(parts))
        object.__setattr__(self, "requests", [])

    async def generate_content_async(self, req, stream=False):
        self.requests.append(req)
        idx = min(len(self.requests) - 1, len(self._parts) - 1)
        item = self._parts[idx]
        if callable(item):
            item = item(req)
        yield LlmResponse(content=types.Content(role="model", parts=[item]))


class In(BaseModel):
    task: str


def _fc(name, args):
    return types.Part(function_call=types.FunctionCall(name=name, args=args, id=f"fc_{uuid.uuid4().hex[:8]}"))


def _text(t):
    return types.Part(text=t)


async def main():
    class _Child(BaseLlm):
        def __init__(self):
            super().__init__(model="scripted-child")

        async def generate_content_async(self, req, stream=False):
            yield LlmResponse(content=types.Content(role="model", parts=[_text("CHILD ANSWER")]))

    child = LlmAgent(name="child", model=_Child())

    async def agent_call_fn(ctx: Context, task: str) -> dict:
        out = await ctx.run_node(
            child,
            node_input=types.Content(role="user", parts=[_text(task)]),
            run_id="exec_abc",
            use_sub_branch=True,
            raise_on_wait=True,
        )
        return {"out_type": type(out).__name__, "out_repr": repr(out)[:400]}

    wf = Workflow(
        name="delegate",
        edges=[(START, FunctionNode(func=agent_call_fn, name="n", parameter_binding="node_input", rerun_on_resume=True))],
        input_schema=In,
    )
    print("Workflow description field:", "description" in getattr(Workflow, "model_fields", {}))

    def _echo(req):
        txt = ""
        for c in reversed(req.contents or []):
            for p in reversed(c.parts or []):
                fr = getattr(p, "function_response", None)
                if fr is not None:
                    txt = "RESP:" + str(fr.response)
                    return _text(txt)
        return _text("no-response")

    root = LlmAgent(
        name="root",
        model=_Scripted("root", [_fc("delegate", {"task": "x"}), _echo]),
        tools=[wf],
    )
    sessions = InMemorySessionService()
    runner = Runner(node=root, app_name="app", session_service=sessions)
    await sessions.create_session(app_name="app", user_id="u", session_id="s")
    events = []
    async for ev in runner.run_async(user_id="u", session_id="s", new_message=types.Content(role="user", parts=[_text("go")])):
        events.append(ev)
    final = [e for e in events if e.is_final_response()]
    print("final text:", final[-1].content.parts[0].text[:300] if final and final[-1].content else "NONE")


asyncio.run(main())
