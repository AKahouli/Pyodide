"""The task is delivered as a user turn, not baked into the system prompt.

Covers nodes._inject_task_turn: the task goes in EARLY (never last, so it can't
out-shout terminal flow signals). The shared filler kickoff ("run the plan") is
replaced by the task; a real front turn (a resume's email reply) is kept, with
the task spliced right after it.
"""
import asyncio
from types import SimpleNamespace as NS

from src.companion_ai.adk import nodes


def _text(s):
    return NS(role="user", parts=[NS(text=s, function_response=None, function_call=None)])


def _model_call(name):
    return NS(role="model", parts=[NS(text=None, function_response=None, function_call=name)])


def _tool_response(payload):
    return NS(role="user", parts=[NS(text=None, function_response=payload, function_call=None)])


def _user_texts(req):
    return [c.parts[0].text for c in req.contents
            if c.role == "user" and c.parts[0].text is not None]


def test_kickoff_sentinel_replaced_by_task():
    cb = nodes._inject_task_turn("DO THE TASK")
    req = NS(contents=[_text("run the plan"), _model_call("send_email"),
                       _tool_response({"ok": 1})])
    asyncio.run(cb(None, req))
    # filler kickoff gone; task takes its place at the front — and is NOT last,
    # so tool history (and any terminal "end your turn") stays more recent.
    assert _user_texts(req) == ["DO THE TASK"]
    assert req.contents[0].parts[0].text == "DO THE TASK"
    assert req.contents[-1].parts[0].function_response == {"ok": 1}


def test_resume_reply_is_not_clobbered():
    # On resume the email reply arrives as a user turn at the front — it isn't a
    # sentinel, so it must survive, with the task spliced right after it.
    cb = nodes._inject_task_turn("DO THE TASK")
    req = NS(contents=[_text("Hamdi says: APPROVED.")])
    asyncio.run(cb(None, req))
    assert _user_texts(req) == ["Hamdi says: APPROVED.", "DO THE TASK"]


def test_idempotent_on_resume_branch():
    # A real front turn already followed by the task must not gain a second copy.
    cb = nodes._inject_task_turn("DO THE TASK")
    req = NS(contents=[_text("Hamdi says: APPROVED."), _text("DO THE TASK")])
    asyncio.run(cb(None, req))
    assert _user_texts(req) == ["Hamdi says: APPROVED.", "DO THE TASK"]  # not doubled


if __name__ == "__main__":
    test_kickoff_sentinel_replaced_by_task()
    test_resume_reply_is_not_clobbered()
    test_idempotent_on_resume_branch()
    print("ok")
