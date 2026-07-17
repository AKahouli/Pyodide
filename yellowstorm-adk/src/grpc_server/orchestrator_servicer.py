"""AgentOrchestrator gRPC servicer — maps the 4 RPCs onto OrchestratorService.

Write side only (CQRS): RunTask runs the turn in the background and acks; the
client reads live progress from ElectricSQL. GetSession returns a one-shot
snapshot for initial load.

This is where a turn begins: STEP 1-4 below are the first four of the ten-step
sequence documented in companion_ai/service.py; STEP 5-10 continue there.
"""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from typing import Dict, Optional, Set

import grpc

from src.grpc_generated import orchestrator_pb2 as pb
from src.grpc_generated import orchestrator_pb2_grpc as pb_grpc
from src.companion_ai.readmodel import ReadModel
from src.companion_ai.service import OrchestratorService

logger = logging.getLogger(__name__)


def _parse_mcp_config(raw: str) -> dict:
    """Parse the connector's mcp_server_config_json (JSON string) into a dict."""
    if not raw:
        return {}
    try:
        val = json.loads(raw)
        return val if isinstance(val, dict) else {}
    except (json.JSONDecodeError, TypeError):
        return {}


def _describe_request(request) -> str:
    """One-line dump of every RunRequest field, secrets redacted (connector
    auth_headers carry Bearer tokens; skill instructions are large)."""
    skills = [{"id": s.id, "name": s.name} for s in request.skills]
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
        f"model={request.model!r} idempotency_key={request.idempotency_key!r} "
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


class AgentOrchestratorServicer(pb_grpc.AgentOrchestratorServicer):
    def __init__(self, service: OrchestratorService, read_model: Optional[ReadModel] = None,
                 *, default_model: str = "gpt-5.4-mini"):
        self._svc = service
        self._rm = read_model
        self._default_model = default_model
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

        # STEP 2 — claim the idempotency key so a retried command runs at most
        # once per session. Durable (Postgres) so it holds across restarts and
        # multiple replicas.
        if request.idempotency_key and self._rm is not None:
            first = await self._rm.claim_run(
                request.session_id, request.idempotency_key, run_id)
            if not first:
                logger.info("[worky] 2. duplicate idempotency_key ignored (session=%s)",
                            request.session_id)
                return pb.RunResponse(session_id=request.session_id, accepted=False, run_id=run_id)

        # STEP 3 — ack now, run the turn in the background. The client watches
        # progress arrive in the read model, not on this call. Last-answer-wins:
        # hand the in-flight turn (if any) to the new one so it supersedes it.
        model = request.model or self._default_model
        prev = self._running.get(request.session_id)
        task = asyncio.create_task(self._run_turn(request, model, run_id, prev))
        self._bg.add(task)
        task.add_done_callback(self._bg.discard)
        task.add_done_callback(self._forget_running(request.session_id))
        self._running[request.session_id] = task
        logger.info("[worky] 3. RunTask accepted → background turn (session=%s run=%s)",
                    request.session_id, run_id)
        return pb.RunResponse(session_id=request.session_id, accepted=True, run_id=run_id)

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
            if interrupt_id:
                await self._svc.resume_turn(
                    session_id=request.session_id, user_id=request.user_id,
                    answer=request.message, model=model, connectors=connectors)
            elif status == "paused":
                await self._svc.continue_turn(
                    session_id=request.session_id, user_id=request.user_id,
                    model=model, connectors=connectors)
            else:
                await self._svc.plan_turn(
                    session_id=request.session_id, user_id=request.user_id,
                    message=request.message, model=model, connectors=connectors)
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
        task = self._running.get(request.session_id)
        stopped = False
        if task and not task.done():
            task.cancel()
            stopped = True
        if self._rm:
            try:
                await self._rm.stop_incomplete(request.session_id)  # no step left 'running'
                await self._rm.set_session_status(request.session_id, "completed")
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
