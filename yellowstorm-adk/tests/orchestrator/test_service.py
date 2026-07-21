"""Unit tests for OrchestratorService pure helpers (no ADK/DB/LLM)."""
import asyncio
import os
import sys
from unittest.mock import AsyncMock, MagicMock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import pytest

from src.companion_ai import service as svc
from src.companion_ai.plan import Plan, Status, Step


def test_extract_json_plain():
    assert svc._extract_json('{"title": "t", "steps": []}') == {"title": "t", "steps": []}


def test_extract_json_with_fences_and_prose():
    text = 'Sure!\n```json\n{"a": 1, "b": [2, 3]}\n```\ndone'
    assert svc._extract_json(text) == {"a": 1, "b": [2, 3]}


def test_extract_json_raises_without_json():
    with pytest.raises(ValueError, match="no JSON"):
        svc._extract_json("no json here")


def test_node_to_step_name_strips_path_and_version():
    assert svc._node_to_step_name("plan_s1@1/step_a@1") == "step_a"
    assert svc._node_to_step_name("n_9abc@2") == "n_9abc"


def test_plan_from_snapshot_reconstructs_kind_and_deps():
    snap = {
        "session": {"id": "s", "status": "waiting", "interrupt_id": "i1"},
        "plan": {"id": "p1", "title": "T", "goal": "G", "status": "blocked"},
        "steps": [
            {"step_id": "s1", "description": "ask name", "kind": "ask",
             "question": "name?", "status": "blocked", "wave": 0,
             "depends_on": "", "result": None},
            {"step_id": "s2", "description": "greet", "kind": "execute",
             "question": None, "status": "pending", "wave": 1,
             "depends_on": "s1", "result": None},
        ],
    }
    plan = svc._plan_from_snapshot(snap)
    assert plan.id == "p1" and plan.goal == "G" and plan.status is Status.BLOCKED
    s1, s2 = plan.steps
    assert s1.kind == "ask" and s1.question == "name?" and s1.status is Status.BLOCKED
    assert s2.kind == "execute" and s2.depends_on == ["s1"] and s2.wave == 1


def test_plan_turn_never_gives_the_workflow_the_users_real_message():
    """The trigger passed to Runner.run_async becomes a session event with no
    branch, and ADK makes an unbranched event visible to every node in the
    graph unconditionally -- regardless of that node's own instruction. That
    is how a step whose own instruction only said "search Apple news" still
    saw the whole original request ("...email Rabeb... search Tesla AND
    Apple...") and, in production, acted on part of it that was never its
    job: it sent its own unstamped copy of an email meant for a different
    step entirely.

    No step's instruction depends on this trigger's content -- each already
    carries its own complete description -- so the fix is to never hand the
    real message to the workflow at all. This pins that the session_id's
    turn-driving call keeps receiving something else, so a future edit can't
    silently put the leak back.
    """
    session = MagicMock()
    session.session_service.get_session = AsyncMock(return_value=object())

    def fake_runner_factory(node, app_name):
        return session

    service = svc.OrchestratorService(fake_runner_factory, None, planner_model="m")
    plan = Plan(id="p", title="t", goal="g", steps=[Step(id="a", kind="execute", description="do a")])
    service._make_plan = AsyncMock(return_value=plan)
    service._drive = AsyncMock(return_value=[])

    secret_message = "email x@example.com asking which company she works for"
    asyncio.run(service.plan_turn(session_id="s1", user_id="u1",
                                  message=secret_message, model="m"))

    service._drive.assert_awaited_once()
    new_message = service._drive.await_args.args[-1]
    sent_text = new_message.parts[0].text
    assert secret_message not in sent_text, (
        "the workflow's trigger must never carry the user's real request text")
