"""Orchestrator service — drives one turn: plan -> graph -> execute -> project.

The numbered STEP comments below (and the "[worky] N." log lines) are one
sequence covering a whole turn, from the moment the user's message arrives.
Steps 1-4 live in grpc_server/orchestrator_servicer.py; 5-10 are here:

    STEP 1  RunTask receives the user's message                 (servicer)
    STEP 2  claim the idempotency key — run at most once        (servicer)
    STEP 3  ack immediately, run the turn in the background     (servicer)
    STEP 4  new turn, or the answer to a pending question?      (servicer)
    STEP 5  planner LLM → Plan{ steps + depends_on }, or a direct reply
    STEP 6  validate the DAG + assign parallel waves
    STEP 7  project plan + steps (pending) to the read model
    STEP 8  connectors → tools, to_workflow(plan) → ADK Workflow
    STEP 9  Runner.run_async() → map node events → live step status
    STEP 10 derive + project the final plan/session status, post the reply

The planner is an LlmAgent asked to emit strict JSON; execution is the Workflow
whose nodes are per-step LlmAgents. Event→step mapping uses node_info.path
(verified: path segment = the graph node name = the sanitized step id).
"""
from __future__ import annotations

import json
import logging
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Optional, Tuple

from google.adk.agents import LlmAgent
from google.adk.runners import Runner
from google.genai import types

from . import graph, hitl, mail_token, nodes, scheduler
from .plan import Plan, Status, Step
from .readmodel import ReadModel

logger = logging.getLogger(__name__)

PLANNER_INSTRUCTION = """You are a planning agent for a multi-agent assistant.
First decide whether the user's message needs a PLAN or just a DIRECT REPLY.

Return ONLY strict JSON, no prose.

CASE A — trivial / conversational ONLY: greetings, small talk, thanks,
acknowledgements, or a question you can answer purely from your own general
knowledge with NO external or live data. DO NOT create a plan. Reply directly:
{{"title": "", "goal": "", "answer": "<your direct reply to the user>", "steps": []}}

Use CASE A only for genuine chit-chat. If the request needs current/live info, a
web search, looking something up, fetching data, using a tool/connector, or
producing any real deliverable — it is CASE B, even if it's one step. The
executor agents HAVE tools (web search, connectors); never answer directly or
refuse just because YOU cannot browse or lack live data — route it to an
"execute" step instead.

CASE B — a real task that needs work or several actions. Return a plan:
{{
  "title": "<short plan title>",
  "goal": "<one-sentence goal>",
  "answer": "",
  "steps": [
    {{"id": "s1", "kind": "execute", "title": "<short label>", "description": "<full instruction>", "depends_on": []}},
    {{"id": "s2", "kind": "ask", "title": "<short label>", "question": "<question for the user>", "description": "", "depends_on": ["s1"]}},
    {{"id": "s3", "kind": "await_reply", "title": "<short label>", "question": "<what reply is awaited, and from whom>", "description": "", "depends_on": ["s1"]}}
  ]
}}

Rules:
- Prefer CASE A whenever one message answers the user. Most chit-chat and simple
  questions do NOT need a plan — only plan when there is genuine multi-step work.
- title: a SHORT, user-facing label (max ~6 words) shown on the UI card so a
  person understands the step at a glance — e.g. "Search Bitcoin price", "Ask
  which option to run", "Write the introduction". EVERY step needs a title,
  including "ask" steps. Never "Step 1" and never the whole task restated.
- description: the FULL instruction the executor agent will act on (1–2 clear
  sentences). For "ask" steps leave it "" — the user-facing text goes in "question".
- kind is one of:
  - "execute": an agent does the work (this is the default — use it for sending
    an email, searching, writing, anything with a tool).
  - "ask": pause and ask the USER a question. Use ONLY when you genuinely need
    input you cannot get otherwise; give it a "question".
  - "await_reply": pause until SOMEONE ELSE replies to an email a previous step
    sent. See below.
- Use "await_reply" whenever the task depends on a REPLY to a mail you send —
  "email X and then ...", "ask X by email and report back", "wait for their
  answer". Without it the plan would send the mail and carry on as if the answer
  had arrived, inventing one.
  It is ALWAYS a separate step from the send, and it MUST depends_on the step
  that sends the mail — that link is how the reply finds its way back. Its
  "question" says what is awaited and from whom (e.g. "Awaiting a reply from
  rabeb@example.com about her company"). Steps that need the answer depend on
  the await_reply step, not on the send step.
  Do NOT use it for mail you send that needs no answer (a notification, a
  report), and do NOT use it to wait for anything other than an email reply.
- ids are short unique strings. depends_on lists ids that MUST finish first;
  leave it [] for independent steps.
- Prefer parallelism: only add a dependency when a step truly needs another's output.
- No cycles.

Example — "email rabeb asking which company she works for, then report on it":
{{"title": "Company report", "goal": "Report on the company Rabeb works for", "answer": "",
  "steps": [
    {{"id": "s1", "kind": "execute", "title": "Email Rabeb", "description": "Send an email to rabeb@example.com asking which company she works for.", "depends_on": []}},
    {{"id": "s2", "kind": "await_reply", "title": "Await her reply", "question": "Awaiting a reply from rabeb@example.com naming her company", "description": "", "depends_on": ["s1"]}},
    {{"id": "s3", "kind": "execute", "title": "Research the company", "description": "Research the company named in the reply and write a short report.", "depends_on": ["s2"]}}
  ]}}"""


def _node_to_step_name(path: str) -> str:
    """'wf@1/step_a@1' -> 'step_a' (strip parents and @version)."""
    seg = path.split("/")[-1]
    return seg.split("@")[0]


def _plan_from_snapshot(snap: dict) -> Plan:
    """Rebuild a Plan from a read-model snapshot so resume reconstructs the same
    workflow graph (same step ids + depends_on => same node names + edges)."""
    p = snap["plan"] or {}
    steps = []
    for row in snap["steps"]:
        deps = [d for d in (row.get("depends_on") or "").split(",") if d]
        steps.append(Step(
            id=row["step_id"], title=row.get("title") or "",
            description=row.get("description") or "",
            kind=row.get("kind") or "execute", question=row.get("question"),
            depends_on=deps, status=Status(row["status"]),
            wave=row.get("wave") or 0, result=row.get("result")))
    return Plan(id=p.get("id") or "", title=p.get("title") or "",
                goal=p.get("goal") or "", status=Status(p.get("status") or "running"),
                steps=steps)


async def _ensure_session(runner, app_name: str, user_id: str, session_id: str) -> None:
    """Get-or-create — durable sessions persist, so re-running a session_id must
    not collide on create."""
    ss = runner.session_service
    existing = await ss.get_session(app_name=app_name, user_id=user_id, session_id=session_id)
    if existing is None:
        await ss.create_session(app_name=app_name, user_id=user_id, session_id=session_id)


def _extract_json(text: str) -> dict:
    """Tolerant JSON extraction from an LLM response (handles ```json fences)."""
    text = text.strip()
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if not m:
        raise ValueError(f"planner returned no JSON: {text[:200]}")
    return json.loads(m.group(0))


class OrchestratorService:
    def __init__(self, runner_factory, read_model: Optional[ReadModel] = None,
                 *, planner_model: str, max_concurrency: int = 4,
                 pool=None, schema: str = "public", mail_wait_timeout_hours: int = 72):
        """runner_factory(node, app_name) -> Runner (so session service / app wiring
        stays with the caller). read_model may be None (projection disabled).
        pool/schema are used to record set-and-forget long-running MCP tasks."""
        self._runner_factory = runner_factory
        self._rm = read_model
        self._planner_model = planner_model
        self._max_concurrency = max_concurrency
        self._pool = pool
        self._schema = schema
        self._mail_wait_timeout_hours = mail_wait_timeout_hours

    async def expire_mail_waits(self) -> int:
        """Let down every step whose reply never came: the wait becomes an
        ordinary question to the owner, on the same interrupt the step is already
        parked on.

        Nothing is re-planned and no node re-runs — the step is parked on a
        `mail:` interrupt either way, and this only changes who may answer it and
        tells the owner it is their turn. That reuse is why the fallback is
        nearly free: the resume path does not care where the answer came from.
        """
        if self._rm is None:
            return 0
        expired = await self._rm.expire_mail_waits()
        for wait in expired:
            session_id, step_id = wait["session_id"], wait["step_id"]
            reason = (f"no reply from {wait['expected_from']}"
                      if wait.get("expected_from") else "no reply received")
            logger.info("[worky] mail wait expired session=%s step=%s — asking the owner",
                        session_id, step_id)
            await self._project(self._rm.set_step_status(
                session_id, step_id, "blocked", blocked_reason=reason,
                interrupt_id=wait["interrupt_id"]))
            await self._add_message(
                session_id, "assistant",
                f"I haven't had a reply ({reason}). Do you want to answer for them, "
                f"or should I skip this step?")
            # The step keeps its mail: interrupt, but the session now points at it
            # so a chat reply is routed there — the owner can answer by hand.
            await self._project(self._rm.set_waiting(session_id, wait["interrupt_id"]))
        return len(expired)

    def _tools_for(self, connectors: Optional[List[dict]], session_id: str, user_id: str) -> List:
        """Materialize connectors into executor tools: the synchronous MCP action
        tools plus, per connector, a fire-and-forget `schedule_*_task` tool for
        long-running actions (records the handle in mcp_tasks for the poller).

        Uses the app's proven `create_connector_tools` (per-action function tools
        that open a one-shot MCP connection via call_mcp_tool) — NOT ADK's
        McpToolset, whose session manager triggers Google-auth mTLS metadata
        probes that stall and fail off-GCP."""
        connectors = connectors or []
        from src.smart_rag.tools.utilities.connector_tools import (
            create_connector_tools, ConnectorToolContext)
        from . import long_running, mcp_tasks
        tools = create_connector_tools(connectors, ConnectorToolContext(session_id=session_id))
        for c in connectors:
            async def _record(task_id, action, args, _c=c):
                if self._pool is not None:
                    await mcp_tasks.enqueue(
                        self._pool, session_id=session_id, user_id=user_id, task_id=task_id,
                        server_name=_c.get("connector_name", ""), server_url=_c.get("mcp_server_url", ""),
                        auth_headers=_c.get("auth_headers") or {}, mode="record", schema=self._schema)
            tools.append(long_running.make_schedule_tool(c, on_started=_record))
        return tools

    def _mail_stamping(self, session_id: str, plan: Plan):
        """Give each send step the token of the step waiting on its reply.

        The link is the plan's own edge: an await_reply step depends_on the step
        that sends the mail it waits for. Nothing else in the plan needs to know,
        and the executor LLM never sees the token — a marker it was merely asked
        to include would be omitted eventually, and that step would wait forever.

        Returns None when the plan has no await_reply step, so the ordinary case
        builds the ordinary tools.
        """
        if self._rm is None:
            return None
        await_step_for: dict = {}
        for s in plan.steps:
            if s.kind == "await_reply":
                for dep in s.depends_on:
                    # First wins: a send step feeding two waits can only carry one
                    # token, and its reply can only answer one of them.
                    await_step_for.setdefault(dep, s.id)
        if not await_step_for:
            return None
        rm = self._rm

        def tools_for_step(step: Step, tools: List) -> List:
            await_step_id = await_step_for.get(step.id)
            if not await_step_id:
                return tools

            async def token_provider(_step_id=await_step_id):
                return await rm.mail_token_for(session_id, _step_id)

            return [nodes.stamp_send_email_tool(t, token_provider=token_provider)
                    if nodes.is_send_email_tool(t) else t
                    for t in tools]

        return tools_for_step

    async def _project(self, coro):
        if self._rm is None:
            return
        try:
            await coro
        except Exception as e:  # never let projection break the run
            logger.warning("read-model projection failed: %s", e)

    async def _add_message(self, session_id: str, role: str, content: str) -> None:
        """Project one chat turn into `messages` (the client's conversation view)."""
        if not content:
            return
        await self._project(self._rm and self._rm.add_message(
            uuid.uuid4().hex, session_id, role, content))

    @staticmethod
    def _assistant_answer(plan: Plan) -> str:
        """The chat reply for a completed plan: the results of its terminal steps
        (the leaves nothing depends on), or all step results if there's no leaf."""
        depended = {d for s in plan.steps for d in s.depends_on}
        terminals = [s.result for s in plan.steps if s.id not in depended and s.result]
        parts = terminals or [s.result for s in plan.steps if s.result]
        return "\n\n".join(parts)

    async def plan_turn(self, *, session_id: str, user_id: str, message: str,
                        model: str, connectors: Optional[List[dict]] = None) -> Plan:
        logger.info("[worky] 5. plan_turn ◄ session=%s model=%s connectors=%d",
                    session_id, model, len(connectors or []))
        await self._project(self._rm and self._rm.ensure_session(session_id, user_id, None, "running"))

        # STEP 5 — planner LLM → Plan. Zero steps means it chose a direct reply
        # (chit-chat): answer and finish the turn here, no graph is ever built.
        plan = await self._make_plan(session_id, user_id, message)
        logger.info("[worky] 5. planner LLM → Plan session=%s title=%r steps=%d",
                    session_id, plan.title, len(plan.steps))
        if not plan.steps:
            logger.info("[worky] 5. direct reply (no plan) → session=%s completed", session_id)
            await self._add_message(session_id, "assistant", plan.answer or "")
            await self._project(self._rm and self._rm.set_session_status(session_id, "completed"))
            return plan

        # STEP 6 — validate the DAG (a cyclic/dangling plan can never complete)
        # and assign waves: steps sharing a wave are independent and run together.
        scheduler.validate(plan)
        scheduler.assign_waves(plan)
        waves = max((s.wave for s in plan.steps), default=0) + 1
        logger.info("[worky] 6. validate + assign_waves → %d wave(s) session=%s",
                    waves, session_id)

        # STEP 7 — project the plan and its pending steps, so the client can
        # render the whole card before any step has run.
        await self._project_plan(session_id, plan, user_id)

        # STEP 8 — connectors → executor tools, plan → ADK Workflow.
        factory = nodes.make_llm_node_factory(
            model_name=model,
            tools=self._tools_for(connectors, session_id, user_id),
            tools_for_step=self._mail_stamping(session_id, plan))
        name_to_step = {graph.node_name(s.id): s.id for s in plan.steps}
        wf = graph.to_workflow(plan, factory, name=f"plan_{session_id}",
                               max_concurrency=self._max_concurrency)
        logger.info("[worky] 8. to_workflow → ADK Workflow %r (max_concurrency=%d) session=%s",
                    wf.name, self._max_concurrency, session_id)

        runner = self._runner_factory(wf, f"orch_{session_id}")
        await _ensure_session(runner, f"orch_{session_id}", user_id, session_id)

        # STEP 9 — run the graph; _drive maps node events to live step status.
        #
        # Deliberately NOT the user's real message. It would be recorded as a
        # session event with no branch — and ADK makes an unbranched event
        # visible to every node in the graph, unconditionally (contents.py:
        # `if not invocation_branch or not event.branch: return True`). That is
        # exactly how a step with a clean, single-purpose instruction ("search
        # Apple news") still saw the whole original request ("...email Rabeb...
        # search Tesla AND Apple...") and, some of the time, acted on parts of
        # it that were never its job — proven in production: the step still
        # sent its own unstamped copy of an email meant for a different step
        # entirely. No step's instruction depends on this trigger's content
        # (each already carries its own complete description); the durable
        # session persists it for the LIFETIME of the plan, so a leaky trigger
        # here also leaks into every later resume. continue_turn already uses
        # a benign trigger for the same reason.
        logger.info("[worky] 9. Runner.run_async → executing session=%s", session_id)
        interrupt = await self._drive(
            runner, session_id, user_id, plan, name_to_step,
            types.Content(role="user", parts=[types.Part(text="run the plan")]))

        # STEP 10 — derive the final status and post the assistant reply.
        await self._finalize(session_id, plan, interrupt)
        return plan

    async def resume_turn(self, *, session_id: str, user_id: str, answer: str,
                          model: str, connectors: Optional[List[dict]] = None,
                          interrupt_id: Optional[str] = None) -> Plan:
        """Resume a turn blocked on ask-the-user with the user's `answer`.

        Reached from STEP 4 when the session is waiting; skips planning (STEP
        5-7 already happened on the original turn) and rejoins the sequence at
        STEP 8 by rebuilding the same workflow from the stored plan. ADK replays
        completed nodes from the durable session and re-runs the blocked one
        with the answer injected.

        `interrupt_id` picks which parked step to answer when several are waiting
        (a chat reply has no such id and answers the session's first). Any other
        parked step stays parked and is still resumable afterwards."""
        if self._rm is None:
            raise RuntimeError("resume requires the read model")
        snap = await self._rm.snapshot(session_id)
        if not snap:
            raise RuntimeError(f"session {session_id} unknown; nothing to resume")
        interrupt_id = interrupt_id or snap["session"].get("interrupt_id")
        if not interrupt_id:
            raise RuntimeError(f"session {session_id} is not waiting on input")
        # Resuming an id that is not parked would answer nothing yet still let
        # _finalize complete the plan; refuse instead. Sessions parked before
        # per-step ids existed have no rows, so an empty set skips the check.
        outstanding = {i for i, _ in await self._rm.outstanding_interrupts(session_id)}
        if outstanding and interrupt_id not in outstanding:
            raise RuntimeError(
                f"interrupt {interrupt_id} is not outstanding for session {session_id}")

        # STEP 8 (resume) — same step ids + depends_on ⇒ same node names + edges,
        # which is what lets the interrupt id from the earlier run still match.
        plan = _plan_from_snapshot(snap)
        factory = nodes.make_llm_node_factory(
            model_name=model,
            tools=self._tools_for(connectors, session_id, user_id),
            tools_for_step=self._mail_stamping(session_id, plan))
        name_to_step = {graph.node_name(s.id): s.id for s in plan.steps}
        wf = graph.to_workflow(plan, factory, name=f"plan_{session_id}",
                               max_concurrency=self._max_concurrency)
        runner = self._runner_factory(wf, f"orch_{session_id}")
        await _ensure_session(runner, f"orch_{session_id}", user_id, session_id)
        # Keep the pending interrupt set while resuming so a correction that
        # arrives mid-resume is still routed as the answer (last-answer-wins). It
        # is cleared only when the turn finishes (set_session_status clears it, or
        # _finalize re-blocks with a new interrupt).

        # STEP 9 (resume) — same as a fresh turn, but the message carries the
        # resume part instead of user text.
        logger.info("[worky] 9. Runner.run_async → resuming session=%s interrupt=%s",
                    session_id, interrupt_id)
        interrupt = await self._drive(
            runner, session_id, user_id, plan, name_to_step,
            types.Content(role="user", parts=[hitl.resume_part(interrupt_id, {"value": answer})]))

        # STEP 10 — may block again if the plan has another ask step.
        await self._finalize(session_id, plan, interrupt)
        return plan

    async def continue_turn(self, *, session_id: str, user_id: str,
                            model: str, connectors: Optional[List[dict]] = None) -> Plan:
        """Continue a PAUSED plan (PauseSession cancelled the in-flight turn).

        Rebuilds the same workflow from the stored plan and re-drives it. ADK
        replays already-completed nodes from the durable session and runs the
        rest, so continue picks up where the pause left off. No answer is
        injected — this is not an ask resume."""
        if self._rm is None:
            raise RuntimeError("continue requires the read model")
        snap = await self._rm.snapshot(session_id)
        if not snap:
            raise RuntimeError(f"session {session_id} unknown; nothing to continue")

        plan = _plan_from_snapshot(snap)
        if all(s.is_done() for s in plan.steps):
            plan.status = scheduler.derive_status(plan)
            await self._project(self._rm.set_session_status(session_id, plan.status.value))
            return plan

        factory = nodes.make_llm_node_factory(
            model_name=model,
            tools=self._tools_for(connectors, session_id, user_id),
            tools_for_step=self._mail_stamping(session_id, plan))
        name_to_step = {graph.node_name(s.id): s.id for s in plan.steps}
        wf = graph.to_workflow(plan, factory, name=f"plan_{session_id}",
                               max_concurrency=self._max_concurrency)
        runner = self._runner_factory(wf, f"orch_{session_id}")
        await _ensure_session(runner, f"orch_{session_id}", user_id, session_id)
        await self._project(self._rm.set_session_status(session_id, "running"))  # paused -> running

        logger.info("[worky] 9. Runner.run_async → continuing paused plan session=%s", session_id)
        # A benign message: completed nodes replay and won't re-run, so its text
        # is irrelevant; the graph engine just proceeds with the pending steps.
        interrupt = await self._drive(
            runner, session_id, user_id, plan, name_to_step,
            types.Content(role="user", parts=[types.Part(text="continue")]))
        await self._finalize(session_id, plan, interrupt)
        return plan

    async def _drive(self, runner, session_id, user_id, plan, name_to_step, new_message):
        """Run the workflow, project step statuses, and capture every
        ask-the-user interrupt this run raised as [(interrupt_id, step_id), ...].

        A wave can park several steps at once (each asks its own question), and
        each is resumable on its own — so collect them all, not just the first.
        """
        started: set = set()
        interrupts: List[Tuple[str, Optional[str]]] = []
        seen: set = set()
        async for ev in runner.run_async(
                user_id=user_id, session_id=session_id, new_message=new_message):
            await self._apply_event(session_id, plan, ev, name_to_step, started)
            ni = getattr(ev, "node_info", None)
            step_id = (name_to_step.get(_node_to_step_name(ni.path))
                       if ni and getattr(ni, "path", None) else None)
            for iid in hitl.interrupt_ids(ev):
                if iid not in seen:
                    seen.add(iid)
                    interrupts.append((iid, step_id))
        return interrupts

    async def _outstanding(self, session_id: str,
                           interrupts: List[Tuple[str, Optional[str]]]
                           ) -> List[Tuple[str, Optional[str]]]:
        """Every (interrupt_id, step_id) still parked: the ones this run raised
        plus any a previous run parked and nobody has answered yet.

        ADK re-emits nothing on resume — resuming step A produces no event at all
        for a still-parked step B — so the durable record is the only way to know
        B is outstanding. Without it a resume looks like "no interrupts" and the
        completion branch below would mark B completed unanswered."""
        if self._rm is None:
            return list(interrupts)
        try:
            return await self._rm.outstanding_interrupts(session_id)
        except Exception:  # read model is best-effort; fall back to this run's
            logger.warning("[worky] 10. could not read outstanding interrupts session=%s",
                           session_id, exc_info=True)
            return list(interrupts)

    async def _finalize(self, session_id: str, plan: Plan,
                        interrupts: List[Tuple[str, Optional[str]]]) -> None:
        """STEP 10 — the turn ends one of two ways: blocked on one or more
        questions (each step parks with its own interrupt id, resumable
        independently), or done."""
        for interrupt_id, step_id in interrupts:
            if not step_id:
                continue
            step = plan.step(step_id)
            step.status = Status.BLOCKED
            step.blocked_reason = ("awaiting user input" if hitl.is_ask(interrupt_id)
                                   else "awaiting email reply")
            await self._project(self._rm and self._rm.set_step_status(
                session_id, step_id, "blocked", blocked_reason=step.blocked_reason,
                interrupt_id=interrupt_id))
            if not hitl.is_ask(interrupt_id):
                # The step is parked now, so its wait becomes deliverable: the
                # token was minted at projection but had no interrupt to resume.
                await self._project(self._rm and self._rm.bind_mail_wait_interrupt(
                    session_id, step_id, interrupt_id))
            if hitl.is_ask(interrupt_id):
                # Surface the ask-the-user question in the chat. A mail wait has
                # nothing to ask the owner — it is waiting on the outside world.
                await self._add_message(session_id, "assistant",
                                        step.question or step.description or "")

        outstanding = await self._outstanding(session_id, interrupts)
        if outstanding:
            plan.status = Status.BLOCKED
            logger.info("[worky] 10. blocked on %d step(s) session=%s: %s",
                        len(outstanding), session_id,
                        ", ".join(f"{s}→{i}" for i, s in outstanding))
            await self._project(self._rm and self._rm.upsert_plan(
                session_id, plan.id, plan.title, plan.goal, "blocked"))
            # Only a question the owner can actually answer puts the session in
            # `waiting` with an interrupt id — that id is what a chat reply gets
            # routed to, and routing a chat reply to a mail wait would answer a
            # step whose reply never arrived. A session parked solely on mail is
            # `blocked`: waiting on the world, not on you.
            askable = next((i for i, _ in outstanding if hitl.is_ask(i)), None)
            if askable:
                await self._project(self._rm and self._rm.set_waiting(session_id, askable))
            else:
                await self._project(self._rm and self._rm.set_session_status(session_id, "blocked"))
            return
        # Normal completion — any node the workflow finished is completed.
        for s in plan.steps:
            if not s.is_done():
                s.status = Status.COMPLETED
        plan.status = scheduler.derive_status(plan)
        logger.info("[worky] 10. derive final status session=%s → %s", session_id, plan.status.value)
        await self._add_message(session_id, "assistant", self._assistant_answer(plan))
        await self._project(self._rm and self._rm.upsert_plan(
            session_id, plan.id, plan.title, plan.goal, plan.status.value))
        await self._project(self._rm and self._rm.set_session_status(
            session_id, "completed" if plan.status is Status.COMPLETED else plan.status.value))

    async def _make_plan(self, session_id: str, user_id: str, message: str) -> Plan:
        planner = LlmAgent(
            name="planner",
            model=self._build_planner_model(),
            instruction=PLANNER_INSTRUCTION,
        )
        runner = self._runner_factory(planner, f"planner_{session_id}")
        await _ensure_session(runner, f"planner_{session_id}", user_id, session_id + "_plan")
        text = ""
        async for ev in runner.run_async(
            user_id=user_id, session_id=session_id + "_plan",
            new_message=types.Content(role="user", parts=[types.Part(text=message)])):
            if ev.content and ev.content.parts:
                for p in ev.content.parts:
                    if getattr(p, "text", None):
                        text = p.text
        data = _extract_json(text)
        steps = [Step(id=s["id"], title=s.get("title", ""),
                      description=s.get("description", ""),
                      kind=s.get("kind", "execute"), question=s.get("question"),
                      depends_on=list(s.get("depends_on", [])))
                 for s in data.get("steps", [])]
        return Plan(title=data.get("title", ""), goal=data.get("goal", ""),
                    answer=data.get("answer") or None, steps=steps)

    def _build_planner_model(self):
        # Planner has no tools → plain model (no tool_choice/parallel_tool_calls,
        # which the API rejects when no tools are provided).
        return nodes.build_llm(self._planner_model, with_tools=False, temperature=0.0)

    async def _project_plan(self, session_id: str, plan: Plan, user_id: str) -> None:
        await self._project(self._rm and self._rm.upsert_plan(
            session_id, plan.id, plan.title, plan.goal, "running"))
        rows = [(s.id, i, s.wave, s.status.value, s.kind, s.question or "",
                 s.title or s.description or s.question or "",   # card label, never blank
                 s.description or "",                            # full instruction / detail
                 ",".join(s.depends_on), s.agent or "")
                for i, s in enumerate(plan.steps)]
        await self._project(self._rm and self._rm.upsert_steps(session_id, rows))
        await self._register_mail_waits(session_id, plan, user_id)

    async def _register_mail_waits(self, session_id: str, plan: Plan, user_id: str) -> None:
        """Mint a routing token for every step that will wait on a reply, before
        any mail goes out.

        It has to happen here and not when the step parks: the token travels in
        the outbound mail, which the step it belongs to only waits on *after* the
        send step already ran. So the row is written now, unbound, and the
        interrupt id is bound when the step actually blocks.

        This plan supersedes whatever the session was waiting on, so its old
        waits are dropped — a reply to a superseded plan's mail has nowhere left
        to go, and leaving it would hold a mailbox subscription open for work
        nobody is doing.
        """
        if self._rm is None:
            return
        awaiting = [s for s in plan.steps if s.kind == "await_reply"]
        await self._project(self._rm.cancel_mail_waits(session_id))
        # Every wait gets a deadline. People do not always reply, and a step with
        # no deadline waits forever: the plan never finishes and nobody is told
        # why. On expiry the step asks the owner instead (see expire_mail_waits).
        expires_at = datetime.now(timezone.utc) + timedelta(hours=self._mail_wait_timeout_hours)
        for step in awaiting:
            token = mail_token.mint()
            await self._project(self._rm.register_mail_wait(
                token, session_id=session_id, step_id=step.id, user_id=user_id,
                expires_at=expires_at))
            logger.info("[worky] 7. mail wait registered session=%s step=%s expires=%s",
                        session_id, step.id, expires_at.isoformat(timespec="seconds"))

    async def _apply_event(self, session_id: str, plan: Plan, ev, name_to_step: dict, started: set) -> None:
        """STEP 9 (per event) — one ADK node event → one step status → one row
        update the client sees live."""
        ni = getattr(ev, "node_info", None)
        if not ni or not getattr(ni, "path", None):
            return
        node = _node_to_step_name(ni.path)
        step_id = name_to_step.get(node)
        if not step_id:
            return
        step = plan.step(step_id)
        # Which step called which tool, with what args — logged here (not at the
        # MCP call site) because that log line carries no step id, and during a
        # parallel wave several steps' calls interleave: log order alone cannot
        # tell you which step made a given call. This can.
        for part in (ev.content.parts if ev.content else []):
            fc = getattr(part, "function_call", None)
            if fc is not None:
                logger.info("[worky] 9. step=%s tool_call name=%s args=%s",
                            step_id, fc.name, dict(fc.args or {}))
            fr = getattr(part, "function_response", None)
            if fr is not None:
                logger.info("[worky] 9. step=%s tool_response name=%s", step_id, fr.name)
        # First event for a node → running; its output event → completed.
        is_output = bool(getattr(ni, "output_for", None)) and ni.path in ni.output_for
        if step_id not in started:
            started.add(step_id)
            step.status = Status.RUNNING
            logger.info("[worky] 9. step running session=%s step=%s wave=%d",
                        session_id, step_id, step.wave)
            await self._project(self._rm and self._rm.set_step_status(
                session_id, step_id, "running", agent=node))
        if is_output:
            step.status = Status.COMPLETED
            text = ""
            if ev.content and ev.content.parts and getattr(ev.content.parts[0], "text", None):
                text = ev.content.parts[0].text
            step.result = text
            logger.info("[worky] 9. step completed session=%s step=%s (%d chars)",
                        session_id, step_id, len(text))
            await self._project(self._rm and self._rm.set_step_status(
                session_id, step_id, "completed", agent=node, result=text))
