"""AgentOrchestrator gRPC servicer — maps the 4 RPCs onto OrchestratorService.

Write side only (CQRS): RunTask runs the turn in the background and acks; the
client reads live progress from ElectricSQL. GetSession returns a one-shot
snapshot for initial load.
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Dict, Optional, Set

import grpc

from src.grpc_generated import orchestrator_pb2 as pb
from src.grpc_generated import orchestrator_pb2_grpc as pb_grpc
from src.orchestrator.readmodel import ReadModel
from src.orchestrator.service import OrchestratorService

logger = logging.getLogger(__name__)


class AgentOrchestratorServicer(pb_grpc.AgentOrchestratorServicer):
    def __init__(self, service: OrchestratorService, read_model: Optional[ReadModel] = None,
                 *, default_model: str = "gpt-5.4-mini"):
        self._svc = service
        self._rm = read_model
        self._default_model = default_model
        self._bg: Set[asyncio.Task] = set()          # keep strong refs
        self._running: Dict[str, asyncio.Task] = {}   # session_id -> turn task
        self._seen_idem: Set[str] = set()             # session_id + '\0' + key

    async def CreateSession(self, request: pb.CreateSessionRequest, context) -> pb.CreateSessionResponse:
        session_id = uuid.uuid4().hex
        if self._rm:
            try:
                await self._rm.ensure_session(session_id, request.user_id, None, "pending")
            except Exception as e:
                logger.warning("CreateSession projection failed: %s", e)
        return pb.CreateSessionResponse(session_id=session_id)

    async def RunTask(self, request: pb.RunRequest, context) -> pb.RunResponse:
        run_id = uuid.uuid4().hex
        # Idempotency: a retried command runs at most once per session.
        if request.idempotency_key:
            key = f"{request.session_id}\0{request.idempotency_key}"
            if key in self._seen_idem:
                logger.info("RunTask duplicate idempotency_key ignored (session=%s)", request.session_id)
                return pb.RunResponse(session_id=request.session_id, accepted=False, run_id=run_id)
            self._seen_idem.add(key)

        model = request.model or self._default_model
        task = asyncio.create_task(self._run_turn(request, model, run_id))
        self._bg.add(task)
        task.add_done_callback(self._bg.discard)
        self._running[request.session_id] = task
        logger.info("RunTask accepted (session=%s run=%s)", request.session_id, run_id)
        return pb.RunResponse(session_id=request.session_id, accepted=True, run_id=run_id)

    async def _run_turn(self, request: pb.RunRequest, model: str, run_id: str) -> None:
        try:
            # TODO: materialize request.connectors into ADK tools (per-user MCP
            # servers) and pass as connectors_tools. Empty for now.
            # If the session is blocked on ask-the-user, this message is the
            # answer → resume; otherwise it's a new turn → plan.
            waiting = False
            if self._rm is not None:
                snap = await self._rm.snapshot(request.session_id)
                waiting = bool(snap and snap["session"].get("status") == "waiting"
                               and snap["session"].get("interrupt_id"))
            if waiting:
                await self._svc.resume_turn(
                    session_id=request.session_id, user_id=request.user_id,
                    answer=request.message, model=model, connectors_tools=[])
            else:
                await self._svc.plan_turn(
                    session_id=request.session_id, user_id=request.user_id,
                    message=request.message, model=model, connectors_tools=[])
            logger.info("RunTask turn done (session=%s run=%s)", request.session_id, run_id)
        except asyncio.CancelledError:
            logger.info("RunTask turn cancelled (session=%s)", request.session_id)
            raise
        except Exception:
            logger.exception("RunTask turn failed (session=%s run=%s)", request.session_id, run_id)
        finally:
            self._running.pop(request.session_id, None)

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
                await self._rm.set_session_status(request.session_id, "completed")
            except Exception as e:
                logger.warning("StopSession projection failed: %s", e)
        return pb.StopSessionResponse(stopped=stopped)
