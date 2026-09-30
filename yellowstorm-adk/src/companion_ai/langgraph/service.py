"""LgService — the LangGraph engine behind the same entrypoints the gRPC servicer
calls (plan_turn / resume_turn / continue_turn / converse_turn / fail_session).

Hybrid by design: PLANNING, PROJECTION, mail-wait registration and all read-model
chat/session writes are reused from the proven ADK OrchestratorService (a single
planner LLM call has no replay surface, so there is nothing to gain by rewriting
it). Only EXECUTION and RESUME run on LangGraph (LgRunner) — that is where the
replay-divergence class lived.

Drop-in: same method signatures, so bootstrap hands either engine to the servicer
behind ORCHESTRATOR_ENGINE.

Known gaps vs ADK (need the live backend to validate; connector-parity increment):
persona preambles / human-agent delegate + create_task tools; artifact capture;
the approval gate (separate-node pattern); converse/continue on LG plans. These
raise or degrade explicitly rather than silently misbehave.
"""
from __future__ import annotations

import logging
import uuid
from typing import List, Optional

from .. import scheduler
from ..plan import Plan, Status, Step
from ..adk.service import DEFAULT_EXECUTOR_LABEL, _answer_target, _with_requester
from .runner import LgRunner, plan_from_snapshot
from .tools import make_stamping_tools_for

logger = logging.getLogger(__name__)


class LgService:
    def __init__(self, orchestrator, read_model, checkpointer, *, model=None):
        self._orch = orchestrator          # reuse: planner, projection, chat/session writes
        self._rm = read_model
        self._cp = checkpointer            # a live LangGraph checkpointer
        self._model = model                # test seam: a fake chat model; None = real

    def _runner(self, model, connectors, session_id, user_id, plan, executor_prompt):
        return LgRunner(model, read_model=self._rm,
                        tools_for=make_stamping_tools_for(connectors, session_id, user_id,
                                                          plan, self._rm),
                        instruction=executor_prompt)

    async def plan_turn(self, *, session_id: str, user_id: str, message: str,
                        model: str, connectors: Optional[List[dict]] = None,
                        planner_connectors: Optional[List[dict]] = None,
                        planner_model: Optional[str] = None,
                        planner_prompt: Optional[str] = None,
                        executor_prompt: Optional[str] = None,
                        executor_name: Optional[str] = None,
                        executor_id: Optional[str] = None,
                        requester: Optional[dict] = None) -> Plan:
        if self._rm is not None:
            await self._rm.ensure_session(session_id, user_id, None, "running")
        executor_prompt = _with_requester(executor_prompt, requester)

        plan = await self._orch._make_plan(
            session_id, user_id, message, planner_model=planner_model,
            planner_prompt=planner_prompt, planner_connectors=planner_connectors,
            requester=requester)
        # retry once on an empty planner response (mirrors ADK plan_turn)
        if not plan.steps and not (plan.answer or "").strip():
            plan = await self._orch._make_plan(
                session_id, user_id, message, planner_model=planner_model,
                planner_prompt=planner_prompt, planner_connectors=planner_connectors,
                plan_session=f"{session_id}_plan_retry_{uuid.uuid4().hex[:6]}",
                requester=requester)

        # direct reply (chit-chat) or a broken empty plan
        if not plan.steps:
            answer = (plan.answer or "").strip()
            if answer:
                logger.info("[worky-lg] direct reply (no plan) session=%s", session_id)
                await self._orch._add_message(session_id, "assistant", answer)
                await self._rm.set_session_status(session_id, "completed")
            else:
                await self._orch._add_error_message(
                    session_id, "Échec de la planification : le planificateur n'a produit "
                    "aucun plan (0 étape, réponse vide).", title="Échec de la planification")
                await self._rm.set_session_status(session_id, "failed")
            return plan

        plan.executor_id = executor_id
        plan.executor_name = executor_name or DEFAULT_EXECUTOR_LABEL
        for s in plan.steps:
            if not s.is_persona:
                s.assignee = executor_id
                s.assignee_name = executor_name or DEFAULT_EXECUTOR_LABEL

        scheduler.validate(plan)
        scheduler.assign_waves(plan)
        await self._orch._project_plan(session_id, plan, user_id)
        logger.info("[worky-lg] plan_turn: %d step(s) session=%s", len(plan.steps), session_id)
        result = await self._runner(model, connectors, session_id, user_id, plan,
                                    executor_prompt).run(plan, session_id, self._cp,
                                                         model=self._model)
        await self._finalize(session_id, result)
        return plan

    async def resume_turn(self, *, session_id: str, user_id: str, answer: str,
                          model: str, connectors: Optional[List[dict]] = None,
                          interrupt_id: Optional[str] = None,
                          step_id: Optional[str] = None,
                          executor_prompt: Optional[str] = None) -> Plan:
        if self._rm is None:
            raise RuntimeError("resume requires the read model")
        snap = await self._rm.snapshot(session_id)
        if not snap:
            raise RuntimeError(f"session {session_id} unknown; nothing to resume")
        plan = plan_from_snapshot(snap)  # tools_for needs the plan's send->await edges
        runner = self._runner(model, connectors, session_id, user_id, plan, executor_prompt)
        if step_id:
            # mail/Teams reply for a state-driven await_reply step: no interrupt,
            # write the reply into state and re-drive (only this branch advances).
            logger.info("[worky-lg] resume_turn: reply step=%s session=%s", step_id, session_id)
            result = await runner.deliver_reply(session_id, step_id, answer, self._cp,
                                                model=self._model)
        else:
            # ask / gate verdict: still an interrupt() -> resume it by id.
            interrupt_id = (_answer_target(answer) or interrupt_id
                            or snap["session"].get("interrupt_id"))
            if not interrupt_id:
                raise RuntimeError(f"session {session_id} is not waiting on input")
            logger.info("[worky-lg] resume_turn: iid=%s session=%s", interrupt_id, session_id)
            result = await runner.resume(session_id, interrupt_id, answer, self._cp,
                                         model=self._model)
        await self._finalize(session_id, result)
        return plan_from_snapshot(await self._rm.snapshot(session_id))

    async def _finalize(self, session_id: str, result: dict) -> None:
        """STEP 10 equivalent. Reads AUTHORITATIVE step statuses back from the read
        model (the nodes projected running/completed/failed; _drive projected
        blocked), then adds the CHAT projection the UI needs: post the assistant
        reply (done) or surface each ask question (parked), and an error card for
        any step that self-reported STEP_FAILED. Mail waits + session status were
        already reconciled by LgRunner._drive."""
        plan = plan_from_snapshot(await self._rm.snapshot(session_id))

        parked = result.get("parked") or []
        if parked:
            await self._rm.upsert_plan(session_id, plan.id, plan.title, plan.goal, "blocked")
            for _iid, step_id, kind in parked:
                if kind == "ask":               # a mail wait waits on the world, not the user
                    step = plan.step(step_id)
                    if step:
                        await self._orch._add_message(
                            session_id, "assistant", step.question or step.description or "")
            return

        # done — post the terminal answer, then an error card for any failed step
        answer = self._orch._assistant_answer(plan)
        await self._orch._add_message(session_id, "assistant", answer)
        failed = [s for s in plan.steps if s.status is Status.FAILED]
        if failed:
            errs = "\n".join(f"• {s.title or s.id}: {(s.result or 'échec').splitlines()[0][:200]}"
                             for s in failed)
            await self._orch._add_error_message(
                session_id, errs, title="Certaines étapes ont échoué")
        status = scheduler.derive_status(plan)
        await self._rm.upsert_plan(session_id, plan.id, plan.title, plan.goal, status.value)
        await self._rm.set_session_status(
            session_id, "completed" if status is Status.COMPLETED else status.value)

    # --- engine-agnostic read-model ops: reuse the ADK service verbatim ---
    async def fail_session(self, session_id: str, exc: BaseException) -> None:
        await self._orch.fail_session(session_id, exc)

    async def expire_mail_waits(self) -> int:
        return await self._orch.expire_mail_waits()

    async def continue_turn(self, *, session_id: str, user_id: str, model: str,
                            connectors: Optional[List[dict]] = None,
                            executor_prompt: Optional[str] = None) -> Plan:
        """Resume a paused plan from its checkpoint (no new input)."""
        if self._rm is None:
            raise RuntimeError("continue requires the read model")
        snap = await self._rm.snapshot(session_id)
        if not snap:
            raise RuntimeError(f"session {session_id} unknown; nothing to continue")
        plan = plan_from_snapshot(snap)
        logger.info("[worky-lg] continue_turn session=%s", session_id)
        result = await self._runner(model, connectors, session_id, user_id, plan,
                                    executor_prompt).continue_run(session_id, self._cp,
                                                                  model=self._model)
        await self._finalize(session_id, result)
        return plan_from_snapshot(await self._rm.snapshot(session_id))

    async def converse_turn(self, *, session_id: str, user_id: str, message: str,
                            planner_model: Optional[str] = None,
                            planner_prompt: Optional[str] = None,
                            planner_connectors: Optional[List[dict]] = None,
                            requester: Optional[dict] = None,
                            connectors: Optional[List[dict]] = None,
                            executor_prompt: Optional[str] = None,
                            model: Optional[str] = None) -> Plan:
        """A message arriving while a plan exists. CASE A (no steps/ops) → answer in
        place. CASE B → apply ops + inject the amend's steps into the existing plan,
        then DRIVE the newly-ready ones via goto (LG has no background loop). New
        steps are namespaced independently by the planner, anchored on completed
        leaves by _inject_steps, so they run in parallel without re-running done work."""
        snap = await self._rm.snapshot(session_id) if self._rm else None
        ctx_plan = plan_from_snapshot(snap) if snap else None
        amend_message = (self._orch._amend_message(ctx_plan, message) + self._orch._pending_note(snap)
                         if ctx_plan is not None else message)
        amend = await self._orch._make_plan(
            session_id, user_id, amend_message, planner_model=planner_model,
            planner_prompt=planner_prompt, planner_connectors=planner_connectors,
            plan_session=f"{session_id}_conv_{uuid.uuid4().hex[:8]}", requester=requester)

        if (not amend.steps and not amend.ops) or ctx_plan is None:
            await self._orch._add_message(session_id, "assistant", amend.answer or "")
            return amend

        titles = [s.title or s.description[:50] for s in amend.steps]
        # Inject new steps FIRST — assigns real ids (id_map), upserts read-model rows,
        # registers mail-wait tokens for new awaits, appends to ctx_plan. Then apply
        # ops (cancel/modify/insert_before/reparent), which may re-point EXISTING steps
        # onto a just-injected one (so insert_before can resolve the new id).
        id_map: dict = {}
        n = await self._orch._inject_steps(session_id, user_id, ctx_plan, amend.steps,
                                           id_map_out=id_map)
        await self._orch._apply_ops(session_id, ctx_plan, amend.ops, id_map=id_map)
        # EXECUTION edit = one state push (same mechanism as an executor spawn): the
        # new steps + any op-touched existing steps go into the loop's checkpoint via
        # merge_plan, and the next tick runs whatever became ready. Read-model was
        # already synced above; this is only the running loop's state.
        changed = [ctx_plan.step(o.get("step_id", "")) for o in amend.ops
                   if o.get("step_id") and ctx_plan.step(o.get("step_id", ""))]
        changed = [s for s in changed if s and s.status in (Status.PENDING, Status.CANCELLED)]
        reply = (amend.answer or "").strip() or (
            f"C'est noté — ajouté : {'; '.join(t for t in titles if t)}." if titles
            else "C'est noté.")
        await self._orch._add_message(session_id, "assistant", reply)

        if n or changed:
            logger.info("[worky-lg] converse: %d new + %d changed step(s) session=%s",
                        n, len(changed), session_id)
            result = await self._runner(model, connectors, session_id, user_id, ctx_plan,
                                        executor_prompt).inject_and_continue(
                                            session_id, amend.steps, self._cp, model=self._model,
                                            changed_steps=changed)
            await self._finalize(session_id, result)
        return plan_from_snapshot(await self._rm.snapshot(session_id))
