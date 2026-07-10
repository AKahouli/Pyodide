"""Orchestrator service — drives one turn: plan -> graph -> execute -> project.

    RunTask ─► plan_turn():
        1. planner LLM  → Plan{ steps + depends_on }
        2. project plan + steps (pending) to the read model
        3. to_workflow(plan, llm nodes)  → ADK Workflow
        4. Runner(node=wf).run_async()   → ADK runs parallel/sequential
        5. map node events → per-step status → project live to the read model
        6. derive + project final plan/session status

The planner is an LlmAgent asked to emit strict JSON; execution is the Workflow
whose nodes are per-step LlmAgents. Event→step mapping uses node_info.path
(verified: path segment = the graph node name = the sanitized step id).
"""
from __future__ import annotations

import json
import logging
import re
from typing import List, Optional

from google.adk.agents import LlmAgent
from google.adk.runners import Runner
from google.genai import types

from . import graph, hitl, nodes, scheduler
from .plan import Plan, Status, Step
from .readmodel import ReadModel

logger = logging.getLogger(__name__)

PLANNER_INSTRUCTION = """You are a planning agent. Break the user's request into a
minimal set of concrete steps and their dependencies, so independent steps can run
in parallel.

Return ONLY strict JSON, no prose, in exactly this shape:
{{
  "title": "<short title>",
  "goal": "<one-sentence goal>",
  "steps": [
    {{"id": "s1", "kind": "execute", "description": "<what to do>", "depends_on": []}},
    {{"id": "s2", "kind": "ask", "question": "<question for the user>", "depends_on": []}},
    {{"id": "s3", "kind": "execute", "description": "<uses the answer>", "depends_on": ["s2"]}}
  ]
}}

Rules:
- ids are short unique strings.
- kind is "execute" (an agent does the work) or "ask" (pause and ask the USER a
  question). Use "ask" ONLY when you genuinely need information from the user that
  you cannot obtain otherwise; give it a "question". Most steps are "execute".
- depends_on lists ids that MUST finish first; leave it [] for independent steps.
- Prefer parallelism: only add a dependency when a step truly needs another's output.
- No cycles."""


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
            id=row["step_id"], description=row.get("description") or "",
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
                 pool=None, schema: str = "public"):
        """runner_factory(node, app_name) -> Runner (so session service / app wiring
        stays with the caller). read_model may be None (projection disabled).
        pool/schema are used to record set-and-forget long-running MCP tasks."""
        self._runner_factory = runner_factory
        self._rm = read_model
        self._planner_model = planner_model
        self._max_concurrency = max_concurrency
        self._pool = pool
        self._schema = schema

    def _tools_for(self, connectors: Optional[List[dict]], session_id: str, user_id: str) -> List:
        """Materialize connectors into executor tools: the synchronous MCP tools
        plus, per connector, a fire-and-forget `schedule_*_task` tool for
        long-running actions (records the handle in mcp_tasks for the poller)."""
        connectors = connectors or []
        from . import connectors as conn_mod
        from . import long_running, mcp_tasks
        tools = conn_mod.connectors_to_toolsets(connectors)
        for c in connectors:
            async def _record(task_id, action, args, _c=c):
                if self._pool is not None:
                    await mcp_tasks.enqueue(
                        self._pool, session_id=session_id, user_id=user_id, task_id=task_id,
                        server_name=_c.get("connector_name", ""), server_url=_c.get("mcp_server_url", ""),
                        auth_headers=_c.get("auth_headers") or {}, mode="record", schema=self._schema)
            tools.append(long_running.make_schedule_tool(c, on_started=_record))
        return tools

    async def _project(self, coro):
        if self._rm is None:
            return
        try:
            await coro
        except Exception as e:  # never let projection break the run
            logger.warning("read-model projection failed: %s", e)

    async def plan_turn(self, *, session_id: str, user_id: str, message: str,
                        model: str, connectors: Optional[List[dict]] = None) -> Plan:
        await self._project(self._rm and self._rm.ensure_session(session_id, user_id, None, "running"))

        plan = await self._make_plan(session_id, user_id, message)
        if not plan.steps:
            await self._project(self._rm and self._rm.set_session_status(session_id, "completed"))
            return plan

        scheduler.validate(plan)
        scheduler.assign_waves(plan)
        await self._project_plan(session_id, plan)

        # Build the executable graph and run it.
        factory = nodes.make_llm_node_factory(
            model_name=model, goal=plan.goal,
            tools=self._tools_for(connectors, session_id, user_id))
        name_to_step = {graph.node_name(s.id): s.id for s in plan.steps}
        wf = graph.to_workflow(plan, factory, name=f"plan_{session_id}",
                               max_concurrency=self._max_concurrency)

        runner = self._runner_factory(wf, f"orch_{session_id}")
        await _ensure_session(runner, f"orch_{session_id}", user_id, session_id)

        interrupt = await self._drive(
            runner, session_id, user_id, plan, name_to_step,
            types.Content(role="user", parts=[types.Part(text=message)]))
        await self._finalize(session_id, plan, interrupt)
        return plan

    async def resume_turn(self, *, session_id: str, user_id: str, answer: str,
                          model: str, connectors: Optional[List[dict]] = None) -> Plan:
        """Resume a turn blocked on ask-the-user with the user's `answer`.

        Rebuilds the same workflow from the stored plan and resumes it via the
        interrupt id; ADK replays completed nodes from the durable session and
        re-runs the blocked one with the answer injected."""
        if self._rm is None:
            raise RuntimeError("resume requires the read model")
        snap = await self._rm.snapshot(session_id)
        interrupt_id = snap and snap["session"].get("interrupt_id")
        if not snap or not interrupt_id:
            raise RuntimeError(f"session {session_id} is not waiting on input")

        plan = _plan_from_snapshot(snap)
        factory = nodes.make_llm_node_factory(
            model_name=model, goal=plan.goal,
            tools=self._tools_for(connectors, session_id, user_id))
        name_to_step = {graph.node_name(s.id): s.id for s in plan.steps}
        wf = graph.to_workflow(plan, factory, name=f"plan_{session_id}",
                               max_concurrency=self._max_concurrency)
        runner = self._runner_factory(wf, f"orch_{session_id}")
        await _ensure_session(runner, f"orch_{session_id}", user_id, session_id)
        await self._project(self._rm.set_waiting(session_id, None))  # waiting -> running

        interrupt = await self._drive(
            runner, session_id, user_id, plan, name_to_step,
            types.Content(role="user", parts=[hitl.resume_part(interrupt_id, {"value": answer})]))
        await self._finalize(session_id, plan, interrupt)
        return plan

    async def _drive(self, runner, session_id, user_id, plan, name_to_step, new_message):
        """Run the workflow, project step statuses, and capture the first
        ask-the-user interrupt as (interrupt_id, step_id) or None."""
        started: set = set()
        interrupt = None
        async for ev in runner.run_async(
                user_id=user_id, session_id=session_id, new_message=new_message):
            await self._apply_event(session_id, plan, ev, name_to_step, started)
            if interrupt is None:
                ids = hitl.interrupt_ids(ev)
                if ids:
                    ni = getattr(ev, "node_info", None)
                    step_id = (name_to_step.get(_node_to_step_name(ni.path))
                               if ni and getattr(ni, "path", None) else None)
                    interrupt = (ids[0], step_id)
        return interrupt

    async def _finalize(self, session_id: str, plan: Plan, interrupt) -> None:
        if interrupt is not None:
            interrupt_id, step_id = interrupt
            if step_id:
                step = plan.step(step_id)
                step.status = Status.BLOCKED
                step.blocked_reason = "awaiting user input"
                await self._project(self._rm and self._rm.set_step_status(
                    session_id, step_id, "blocked", blocked_reason="awaiting user input"))
            plan.status = Status.BLOCKED
            await self._project(self._rm and self._rm.upsert_plan(
                session_id, plan.id, plan.title, plan.goal, "blocked"))
            await self._project(self._rm and self._rm.set_waiting(session_id, interrupt_id))
            return
        # Normal completion — any node the workflow finished is completed.
        for s in plan.steps:
            if not s.is_done():
                s.status = Status.COMPLETED
        plan.status = scheduler.derive_status(plan)
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
        steps = [Step(id=s["id"], description=s.get("description", ""),
                      kind=s.get("kind", "execute"), question=s.get("question"),
                      depends_on=list(s.get("depends_on", [])))
                 for s in data.get("steps", [])]
        return Plan(title=data.get("title", ""), goal=data.get("goal", ""), steps=steps)

    def _build_planner_model(self):
        # Planner has no tools → plain model (no tool_choice/parallel_tool_calls,
        # which the API rejects when no tools are provided).
        return nodes.build_llm(self._planner_model, with_tools=False, temperature=0.0)

    async def _project_plan(self, session_id: str, plan: Plan) -> None:
        await self._project(self._rm and self._rm.upsert_plan(
            session_id, plan.id, plan.title, plan.goal, "running"))
        rows = [(s.id, i, s.wave, s.status.value, s.kind, s.question or "",
                 s.description, ",".join(s.depends_on), s.agent or "")
                for i, s in enumerate(plan.steps)]
        await self._project(self._rm and self._rm.upsert_steps(session_id, rows))

    async def _apply_event(self, session_id: str, plan: Plan, ev, name_to_step: dict, started: set) -> None:
        ni = getattr(ev, "node_info", None)
        if not ni or not getattr(ni, "path", None):
            return
        node = _node_to_step_name(ni.path)
        step_id = name_to_step.get(node)
        if not step_id:
            return
        step = plan.step(step_id)
        # First event for a node → running; its output event → completed.
        is_output = bool(getattr(ni, "output_for", None)) and ni.path in ni.output_for
        if step_id not in started:
            started.add(step_id)
            step.status = Status.RUNNING
            await self._project(self._rm and self._rm.set_step_status(
                session_id, step_id, "running", agent=node))
        if is_output:
            step.status = Status.COMPLETED
            text = ""
            if ev.content and ev.content.parts and getattr(ev.content.parts[0], "text", None):
                text = ev.content.parts[0].text
            step.result = text
            await self._project(self._rm and self._rm.set_step_status(
                session_id, step_id, "completed", agent=node, result=text))
