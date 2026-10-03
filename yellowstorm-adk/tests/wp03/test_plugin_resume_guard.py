"""WP03 §9.4 audit guard: no manufactured failures during native resume."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from types import SimpleNamespace

from google.genai.types import Content, Part, FunctionCall

from src.smart_rag.infrastructure.processing.plugin import (
    _is_native_resume,
    clean_session_case_bad_request,
)


def _call_event(call_id: str, content: Content):
    return SimpleNamespace(id=f"evt_{call_id}", content=Content(role="model", parts=[Part(function_call=FunctionCall(id=call_id, name="tool_x", args={}))]), timestamp=1.0)


def _user_event(content: Content):
    return SimpleNamespace(id="evt_user", content=content, timestamp=2.0)


class _FakeSessionService:
    def __init__(self):
        self.appended = []

    async def append_event(self, session, event):
        self.appended.append(event)
        session.events.append(event)
        return session

    async def get_session(self, **_kwargs):
        return None


class _FakeContext:
    def __init__(self, user_content, session=None):
        self.user_content = user_content
        self.session = session
        self.session_service = _FakeSessionService()


def _session_with_dangling_call():
    call_content = Content(role="model", parts=[Part(function_call=FunctionCall(id="call_1", name="tool_x", args={}))])
    call_event = _call_event("call_1", call_content)
    session = SimpleNamespace(events=[call_event], last_update_time=5.0, app_name="a", user_id="u", id="s")
    return session, call_event


def test_resume_detection_by_user_content_identity():
    user_content = Content(role="user", parts=[Part(text="hi")])
    user_event = _user_event(user_content)

    # Resumed invocation: the original user message sits EARLIER in history,
    # the interrupted tool call came after it.
    resumed = SimpleNamespace(events=[user_event, _call_event("call_1", None)])
    assert _is_native_resume(_FakeContext(user_content), resumed) is True

    # Fresh invocation: the user content object matches nothing yet.
    fresh_session, _ = _session_with_dangling_call()
    assert _is_native_resume(_FakeContext(Content(role="user", parts=[Part(text="hi")])), fresh_session) is False

    # Matching only the LAST event is a normal new turn, not a resume.
    last_only = SimpleNamespace(events=[user_event])
    assert _is_native_resume(_FakeContext(user_content), last_only) is False


async def test_resume_skips_repair_for_dangling_calls():
    session, _ = _session_with_dangling_call()
    resumed_user_content = Content(role="user", parts=[Part(text="earlier")])
    session.events.insert(0, _user_event(resumed_user_content))
    ctx = _FakeContext(resumed_user_content, session)

    result = await clean_session_case_bad_request(ctx, resumed_user_content)
    assert result is None
    assert ctx.session_service.appended == []  # no manufactured failure response


async def test_new_invocation_still_repairs_dangling_calls():
    session, _ = _session_with_dangling_call()
    fresh_user_content = Content(role="user", parts=[Part(text="next turn")])
    ctx = _FakeContext(fresh_user_content, session)

    result = await clean_session_case_bad_request(ctx, fresh_user_content)
    assert result is None
    assert len(ctx.session_service.appended) == 1  # legacy BadRequest repair intact
    repaired = ctx.session_service.appended[0]
    responses = [p.function_response for p in repaired.content.parts if getattr(p, "function_response", None)]
    assert responses and responses[0].id == "call_1"
    assert "interrupted" in responses[0].response["error"]
