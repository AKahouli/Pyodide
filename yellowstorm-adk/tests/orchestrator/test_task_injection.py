"""The task is delivered as a user turn, not baked into the system prompt.

Covers nodes._inject_task_turn: splice the step's task in right after the shared
kickoff (index 1) — early, not last, so it never out-shouts terminal flow
signals — while preserving every existing turn, including (on a resume) the
email reply that itself arrives as a user turn.
"""
import asyncio
from types import SimpleNamespace as NS

from src.companion_ai import nodes


def _text(s):
    return NS(role="user", parts=[NS(text=s, function_response=None, function_call=None)])


def _model_call(name):
    return NS(role="model", parts=[NS(text=None, function_response=None, function_call=name)])


def _tool_response(payload):
    return NS(role="user", parts=[NS(text=None, function_response=payload, function_call=None)])


def _user_texts(req):
    return [c.parts[0].text for c in req.contents
            if c.role == "user" and c.parts[0].text is not None]


def test_task_spliced_after_kickoff_not_last():
    cb = nodes._inject_task_turn("DO THE TASK")
    req = NS(contents=[_text("run the plan"), _model_call("send_email"),
                       _tool_response({"ok": 1})])
    asyncio.run(cb(None, req))
    # task sits right after the kickoff — NOT last, so tool history (and any
    # terminal "end your turn" message) stays more recent than it.
    assert req.contents[0].parts[0].text == "run the plan"
    assert req.contents[1].parts[0].text == "DO THE TASK"
    assert req.contents[-1].parts[0].function_response == {"ok": 1}


def test_resume_reply_is_not_clobbered():
    # On resume the email reply arrives as a user turn at the front — it must
    # survive, with the task spliced after it, never replacing it.
    cb = nodes._inject_task_turn("DO THE TASK")
    req = NS(contents=[_text("Hamdi says: APPROVED.")])
    asyncio.run(cb(None, req))
    assert _user_texts(req) == ["Hamdi says: APPROVED.", "DO THE TASK"]


def test_idempotent_when_task_already_present():
    cb = nodes._inject_task_turn("DO THE TASK")
    req = NS(contents=[_text("run the plan"), _text("DO THE TASK")])
    asyncio.run(cb(None, req))
    assert _user_texts(req) == ["run the plan", "DO THE TASK"]  # not doubled


if __name__ == "__main__":
    test_task_spliced_after_kickoff_not_last()
    test_resume_reply_is_not_clobbered()
    test_idempotent_when_task_already_present()
    print("ok")
