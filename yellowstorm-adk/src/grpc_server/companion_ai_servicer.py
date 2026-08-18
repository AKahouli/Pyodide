"""CompanionAi gRPC servicer — maps the 4 RPCs onto OrchestratorService.

Write side only (CQRS): RunTask runs the turn in the background and acks; the
client reads live progress from ElectricSQL. GetSession returns a one-shot
snapshot for initial load.

This is where a turn begins: STEP 1, 3, 4 below are part of the ten-step
sequence documented in companion_ai/service.py; STEP 5-10 continue there.
"""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from typing import Dict, Optional, Set

import grpc

from src.grpc_generated import companion_ai_pb2 as pb
from src.grpc_generated import companion_ai_pb2_grpc as pb_grpc
from src.companion_ai import mail_token
from src.companion_ai.readmodel import ReadModel
from src.companion_ai.service import OrchestratorService

logger = logging.getLogger(__name__)

# Used only when the request carries no executor agent — e.g. a client that
# hasn't been updated to send `agents` yet. Once every client sends one, this
# becomes dead and can go.
DEFAULT_MODEL = "gpt-5.4-mini"

# The real, permanent slugs the client sends (YellowStorm/back:
# worky.constants.ts — WORKY_PLANNER_AGENT_TYPE_SLUG / WORKY_EXECUTOR_AGENT_TYPE_SLUG).
# Not "planner"/"executor" — those never matched any real request, so the
# client's own model/prompt silently never applied; every turn ran on
# DEFAULT_MODEL and the hardcoded PLANNER_INSTRUCTION/EXECUTOR_INSTRUCTION.
PLANNER_AGENT_TYPE = "worky-planner"
EXECUTOR_AGENT_TYPE = "worky-executer"


def _parse_mcp_config(raw: str) -> dict:
    """Parse the connector's mcp_server_config_json (JSON string) into a dict."""
    if not raw:
        return {}
    try:
        val = json.loads(raw)
        return val if isinstance(val, dict) else {}
    except (json.JSONDecodeError, TypeError):
        return {}


def _agent_by_type(agents, agent_type: str):
    """The chatbot.Agent in `agents` with this agent_type, or None if the
    request carries no such agent (e.g. a client not yet updated to send
    `agents` — falls back to DEFAULT_MODEL and the hardcoded prompts).

    Pass PLANNER_AGENT_TYPE/EXECUTOR_AGENT_TYPE to select the built-in roles;
    any other agent_type is reserved for a future named persona a plan step
    can be assigned to."""
    return next((a for a in agents if a.agent_type == agent_type), None)


def _describe_request(request) -> str:
    """One-line dump of every RunRequest field, secrets redacted (connector
    auth_headers carry Bearer tokens; skill/agent instructions are large)."""
    skills = [{"id": s.id, "name": s.name} for s in request.skills]
    agents = [{"id": a.id, "name": a.name, "agent_type": a.agent_type,
               "model": a.chatbot.model, "prompt_len": len(a.prompt)}
              for a in request.agents]
    connectors = [
        {
            "connector_name": c.connector_name,
            "mcp_transport_type": c.mcp_transport_type,
            "mcp_server_url": c.mcp_server_url,
            "actions": [a.action_key for a in c.actions],
            "auth_headers": sorted(dict(c.auth_headers).keys()),  # keys only, values redacted
            # header names carried in mcp_server_config_json (where linkup/code-interpreter
            # auth actually rides) — keys only. Empty means the backend didn't send it.
            "mcp_config_headers": sorted((_parse_mcp_config(c.mcp_server_config_json).get("headers") or {}).keys()),
        }
        for c in request.connectors
    ]
    return (
        f"user_id={request.user_id!r} session_id={request.session_id!r} "
        f"agents={agents} "
        f"message={request.message!r} skills={skills} connectors={connectors}"
    )


def _connectors_to_dicts(connectors) -> list:
    """proto ConnectorBinding[] -> the binding dict create_connector_tools wants.

    Each action carries its description + parsed parameter_schema so the executor
    tool advertises a proper signature/schema to the LLM."""
    out = []
    for c in connectors:
        actions = []
        for a in c.actions:
            try:
                schema = json.loads(a.parameter_schema_json) if a.parameter_schema_json else {}
            except (json.JSONDecodeError, TypeError):
                schema = {}
            actions.append({
                "action_key": a.action_key,
                "label": a.label,
                "description": a.description,
                "parameter_schema": schema,
            })
        out.append({
            "connector_id": c.connector_id,
            "connector_name": c.connector_name,
            "mcp_transport_type": c.mcp_transport_type,
            "mcp_server_url": c.mcp_server_url,
            "auth_headers": dict(c.auth_headers),
            "auth_env": dict(c.auth_env),
            "mcp_server_config": _parse_mcp_config(c.mcp_server_config_json),
            "actions": actions,
        })
    return out


class CompanionAiServicer(pb_grpc.CompanionAiServicer):
    def __init__(self, service: OrchestratorService, read_model: Optional[ReadModel] = None):
        self._svc = service
        self._rm = read_model
        self._bg: Set[asyncio.Task] = set()          # keep strong refs
        self._running: Dict[str, asyncio.Task] = {}   # session_id -> turn task

    async def CreateSession(self, request: pb.CreateSessionRequest, context) -> pb.CreateSessionResponse:
        session_id = uuid.uuid4().hex
        if self._rm:
            try:
                await self._rm.ensure_session(session_id, request.user_id, None, "pending")
            except Exception as e:
                logger.warning("CreateSession projection failed: %s", e)
        return pb.CreateSessionResponse(session_id=session_id)

    async def RunTask(self, request: pb.RunRequest, context) -> pb.RunResponse:
        # STEP 1 — the user's message arrives. Everything downstream is driven by
        # this one request; the RPC itself only ever returns an ack.
        run_id = uuid.uuid4().hex
        logger.info("[worky] 1. RunTask ◄ incoming request: %s", _describe_request(request))

        # A message that arrives WHILE a plan is executing is NOT a supersede.
        # The old behaviour cancelled the running turn and replanned — which
        # destroyed the plan the user was watching, and cancelling a mid-LLM-call
        # turn is slow and noisy (litellm wraps the aborted call as an APIError).
        # Instead run it as a concurrent conversation with the planner, alongside
        # the still-executing plan. Tracked in _bg only (NOT _running): the
        # executing turn keeps ownership of _running, so Stop still targets it.
        if await self._plan_is_executing(request.session_id):
            task = asyncio.create_task(self._run_converse(request, run_id))
            self._bg.add(task)
            task.add_done_callback(self._bg.discard)
            logger.info("[worky] 3. RunTask accepted → concurrent converse "
                        "(session=%s run=%s)", request.session_id, run_id)
            return pb.RunResponse(session_id=request.session_id, accepted=True, run_id=run_id)

        # STEP 3 — ack now, run the turn in the background. The client watches
        # progress arrive in the read model, not on this call. Last-answer-wins:
        # hand the in-flight turn (if any) to the new one so it supersedes it.
        executor = _agent_by_type(request.agents, EXECUTOR_AGENT_TYPE)
        model = (executor.chatbot.model if executor else "") or DEFAULT_MODEL
        prev = self._running.get(request.session_id)
        task = asyncio.create_task(self._run_turn(request, model, run_id, prev))
        self._bg.add(task)
        task.add_done_callback(self._bg.discard)
        task.add_done_callback(self._forget_running(request.session_id))
        self._running[request.session_id] = task
        logger.info("[worky] 3. RunTask accepted → background turn (session=%s run=%s)",
                    request.session_id, run_id)
        return pb.RunResponse(session_id=request.session_id, accepted=True, run_id=run_id)

    async def _plan_is_executing(self, session_id: str) -> bool:
        """True when a plan is mid-execution — running, with steps projected, and
        NOT parked on user input. A message then talks WITH the planner alongside
        the plan instead of superseding it. False during the initial planning
        phase (no steps yet) and while blocked on an ask/await_reply (that message
        is the awaited answer → the normal resume path handles it)."""
        if self._rm is None:
            return False
        try:
            snap = await self._rm.snapshot(session_id)
        except Exception:
            return False
        if not snap:
            return False
        sess = snap.get("session") or {}
        return (sess.get("status") == "running" and not sess.get("interrupt_id")
                and bool(snap.get("steps")))

    async def _run_converse(self, request: pb.RunRequest, run_id: str) -> None:
        try:
            planner = _agent_by_type(request.agents, PLANNER_AGENT_TYPE)
            await self._svc.converse_turn(
                session_id=request.session_id, user_id=request.user_id,
                message=request.message,
                planner_model=planner.chatbot.model if planner else None,
                planner_prompt=planner.prompt if planner else None)
            logger.info("[worky] converse turn done (session=%s run=%s)",
                        request.session_id, run_id)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("[worky] converse turn failed (session=%s run=%s)",
                             request.session_id, run_id)

    def _forget_running(self, session_id: str):
        """Done-callback that drops the session's task ref only if it's still the
        current one — so a superseded turn's cleanup can't evict its successor."""
        def _cb(task: asyncio.Task) -> None:
            if self._running.get(session_id) is task:
                self._running.pop(session_id, None)
        return _cb

    async def _run_turn(self, request: pb.RunRequest, model: str, run_id: str,
                        prev: Optional[asyncio.Task] = None) -> None:
        try:
            # Last-answer-wins: cancel any in-flight turn for this session so two
            # turns never run concurrently — that race is what let a "changed my
            # mind" reply lose to the earlier answer. We wait for it to actually
            # stop before reading the session state below.
            if prev is not None and not prev.done():
                logger.info("[worky] superseding in-flight turn (session=%s run=%s)",
                            request.session_id, run_id)
                prev.cancel()
                try:
                    await prev
                except BaseException:  # noqa: BLE001 — prev's cancellation is expected
                    pass

            connectors = _connectors_to_dicts(request.connectors)
            # STEP 4 — new turn, or the answer to a pending question? A pending
            # interrupt (set while blocked on ask-the-user, and NOT cleared until
            # the turn finishes) means this message is the answer → resume;
            # otherwise → plan. Because we cancelled the prior turn above, a
            # correction sent during the answerable window re-resumes with the
            # newer answer instead of racing the old one.
            interrupt_id, status = None, None
            if self._rm is not None:
                snap = await self._rm.snapshot(request.session_id)
                if snap:
                    interrupt_id = snap["session"].get("interrupt_id")
                    status = snap["session"].get("status")
            # Three ways in: a pending interrupt → this message is the answer
            # (resume); a paused plan → continue where it left off; otherwise a
            # fresh turn (plan).
            mode = ("resume — message is an answer" if interrupt_id
                    else "continue — resume paused plan" if status == "paused"
                    else "new turn — planning")
            logger.info("[worky] 4. %s (session=%s)", mode, request.session_id)
            executor = _agent_by_type(request.agents, EXECUTOR_AGENT_TYPE)
            executor_prompt = executor.prompt if executor else None
            if interrupt_id:
                await self._svc.resume_turn(
                    session_id=request.session_id, user_id=request.user_id,
                    answer=request.message, model=model, connectors=connectors,
                    executor_prompt=executor_prompt)
            elif status == "paused":
                await self._svc.continue_turn(
                    session_id=request.session_id, user_id=request.user_id,
                    model=model, connectors=connectors, executor_prompt=executor_prompt)
            else:
                planner = _agent_by_type(request.agents, PLANNER_AGENT_TYPE)
                await self._svc.plan_turn(
                    session_id=request.session_id, user_id=request.user_id,
                    message=request.message, model=model, connectors=connectors,
                    planner_model=planner.chatbot.model if planner else None,
                    planner_prompt=planner.prompt if planner else None,
                    executor_prompt=executor_prompt,
                    executor_name=executor.name if executor else None,
                    executor_id=executor.id if executor else None)
            logger.info("RunTask turn done (session=%s run=%s)", request.session_id, run_id)
        except asyncio.CancelledError:
            logger.info("RunTask turn superseded/cancelled (session=%s)", request.session_id)
            raise
        except Exception:
            logger.exception("RunTask turn failed (session=%s run=%s)", request.session_id, run_id)

    async def GetSession(self, request: pb.GetSessionRequest, context) -> pb.GetSessionResponse:
        if self._rm is None:
            context.set_code(grpc.StatusCode.UNIMPLEMENTED)
            context.set_details("read model not configured")
            return pb.GetSessionResponse()
        snap = await self._rm.snapshot(request.session_id)
        if snap is None:
            context.set_code(grpc.StatusCode.NOT_FOUND)
            return pb.GetSessionResponse()
        sess = snap["session"]
        resp = pb.GetSessionResponse(
            session_id=sess["id"], title=sess.get("title") or "", status=sess["status"])
        if snap["plan"]:
            p = snap["plan"]
            resp.plan.id = p["id"]
            resp.plan.title = p.get("title") or ""
            resp.plan.goal = p.get("goal") or ""
            resp.plan.status = p["status"]
            for s in snap["steps"]:
                step = resp.plan.steps.add()
                step.id = s["step_id"]
                step.description = s.get("description") or ""
                step.status = s["status"]
                step.wave = s.get("wave") or 0
                step.agent = s.get("agent") or ""
                step.result = s.get("result") or ""
                step.blocked_reason = s.get("blocked_reason") or ""
                if s.get("depends_on"):
                    step.depends_on.extend([d for d in s["depends_on"].split(",") if d])
        return resp

    async def StopSession(self, request: pb.StopSessionRequest, context) -> pb.StopSessionResponse:
        # Claim the task out of _running so a repeat Stop can't double-act. We do
        # NOT await its cancellation: a turn mid–LLM-call takes tens of seconds to
        # unwind (the call runs in a thread cancel() can't interrupt), and blocking
        # the RPC on that hung Stop past the client deadline. cancel() is
        # fire-and-forget; the read-model projection below marks the session
        # terminal right now, so the board is correct immediately regardless of
        # when the cancelled turn actually finishes dying.
        task = self._running.pop(request.session_id, None)
        stopped = False
        if task and not task.done():
            task.cancel()
            stopped = True
        if self._rm:
            try:
                await self._rm.stop_incomplete(request.session_id)  # no step left 'running'
                # Nothing of this session's is waiting on a reply any more. Left
                # behind, the wait would keep its mailbox subscription renewing
                # forever for work nobody is doing — and a late reply would try
                # to resume a stopped plan.
                await self._rm.cancel_mail_waits(request.session_id)
                # 'canceled' (one L, the client board spelling), not 'completed':
                # a user Stop is a deliberate termination, distinct from a plan
                # that ran to the end.
                await self._rm.set_session_status(request.session_id, "canceled")
            except Exception as e:
                logger.warning("StopSession projection failed: %s", e)
        return pb.StopSessionResponse(stopped=stopped)

    async def PauseSession(self, request: pb.PauseSessionRequest, context) -> pb.PauseSessionResponse:
        """Cancel the in-flight turn but keep the plan. The session goes `paused`;
        a later RunTask continues the remaining steps. Non-terminal (vs Stop)."""
        task = self._running.get(request.session_id)
        paused = False
        if task and not task.done():
            task.cancel()
            try:
                await task
            except BaseException:  # noqa: BLE001 — expected cancellation
                pass
            paused = True
        if self._rm:
            try:
                await self._rm.pause_running_steps(request.session_id)
                await self._rm.set_session_status(request.session_id, "paused")
            except Exception as e:
                logger.warning("PauseSession projection failed: %s", e)
        logger.info("[worky] PauseSession (session=%s paused=%s)", request.session_id, paused)
        return pb.PauseSessionResponse(paused=paused)

    async def DeliverMailReply(self, request: pb.DeliverMailReplyRequest,
                               context) -> pb.DeliverMailReplyResponse:
        """An email reply arrived for a parked step: resolve the routing token and
        resume that step with the reply as its answer.

        The caller (the mail webhook) holds a token and nothing else — only worky
        can turn it into a session/step/interrupt. Continuation itself is not
        reimplemented here: this resolves, then hands off to the same resume_turn
        the RunTask path uses, so there is one continuation implementation.
        """
        if self._rm is None:
            context.set_code(grpc.StatusCode.UNIMPLEMENTED)
            context.set_details("read model not configured")
            return pb.DeliverMailReplyResponse(delivered=False)

        # Claim before anything else: this is what makes a duplicate delivery a
        # no-op instead of a second resume. Graph retries whatever it thinks
        # failed, so this path is walked twice as a matter of course.
        wait = await self._rm.claim_mail_wait(request.token)
        if wait is None:
            logger.info("[worky] DeliverMailReply ignored — token unknown, already "
                        "delivered, expired or cancelled")
            return pb.DeliverMailReplyResponse(delivered=False)

        session_id, user_id = wait["session_id"], wait["user_id"]
        logger.info("[worky] DeliverMailReply ◄ session=%s step=%s from=%s (%d chars)",
                    session_id, wait["step_id"], request.reply_from or "?",
                    len(request.reply_body))

        # Ack immediately and resume in the background: the caller is answering a
        # Graph webhook on a clock, and the resumed plan can run for minutes.
        executor = _agent_by_type(request.agents, EXECUTOR_AGENT_TYPE)
        model = (executor.chatbot.model if executor else "") or DEFAULT_MODEL
        prev = self._running.get(session_id)
        task = asyncio.create_task(self._resume_with_reply(request, wait, model, prev))
        self._bg.add(task)
        task.add_done_callback(self._bg.discard)
        task.add_done_callback(self._forget_running(session_id))
        self._running[session_id] = task
        return pb.DeliverMailReplyResponse(
            delivered=True, session_id=session_id, step_id=wait["step_id"])

    async def _resume_with_reply(self, request: pb.DeliverMailReplyRequest, wait: dict,
                                 model: str, prev: Optional[asyncio.Task] = None) -> None:
        session_id = wait["session_id"]
        try:
            # Same last-answer-wins handshake as RunTask: never let two turns run
            # on one session, or the reply races whatever is already in flight.
            if prev is not None and not prev.done():
                logger.info("[worky] superseding in-flight turn for mail reply (session=%s)",
                            session_id)
                prev.cancel()
                try:
                    await prev
                except BaseException:  # noqa: BLE001 — prev's cancellation is expected
                    pass
            executor = _agent_by_type(request.agents, EXECUTOR_AGENT_TYPE)
            # A reply quotes the mail it answers, so it carries our own
            # outbound subject line — routing token included. That text
            # becomes the step's result and hence the next step's context, so
            # without this the executor sees a token it is never supposed to
            # know about, and echoes it into the next mail's subject. See
            # mail_token.scrub.
            # Attribute the reply to the human who wrote it, in the text itself.
            # ADK renders injected content as "[<author>] said: ...", and the
            # author is the workflow — named plan_<session_id> (service.py) — so
            # an unlabelled reply reaches the next step looking like an
            # instruction from the PLAN. Seen live in session
            # 2e7fa392c64e4a35b9f77e70d49d275d: Firas replied "do me a search
            # about new mcps ... then i can tell what we can implement", the step
            # read "[plan_2e7fa392...] said:" as the plan's own wording, decided
            # the searches "are already part of the plan's other steps — not this
            # step's job", and did nothing at all. Naming the sender here beats
            # renaming the workflow: this is the only place a reply enters, and
            # the label lands inside the content where no author rendering can
            # override it.
            sender = (request.reply_from or "").strip()
            answer = mail_token.scrub(request.reply_body)
            answer = (f"Email reply from {sender}, answering the message this step was "
                      f"waiting on:\n\n{answer}" if sender else
                      f"Email reply answering the message this step was waiting on:"
                      f"\n\n{answer}")
            await self._svc.resume_turn(
                session_id=session_id, user_id=wait["user_id"],
                answer=answer, model=model,
                connectors=_connectors_to_dicts(request.connectors),
                interrupt_id=wait["interrupt_id"],
                executor_prompt=executor.prompt if executor else None)
            logger.info("[worky] DeliverMailReply turn done (session=%s step=%s)",
                        session_id, wait["step_id"])
        except asyncio.CancelledError:
            logger.info("[worky] DeliverMailReply turn superseded/cancelled (session=%s)",
                        session_id)
            raise
        except Exception:
            logger.exception("[worky] DeliverMailReply turn failed (session=%s step=%s)",
                             session_id, wait["step_id"])
