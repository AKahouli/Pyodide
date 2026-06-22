"""Unit tests for the bounded planning turn runner.

The Runner + LlmAgent + sessions modules are stubbed via
`tests._adk_stub`. We drive the runner with a fixed sequence of
events and assert the resulting SSE frame order.
"""
from __future__ import annotations

import importlib
import types
from typing import Any

import pytest

from tests._adk_stub import (  # noqa: E402
    install_adk_stubs,
    set_runner_events_provider,
    reset_recordings,
    constructed_llm_agents,
)

install_adk_stubs()

import app.agents.model as _model_mod  # noqa: E402
importlib.reload(_model_mod)
import app.agents.manager as _manager_mod  # noqa: E402
importlib.reload(_manager_mod)
import app.agents.runner as _runner_mod  # noqa: E402
importlib.reload(_runner_mod)

from app.agents.runner import build_runner  # noqa: E402


class _StubEvent:
    """Mimic an ADK event with a `content.parts[*].text` and an `is_final_response` flag."""

    def __init__(self, text: str | None, *, final: bool = False) -> None:
        part = types.SimpleNamespace(text=text)
        self.content = types.SimpleNamespace(parts=[part]) if text is not None else None
        self._final = final

    def is_final_response(self) -> bool:
        return self._final


def _drive_with_events(events: list[Any]) -> None:
    set_runner_events_provider(lambda: iter(events))


@pytest.fixture(autouse=True)
def _reset_runner_events():
    yield
    set_runner_events_provider(None)


@pytest.mark.asyncio
async def test_runner_yields_planning_ack_token_done_for_clean_text_turn() -> None:
    events = [
        _StubEvent(None),
        _StubEvent("Sure, here's a plan.", final=True),
    ]
    _drive_with_events(events)
    run_turn = build_runner()
    frames = []
    async for f in run_turn("Hello"):
        frames.append(f)
    types_seen = [f.type for f in frames]
    assert "planning.ack" in types_seen
    assert "planning.token" in types_seen
    assert "assistant.message" in types_seen
    assert types_seen[-1] == "planning.done"


@pytest.mark.asyncio
async def test_runner_yields_only_ack_done_when_no_events() -> None:
    _drive_with_events([])
    run_turn = build_runner()
    frames = []
    async for f in run_turn("Hello"):
        frames.append(f)
    types_seen = [f.type for f in frames]
    assert types_seen[0] == "planning.ack"
    assert types_seen[-1] == "planning.done"
    for t in types_seen[1:-1]:
        assert t not in ("delta.pending", "interaction.requested", "assistant.message")


@pytest.mark.asyncio
async def test_runner_persists_streamed_text_when_no_final_text() -> None:
    events = [
        _StubEvent("I can "),
        _StubEvent("continue."),
    ]
    _drive_with_events(events)
    run_turn = build_runner()
    frames = []
    async for f in run_turn("continue"):
        frames.append(f)
    assistant = next(f for f in frames if f.type == "assistant.message")
    assert assistant.payload == {"text": "I can continue."}


@pytest.mark.asyncio
async def test_runner_persists_mixed_streamed_and_final_text() -> None:
    events = [
        _StubEvent("I can "),
        _StubEvent("continue.", final=True),
    ]
    _drive_with_events(events)
    run_turn = build_runner()
    frames = []
    async for f in run_turn("continue"):
        frames.append(f)
    assistant = next(f for f in frames if f.type == "assistant.message")
    assert assistant.payload == {"text": "I can continue."}


@pytest.mark.asyncio
async def test_runner_emits_delta_and_assistant_message_for_same_turn() -> None:
    reset_recordings()

    def _events():
        submit_tool = constructed_llm_agents()[-1]["tools"][0]
        submit_tool(
            {
                "create_tasks": [
                    {
                        "title": "Research competitors",
                        "lane": "ready",
                        "actionCategory": "research",
                    }
                ]
            }
        )
        yield _StubEvent("I added the next task.")

    set_runner_events_provider(_events)
    run_turn = build_runner()
    frames = []
    async for f in run_turn("add another task"):
        frames.append(f)
    types_seen = [f.type for f in frames]
    assert "delta.pending" in types_seen
    assert "assistant.message" in types_seen
    assert types_seen.index("delta.pending") < types_seen.index("assistant.message")


@pytest.mark.asyncio
async def test_runner_propagates_runner_exception_as_planning_error() -> None:
    def _exploding():
        raise RuntimeError("boom")
        if False:  # pragma: no cover
            yield

    _drive_with_events([])
    set_runner_events_provider(_exploding)
    run_turn = build_runner()
    frames = []
    async for f in run_turn("Hello"):
        frames.append(f)
    types_seen = [f.type for f in frames]
    assert "planning.error" in types_seen
    assert types_seen[-1] == "planning.error"


@pytest.mark.asyncio
async def test_runner_prepends_previous_clarification_to_user_message() -> None:
    """The follow-up turn must give the Manager the question text, not
    only the owner's answer — otherwise the model has no signal that
    the previous turn's clarification was answered and re-asks."""

    import sys

    captured: dict = {}

    genai_types = sys.modules["google.genai.types"]
    original_part = genai_types.Part

    def _capturing_part(**kwargs: Any) -> Any:
        text = kwargs.get("text")
        if text and "text" not in captured:
            captured["text"] = text
        return original_part(**kwargs)

    genai_types.Part = _capturing_part
    try:
        importlib.reload(_runner_mod)
        run_turn = _runner_mod.build_runner()
        snapshot = {
            "streamId": "s1",
            "planVersion": 0,
            "budget": {"limitUsd": 0, "spendUsd": 0},
            "board": {},
            "previousClarification": {
                "interactionId": "i1",
                "question": "Which document should the benchmark cover?",
                "options": ["Q1 report", "Q2 report", "Both"],
            },
        }
        async for _ in run_turn("Q2 report", snapshot, None):
            pass
    finally:
        genai_types.Part = original_part
        importlib.reload(_runner_mod)

    assert "text" in captured, "Runner did not build a Part for the user turn"
    text = captured["text"]
    assert "Which document should the benchmark cover?" in text
    assert "Q2 report" in text
    assert "Q1 report" in text


@pytest.mark.asyncio
async def test_runner_does_not_prepend_clarification_without_snapshot() -> None:
    """Owner-message turns (no previous clarification) must keep the
    raw owner message — adding spurious context would still confuse
    the model on plain new-message turns."""

    import sys

    captured: dict = {}

    genai_types = sys.modules["google.genai.types"]
    original_part = genai_types.Part

    def _capturing_part(**kwargs: Any) -> Any:
        text = kwargs.get("text")
        if text and "text" not in captured:
            captured["text"] = text
        return original_part(**kwargs)

    genai_types.Part = _capturing_part
    try:
        importlib.reload(_runner_mod)
        run_turn = _runner_mod.build_runner()
        async for _ in run_turn("plain owner message", None, None):
            pass
    finally:
        genai_types.Part = original_part
        importlib.reload(_runner_mod)

    assert captured.get("text") == "plain owner message"


@pytest.mark.asyncio
async def test_runner_terminates_after_bounded_events_when_no_tool_fires() -> None:
    """If the LLM keeps producing events without ever invoking a
    Manager tool, the runner must bail out — otherwise the SSE pipe
    stays open and the UI stays stuck on 'Manager is working…'."""

    events = [_StubEvent(f"thinking step {i}") for i in range(200)]
    consumed: list[int] = []

    def _counting_provider() -> Any:
        for ev in events:
            consumed.append(1)
            yield ev
        # If the runner didn't break, append a sentinel so the test can
        # detect the unbounded consumption.
        consumed.append(-1)

    set_runner_events_provider(_counting_provider)
    run_turn = build_runner()
    frames = []
    async for f in run_turn("Hello"):
        frames.append(f)
    types_seen = [f.type for f in frames]
    assert types_seen[-1] == "planning.done"
    # Sentinel must be appended — the runner consumed every event.
    # If the cap kicks in, the sentinel is never reached and the
    # consumed list ends at the capped event.
    assert -1 not in consumed
    # The cap is 64 events; the provider yields 1 per call.
    assert len(consumed) <= 64
    # And we did receive at least one token frame so we know the
    # cap actually fired (the loop wasn't no-op).
    assert any(t == "planning.token" for t in types_seen)
