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
