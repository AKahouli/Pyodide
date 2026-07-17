"""AgentOrchestratorServicer tests with a mocked service + read model.

Covers the write-side logic that isn't otherwise CI-tested: RunTask routing
(new turn vs resume), durable idempotency gating, GetSession snapshot mapping,
and StopSession cancellation. No ADK/DB/LLM.
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from unittest.mock import AsyncMock, MagicMock

from src.grpc_generated import orchestrator_pb2 as pb
from src.grpc_server.orchestrator_servicer import AgentOrchestratorServicer


def _ctx():
    c = MagicMock()
    c.set_code = MagicMock()
    c.set_details = MagicMock()
    return c


def _servicer(rm=None, service=None):
    return AgentOrchestratorServicer(service or MagicMock(), rm, default_model="m")


async def _drain(servicer):
    if servicer._bg:
        await asyncio.gather(*list(servicer._bg), return_exceptions=True)


async def test_create_session_returns_id_and_projects():
    rm = MagicMock(ensure_session=AsyncMock())
    s = _servicer(rm=rm)
    resp = await s.CreateSession(pb.CreateSessionRequest(user_id="u1"), _ctx())
    assert resp.session_id
    rm.ensure_session.assert_awaited_once()


async def test_runtask_duplicate_idempotency_rejected():
    rm = MagicMock(claim_run=AsyncMock(return_value=False))  # duplicate
    service = MagicMock(plan_turn=AsyncMock(), resume_turn=AsyncMock())
    s = _servicer(rm=rm, service=service)
    resp = await s.RunTask(pb.RunRequest(user_id="u", session_id="s1",
                                         message="m", idempotency_key="k1"), _ctx())
    assert resp.accepted is False
    await _drain(s)
    service.plan_turn.assert_not_awaited()   # duplicate never runs a turn


async def test_runtask_first_time_accepts_and_runs_plan():
    rm = MagicMock(claim_run=AsyncMock(return_value=True),
                   snapshot=AsyncMock(return_value={"session": {"status": "running", "interrupt_id": None}}))
    service = MagicMock(plan_turn=AsyncMock(), resume_turn=AsyncMock())
    s = _servicer(rm=rm, service=service)
    resp = await s.RunTask(pb.RunRequest(user_id="u", session_id="s1",
                                         message="hi", idempotency_key="k1"), _ctx())
    assert resp.accepted is True and resp.run_id
    await _drain(s)
    service.plan_turn.assert_awaited_once()
    service.resume_turn.assert_not_awaited()


async def test_run_turn_routes_to_resume_when_waiting():
    rm = MagicMock(snapshot=AsyncMock(
        return_value={"session": {"status": "waiting", "interrupt_id": "i1"}}))
    service = MagicMock(plan_turn=AsyncMock(), resume_turn=AsyncMock())
    s = _servicer(rm=rm, service=service)
    await s._run_turn(pb.RunRequest(user_id="u", session_id="s1", message="blue"), "m", "run1")
    service.resume_turn.assert_awaited_once()
    service.plan_turn.assert_not_awaited()


async def test_get_session_maps_snapshot_to_proto():
    rm = MagicMock(snapshot=AsyncMock(return_value={
        "session": {"id": "s1", "title": "T", "status": "blocked"},
        "plan": {"id": "p1", "title": "PT", "goal": "G", "status": "blocked"},
        "steps": [{"step_id": "s1", "description": "ask", "status": "blocked",
                   "wave": 0, "agent": "", "result": "", "blocked_reason": "awaiting user input",
                   "depends_on": ""},
                  {"step_id": "s2", "description": "do", "status": "pending",
                   "wave": 1, "agent": "", "result": "", "blocked_reason": "",
                   "depends_on": "s1"}],
    }))
    s = _servicer(rm=rm)
    resp = await s.GetSession(pb.GetSessionRequest(user_id="u", session_id="s1"), _ctx())
    assert resp.status == "blocked" and resp.plan.goal == "G"
    assert [st.id for st in resp.plan.steps] == ["s1", "s2"]
    assert resp.plan.steps[0].blocked_reason == "awaiting user input"
    assert list(resp.plan.steps[1].depends_on) == ["s1"]


async def test_get_session_not_found_sets_status():
    import grpc
    rm = MagicMock(snapshot=AsyncMock(return_value=None))
    ctx = _ctx()
    resp = await _servicer(rm=rm).GetSession(pb.GetSessionRequest(user_id="u", session_id="x"), ctx)
    ctx.set_code.assert_called_with(grpc.StatusCode.NOT_FOUND)


async def test_stop_session_cancels_running_turn():
    rm = MagicMock(stop_incomplete=AsyncMock(), set_session_status=AsyncMock())
    s = _servicer(rm=rm)

    async def forever():
        await asyncio.sleep(60)
    task = asyncio.create_task(forever())
    s._running["s1"] = task
    resp = await s.StopSession(pb.StopSessionRequest(user_id="u", session_id="s1"), _ctx())
    assert resp.stopped is True
    assert task.cancelled() or task.cancelling()
    rm.set_session_status.assert_awaited_once()
