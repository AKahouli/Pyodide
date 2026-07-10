"""Block-and-ask HITL — proven on the real ADK engine (no LLM).

A node blocks requesting input; the turn interrupts; we resume with the user's
answer and the node continues with it. Runs under the project venv.

    <adk venv>/bin/python tests/orchestrator/test_hitl.py
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from google.adk.runners import InMemoryRunner
from google.genai import types

from src.companion_ai import hitl
from google.adk.workflow import Workflow, START


async def _run():
    node = hitl.make_ask_user_node("ask", "Which format? pdf or docx")
    wf = Workflow(name="hitl_test", edges=[(START, node)])
    r = InMemoryRunner(node=wf, app_name="h")
    await r.session_service.create_session(app_name="h", user_id="u", session_id="s")

    # 1) run -> should block requesting input
    ids = []
    async for ev in r.run_async(user_id="u", session_id="s",
            new_message=types.Content(role="user", parts=[types.Part(text="go")])):
        ids += hitl.interrupt_ids(ev)
    assert ids, "expected a request-input interrupt"

    # 2) resume with the answer -> node continues and stores it in state
    got = {}
    part = hitl.resume_part(ids[0], {"value": "pdf"})
    async for ev in r.run_async(user_id="u", session_id="s",
            new_message=types.Content(role="user", parts=[part])):
        if ev.actions and ev.actions.state_delta:
            got.update(dict(ev.actions.state_delta))
    return ids, got


def test_block_and_ask_roundtrip():
    ids, state = asyncio.run(_run())
    assert ids[0].startswith("ask:"), ids
    assert state.get("ask") == {"value": "pdf"}, state


if __name__ == "__main__":
    test_block_and_ask_roundtrip()
    print("ok  block-and-ask: interrupt requested, resumed with the answer, state updated")
