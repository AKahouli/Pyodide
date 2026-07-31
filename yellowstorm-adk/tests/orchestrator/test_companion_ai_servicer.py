"""CompanionAiServicer tests with a mocked service + read model.

Covers the write-side logic that isn't otherwise CI-tested: RunTask routing
(new turn vs resume), GetSession snapshot mapping, and StopSession
cancellation. No ADK/DB/LLM.
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from unittest.mock import AsyncMock, MagicMock

from src.grpc_generated import chatbot_pb2 as chatbot_pb
from src.grpc_generated import companion_ai_pb2 as pb
from src.grpc_server import companion_ai_servicer
from src.grpc_server.companion_ai_servicer import CompanionAiServicer


def _ctx():
    c = MagicMock()
    c.set_code = MagicMock()
    c.set_details = MagicMock()
    return c


def _servicer(rm=None, service=None):
    return CompanionAiServicer(service or MagicMock(), rm)


# Every request carries exactly one planner + one executor agent; tests that
# don't care about specific overrides reuse this pair to satisfy that.
_AGENTS = [
    chatbot_pb.Agent(agent_type=companion_ai_servicer.PLANNER_AGENT_TYPE, chatbot=chatbot_pb.Chatbot(model="m")),
    chatbot_pb.Agent(agent_type=companion_ai_servicer.EXECUTOR_AGENT_TYPE, chatbot=chatbot_pb.Chatbot(model="m")),
]


async def _drain(servicer):
    if servicer._bg:
        await asyncio.gather(*list(servicer._bg), return_exceptions=True)


async def test_create_session_returns_id_and_projects():
    rm = MagicMock(ensure_session=AsyncMock())
    s = _servicer(rm=rm)
    resp = await s.CreateSession(pb.CreateSessionRequest(user_id="u1"), _ctx())
    assert resp.session_id
    rm.ensure_session.assert_awaited_once()


async def test_runtask_accepts_and_runs_plan():
    rm = MagicMock(snapshot=AsyncMock(return_value={"session": {"status": "running", "interrupt_id": None}}))
    service = MagicMock(plan_turn=AsyncMock(), resume_turn=AsyncMock())
    s = _servicer(rm=rm, service=service)
    resp = await s.RunTask(pb.RunRequest(user_id="u", session_id="s1", message="hi", agents=_AGENTS), _ctx())
    assert resp.accepted is True and resp.run_id
    await _drain(s)
    service.plan_turn.assert_awaited_once()
    service.resume_turn.assert_not_awaited()


async def test_runtask_falls_back_to_default_model_when_no_agents_sent():
    """A client not yet updated to send `agents` still works — DEFAULT_MODEL
    and the hardcoded planner/executor prompts (None override) kick in."""
    rm = MagicMock(snapshot=AsyncMock(return_value={"session": {"status": "running", "interrupt_id": None}}))
    service = MagicMock(plan_turn=AsyncMock(), resume_turn=AsyncMock())
    s = _servicer(rm=rm, service=service)
    await s.RunTask(pb.RunRequest(user_id="u", session_id="s1", message="hi"), _ctx())
    await _drain(s)
    kw = service.plan_turn.await_args.kwargs
    assert kw["model"] == companion_ai_servicer.DEFAULT_MODEL
    assert kw["planner_model"] is None
    assert kw["planner_prompt"] is None
    assert kw["executor_prompt"] is None


async def test_runtask_forwards_planner_and_executor_overrides():
    rm = MagicMock(snapshot=AsyncMock(return_value={"session": {"status": "running", "interrupt_id": None}}))
    service = MagicMock(plan_turn=AsyncMock(), resume_turn=AsyncMock())
    s = _servicer(rm=rm, service=service)
    await s._run_turn(pb.RunRequest(
        user_id="u", session_id="s1", message="hi",
        agents=[
            chatbot_pb.Agent(agent_type=companion_ai_servicer.PLANNER_AGENT_TYPE, prompt="custom planner",
                             chatbot=chatbot_pb.Chatbot(model="plan-model")),
            chatbot_pb.Agent(agent_type=companion_ai_servicer.EXECUTOR_AGENT_TYPE, id="exec-42",
                             name="Worky executor", prompt="custom executor {description}",
                             chatbot=chatbot_pb.Chatbot(model="exec-model")),
        ]), "exec-model", "run1")
    kw = service.plan_turn.await_args.kwargs
    assert kw["planner_model"] == "plan-model"
    assert kw["planner_prompt"] == "custom planner"
    assert kw["executor_prompt"] == "custom executor {description}"
    assert kw["executor_name"] == "Worky executor"
    assert kw["executor_id"] == "exec-42"


async def test_run_turn_routes_to_resume_when_waiting():
    rm = MagicMock(snapshot=AsyncMock(
        return_value={"session": {"status": "waiting", "interrupt_id": "i1"}}))
    service = MagicMock(plan_turn=AsyncMock(), resume_turn=AsyncMock())
    s = _servicer(rm=rm, service=service)
    await s._run_turn(pb.RunRequest(user_id="u", session_id="s1", message="blue", agents=_AGENTS), "m", "run1")
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
    rm = MagicMock(stop_incomplete=AsyncMock(), cancel_mail_waits=AsyncMock(),
                   set_session_status=AsyncMock())
    s = _servicer(rm=rm)

    async def forever():
        await asyncio.sleep(60)
    task = asyncio.create_task(forever())
    s._running["s1"] = task
    resp = await s.StopSession(pb.StopSessionRequest(user_id="u", session_id="s1"), _ctx())
    assert resp.stopped is True
    assert task.cancelled() or task.cancelling()
    rm.set_session_status.assert_awaited_once()
    # A stopped session waits on nothing: left behind, the wait would renew its
    # mailbox subscription forever and a late reply would resume a dead plan.
    rm.cancel_mail_waits.assert_awaited_once_with("s1")


# --- DeliverMailReply -------------------------------------------------------

_WAIT = {"session_id": "s1", "step_id": "m", "user_id": "u1",
         "interrupt_id": "mail:plan_s1@1/m@1", "token": "YW-tok"}


async def test_mail_reply_resumes_the_step_that_was_waiting():
    rm = MagicMock(claim_mail_wait=AsyncMock(return_value=dict(_WAIT)))
    service = MagicMock(resume_turn=AsyncMock())
    s = _servicer(rm=rm, service=service)

    resp = await s.DeliverMailReply(pb.DeliverMailReplyRequest(
        token="YW-tok", reply_body="I work at Yellow Systems.",
        reply_from="x@example.com",
        agents=[chatbot_pb.Agent(agent_type=companion_ai_servicer.EXECUTOR_AGENT_TYPE, chatbot=chatbot_pb.Chatbot(model="gpt"))]), _ctx())
    await _drain(s)

    assert (resp.delivered, resp.session_id, resp.step_id) == (True, "s1", "m")
    service.resume_turn.assert_awaited_once()
    kw = service.resume_turn.await_args.kwargs
    # The reply answers THAT step, not whatever the session's chat interrupt is.
    assert kw["interrupt_id"] == "mail:plan_s1@1/m@1"
    assert kw["answer"] == "I work at Yellow Systems."
    # Identity comes from the wait row, never from the caller.
    assert (kw["session_id"], kw["user_id"]) == ("s1", "u1")


async def test_mail_reply_forwards_executor_prompt_override():
    rm = MagicMock(claim_mail_wait=AsyncMock(return_value=dict(_WAIT)))
    service = MagicMock(resume_turn=AsyncMock())
    s = _servicer(rm=rm, service=service)

    await s.DeliverMailReply(pb.DeliverMailReplyRequest(
        token="YW-tok", reply_body="reply",
        agents=[chatbot_pb.Agent(agent_type=companion_ai_servicer.EXECUTOR_AGENT_TYPE, prompt="custom {description}")]), _ctx())
    await _drain(s)

    kw = service.resume_turn.await_args.kwargs
    assert kw["executor_prompt"] == "custom {description}"


async def test_a_duplicate_delivery_does_not_resume_the_step_twice():
    """Graph retries anything it thinks failed, so this is routine. A second
    resume would answer an answered question and run the plan on the reply
    twice."""
    rm = MagicMock(claim_mail_wait=AsyncMock(return_value=None))  # already claimed
    service = MagicMock(resume_turn=AsyncMock())
    s = _servicer(rm=rm, service=service)

    resp = await s.DeliverMailReply(pb.DeliverMailReplyRequest(
        token="YW-tok", reply_body="again"), _ctx())
    await _drain(s)

    assert resp.delivered is False
    service.resume_turn.assert_not_awaited()


async def test_an_unknown_token_is_not_an_error():
    """The webhook must ack Graph either way; a 5xx here makes Graph retry and
    eventually kill the subscription."""
    rm = MagicMock(claim_mail_wait=AsyncMock(return_value=None))
    ctx = _ctx()
    resp = await _servicer(rm=rm).DeliverMailReply(
        pb.DeliverMailReplyRequest(token="YW-nope", reply_body="x"), ctx)
    assert resp.delivered is False
    ctx.set_code.assert_not_called()


async def test_mail_reply_supersedes_an_in_flight_turn():
    rm = MagicMock(claim_mail_wait=AsyncMock(return_value=dict(_WAIT)))
    service = MagicMock(resume_turn=AsyncMock())
    s = _servicer(rm=rm, service=service)

    async def forever():
        await asyncio.sleep(60)
    prev = asyncio.create_task(forever())
    s._running["s1"] = prev

    await s.DeliverMailReply(pb.DeliverMailReplyRequest(
        token="YW-tok", reply_body="reply", agents=_AGENTS), _ctx())
    await _drain(s)

    assert prev.cancelled(), "two turns must never run on one session"
    service.resume_turn.assert_awaited_once()
