"""Orchestrator service — drives one turn: plan -> graph -> execute -> project.

The numbered STEP comments below (and the "[worky] N." log lines) are one
sequence covering a whole turn, from the moment the user's message arrives.
Steps 1, 3-4 live in grpc_server/companion_ai_servicer.py; 5-10 are here:

    STEP 1  RunTask receives the user's message                 (servicer)
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
from pydantic import BaseModel, Field

from . import graph, hitl, human_agents, mail_token, nodes, scheduler
from .plan import Plan, Status, Step
from .readmodel import ReadModel

logger = logging.getLogger(__name__)

# Hard cap on how large a plan may grow via delegate_to_human_agent (see
# _delegate_tool_for) — without one, a step that keeps deciding it needs to
# ask someone else could grow the plan without bound.
MAX_PLAN_STEPS = 30

# Fallback label for a plain step when the client sent no executor agent at
# all (so plan_turn had no name to stamp) — an internal graph node id is
# meaningless in the UI.
DEFAULT_EXECUTOR_LABEL = "Executor"


class _PlannerStepOut(BaseModel):
    """Schema for one step in the planner's JSON contract — passed as
    LlmAgent.output_schema (see _make_plan) so the field SHAPE is enforced by
    the model provider itself, not just hoped for via prose instructions.

    This guarantees every field exists with the right type; it does NOT
    guarantee "assignee" is populated with the right name when it should
    be — that's a semantic/reasoning question the schema can't force."""
    id: str
    kind: str = "execute"
    title: str = ""
    description: str = ""
    question: Optional[str] = None
    depends_on: List[str] = Field(default_factory=list)
    assignee: Optional[str] = None


class _PlannerOutput(BaseModel):
    """Schema for the planner's whole JSON response — see _PlannerStepOut."""
    title: str = ""
    goal: str = ""
    answer: str = ""
    steps: List[_PlannerStepOut] = Field(default_factory=list)

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
- Use "await_reply" whenever the task depends on a REPLY to a mail you send to
  a REAL external person (anyone find_human_agents does not find — see below) —
  "email X and then ...", "ask X by email and report back", "wait for their
  answer". Without it the plan would send the mail and carry on as if the answer
  had arrived, inventing one.
  It is ALWAYS a separate step from the send, and it MUST depends_on the step
  that sends the mail — that link is how the reply finds its way back. Its
  "question" says what is awaited and from whom (e.g. "Awaiting a reply from
  x@example.com about her company"). Steps that need the answer depend on
  the await_reply step, not on the send step.
  Do NOT use it for mail you send that needs no answer (a notification, a
  report), and do NOT use it to wait for anything other than an email reply.
  NEVER use it for a human agent found via find_human_agents — see below,
  it is a completely different, single-step mechanism with no email involved.
- ids are short unique strings. depends_on lists ids that MUST finish first;
  leave it [] for independent steps.
- PARALLELIZE BY DEFAULT — this is not a style preference, it is the default
  you must actively override: two steps run sequentially (one depends_on the
  other) ONLY when one genuinely needs the other's OUTPUT to do its work.
  Never make a step depend on another just because the user mentioned them in
  that order, out of habit, or "to be safe" — that costs the user real time
  for no reason. Before adding any depends_on, ask yourself "does this step
  actually need data the other one produced?" — if the honest answer is no,
  leave depends_on: [] and let both run in the same wave. When a request
  names several steps/people with no data flowing between them, assume they
  are independent and run together unless something in the request says
  otherwise.
- No cycles.

A NAME IN THE USER'S MESSAGE MEANS A HUMAN AGENT, NOT THE DEFAULT EXECUTOR:
whenever the user mentions a person by name (or a role like "the approver"),
and does NOT explicitly say to email them, they are NOT asking you to compose
a message for the default executor to send — they are naming a human agent
that already exists in this system, who does the step's work himself, in his
own name and role, instead of the anonymous default executor. Your job is to
find that person and assign the step to them, not to write a step about
contacting them.

MANDATORY FIRST CHECK — human agents, NO fixed roster: before you write ANY
step whose job is to reach a named person, or a role (e.g. "the approver",
"someone in support"), you MUST call find_human_agents(name=...) and/or
find_human_agents(role=...) to check whether they are a human agent — never
assume, and never skip this because the wording sounds like a message to
send. If the message names no one and implies no role at all, skip this
check entirely.

The default is ALWAYS the human agent, never a manual email step: assigning
to a human agent is still ONE step in your plan — they handle actually
reaching that real person and getting their real decision themselves, as
part of doing their own job, so you never add a separate mail-send step or
an await_reply step around them yourself. Reach for email/a messaging
connector (Teams, etc.) ONLY when the user explicitly says "email" / "send
an email" / gives an actual email address — wording like "send it to X and
ask her", "tell X", "ask X" is NOT an email instruction by itself; it means
find_human_agents first, and if she's a match, delegate to her, full stop.
Do not also try a connector's send_email/send_teams_message tool "just in
case" — if find_human_agents found her, that IS the entire interaction, and
if it found no one, then and only then does an ordinary step / connector
send make sense.

When find_human_agents finds a match, that's ONE "execute" step: set
"assignee": "<their exact name>" and write "description" as the question/task
addressed directly TO them (e.g. "Should we invest in Bitcoin today, given:
<summary>?" — never "send/email/notify <name> and ask...", you are not
writing instructions to email them, they handle actually reaching them
themselves as part of answering). "assignee" REPLACES the default executor
for that step with that person, running with his own name and role as his
instructions — you never also write instructions telling the default
executor to go find or contact him. That step's description is all he
sees — he doesn't see the rest of this plan.
Do NOT add a separate mail-send step or an "await_reply" step for them —
they handle actually reaching that person and getting their real decision
themselves, inside their own step; from your plan's point of view, the
single assignee step IS the question and IS the answer, both in that one
step.
If find_human_agents finds no match, treat it as an ordinary step (or, if the
user clearly means to email a real external person by address, use the
normal execute + await_reply pattern above).

Example — "search bitcoin news, then send it to Rabeb and ask if we should
invest today" — find_human_agents(name="Rabeb") found her, so this is
CORRECT (one assignee step, no email/Teams anywhere):
{{"title": "Bitcoin investment check", "goal": "Get Rabeb's investment call on Bitcoin", "answer": "",
  "steps": [
    {{"id": "s1", "kind": "execute", "title": "Search Bitcoin news", "description": "Search for the latest Bitcoin price and news; summarize price, drivers, and risks.", "depends_on": []}},
    {{"id": "s2", "kind": "execute", "title": "Ask Rabeb", "assignee": "Rabeb", "description": "Given the latest Bitcoin price/news research, should we invest in Bitcoin today? Give your recommendation and reasoning.", "depends_on": ["s1"]}}
  ]}}
WRONG for that same request (do NOT do this): a plain "execute" step titled
something like "Send to Rabeb" with no "assignee", whose description tells
the executor to email her or message her on Teams. The user never said
"email" — that phrasing came only from misreading "send it to Rabeb" as a
literal message to compose, instead of checking find_human_agents first.

Example — "email x asking which company she works for, then report on it":
{{"title": "Company report", "goal": "Report on the company x works for", "answer": "",
  "steps": [
    {{"id": "s1", "kind": "execute", "title": "Email x", "description": "Send an email to x@example.com asking which company she works for.", "depends_on": []}},
    {{"id": "s2", "kind": "await_reply", "title": "Await her reply", "question": "Awaiting a reply from x@example.com naming her company", "description": "", "depends_on": ["s1"]}},
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
            wave=row.get("wave") or 0, result=row.get("result"),
            assignee=row.get("assignee"), assignee_name=row.get("assignee_name"),
            assignee_role=row.get("assignee_role"), is_persona=bool(row.get("is_persona")),
            is_dynamic_delegate=bool(row.get("is_dynamic_delegate"))))
    return Plan(id=p.get("id") or "", title=p.get("title") or "",
                goal=p.get("goal") or "", status=Status(p.get("status") or "running"),
                steps=steps, executor_id=p.get("executor_id"),
                executor_name=p.get("executor_name"))


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

    def _delegate_tool_for(self, session_id: str, user_id: str, plan: Plan,
                           factory_holder: list, name_to_step: dict, caller_step_id: str,
                           siblings: Optional[set] = None):
        """Tool given to a persona-assigned step (see nodes.py/human_agents.py):
        hand a question or task to ANOTHER human agent and get their answer back
        before continuing — e.g. Rabeb decides investment approval is out of her
        scope and asks Oussama.

        Runs the delegate as a one-step nested Workflow via ADK's dynamic node
        scheduling (`ctx.run_node`, confirmed on google.adk 2.3.0's `Context`):
        the calling step's turn does not end until the delegate answers, and if
        the delegate itself blocks (ask-the-user, await_reply) that interrupt
        propagates out through this call exactly like an ordinary step's would —
        no changes needed to _drive/_finalize for that.

        `factory_holder` is a 1-item list filled with this turn's node factory
        right after it is built (see _build_workflow) — the delegated step is
        built with that SAME factory, so it gets the same model/tools/instruction
        wiring, including this same tool, letting a delegate delegate again.

        `caller_step_id` becomes the sub-step's `depends_on` — it isn't wired
        into the outer graph's edges (this is a nested Workflow, not a graph
        node), but the DAG/wave numbers projected to the read model would
        otherwise show it as an independent wave-0 step with no relation to
        the step that actually spawned it.

        `siblings` — every dynamically-spawned step from THIS caller this
        turn, shared with _create_task_tool_for (see _build_workflow): both
        grow the SAME plan mid-turn, and a second one from either tool must
        never get wired as depending on the first — a chain instead of
        siblings is exactly the wave bug fixed earlier. Defaults to a fresh
        set when called on its own (e.g. in tests).
        """
        from google.adk.tools.tool_context import ToolContext
        from src.smart_rag.tools.search.tools import SearchToolADK

        # Every delegate spawned by THIS caller this turn — siblings, not a
        # chain. Excluded below so a second consultation doesn't get wired
        # as depending on the first.
        siblings = siblings if siblings is not None else set()

        async def delegate_to_human_agent(agent_name: str, task: str, *,
                                          tool_context: ToolContext = None) -> str:
            matches = await human_agents.search_human_agents(name=agent_name)
            if not matches:
                return (f"Unknown agent {agent_name!r} — no match via find_human_agents. "
                        "Call find_human_agents first to discover who actually exists.")
            agent = matches[0]
            agent_display_name = agent.get("name") or agent_name
            caller = plan.step(caller_step_id)
            if caller is not None and caller.is_persona and agent_display_name == caller.assignee_name:
                # Backstop regardless of role wording — prompt guidance alone
                # has misfired into self-delegation loops before.
                return (f"You are {agent_display_name} — you cannot delegate to yourself. "
                        "Answer with your own best judgment instead.")
            if len(plan.steps) >= MAX_PLAN_STEPS:
                return "Cannot delegate further — this plan has reached its step limit."

            sub_step = Step(title=f"Ask {agent_display_name}", description=task, kind="execute",
                            is_persona=True, is_dynamic_delegate=True,
                            assignee=agent.get("id") or agent_display_name,
                            assignee_name=agent_display_name, assignee_role=agent.get("role"),
                            depends_on=[caller_step_id])
            plan.steps.append(sub_step)
            # Anything already waiting on the caller can't really start until
            # this new child finishes either — the caller's node doesn't
            # complete until its delegate calls do. Excludes the caller's
            # own other delegates, which are parallel to this one, not before it.
            affected = [o for o in plan.steps
                       if o.id != sub_step.id and o.id not in siblings
                       and caller_step_id in o.depends_on
                       and sub_step.id not in o.depends_on]
            for other in affected:
                other.depends_on.append(sub_step.id)
            siblings.add(sub_step.id)
            scheduler.validate(plan)
            scheduler.assign_waves(plan)
            name_to_step[graph.node_name(sub_step.id)] = sub_step.id
            logger.info("[worky] delegate_to_human_agent session=%s → %s (step=%s)",
                        session_id, agent_name, sub_step.id)
            await self._project_step(session_id, plan, sub_step)
            for other in affected:
                await self._project_step(session_id, plan, other)

            # The caller's node is still "running" in ADK, but the user sees it
            # as blocked on the delegate — reflect that on the plan card.
            blocked_reason = f"waiting on {agent_display_name}"
            if caller is not None:
                caller.status = Status.BLOCKED
                caller.blocked_reason = blocked_reason
            await self._project(self._rm and self._rm.set_step_status(
                session_id, caller_step_id, "blocked", blocked_reason=blocked_reason))
            try:
                # depends_on=[caller_step_id] is for the OUTER plan's wave display
                # only — the nested one-step Workflow below has no caller_step_id
                # in it, so building it with that dependency would fail DAG
                # validation ("depends on unknown step"). Give it a local,
                # dependency-free copy instead.
                sub_wf = graph.to_workflow(
                    Plan(steps=[sub_step.model_copy(update={"depends_on": []})]),
                    factory_holder[0], name=f"delegate_{sub_step.id}")
                # use_sub_branch=True alone is NOT enough: the delegate's reply
                # event carries a different `author`, and contents.py's
                # _get_current_turn_contents scans backward for the latest
                # foreign-author event to find the turn boundary — the
                # delegate's reply qualifies, truncating away the calling
                # step's own function_call event and blowing up the next LLM
                # call ("No function call event found for function responses").
                # override_isolation_scope=tool_context.function_call_id is
                # ADK's own documented convention for a delegated sub-agent —
                # it excludes the delegate's events from that scan entirely.
                result = await tool_context.run_node(
                    sub_wf, use_as_output=False, use_sub_branch=True,
                    override_isolation_scope=tool_context.function_call_id)
            except Exception as e:
                logger.exception("[worky] delegate_to_human_agent failed session=%s step=%s",
                                 session_id, sub_step.id)
                return f"Error asking {agent_display_name}: {e}"
            finally:
                # Whether the delegate answered or errored, the caller is no
                # longer blocked — it's back to running its own turn.
                if caller is not None:
                    caller.status = Status.RUNNING
                    caller.blocked_reason = None
                await self._project(self._rm and self._rm.set_step_status(
                    session_id, caller_step_id, "running"))
            return str(result) if result is not None else ""

        # Built directly rather than via create_search_schema: that helper adds
        # a "strict" key that OpenAI-style function schemas accept but ADK's
        # own google.genai.types.FunctionDeclaration (what SearchToolADK feeds
        # this into) has no field for and rejects outright.
        schema = {
            "function": {
                "name": "delegate_to_human_agent",
                "description": (
                    "Hand a question or task to ANOTHER named human agent and get their "
                    "answer back before you continue. Use this when the task needs "
                    "someone else's role or authority — e.g. you are not authorized to "
                    "decide something yourself and need to ask a colleague who is. "
                    "Use find_human_agents first if you don't already know their exact name."),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "agent_name": {"type": "string",
                                      "description": "exact name of the human agent to ask"},
                        "task": {"type": "string",
                                "description": (
                                    "the question or task to hand them, in full — they see "
                                    "ONLY this text, nothing else from your own conversation. "
                                    "Include every fact/figure they'd need inline (e.g. the "
                                    "actual price, not 'the latest snapshot'); a reference to "
                                    "data they can't see leaves them unable to answer.")},
                    },
                    "required": ["agent_name", "task"],
                    "additionalProperties": False,
                },
            }
        }
        return SearchToolADK(delegate_to_human_agent, schema)

    def _create_task_tool_for(self, session_id: str, user_id: str, plan: Plan,
                              factory_holder: list, name_to_step: dict, caller_step_id: str,
                              siblings: Optional[set] = None):
        """Tool given to a persona-assigned step: spin off a brand-new follow-up
        task and get its result back before continuing — for when something
        just learned (e.g. an email reply) means real work needs to happen,
        not just get written down as a condition in your own final answer.

        Deliberately separate from delegate_to_human_agent: that tool is for
        a SPECIFIC named colleague's judgment; this one is for work that
        isn't anyone in particular — a check to run, something to verify,
        another email to send and wait on. Same underlying mechanism (a
        one-step nested Workflow via ctx.run_node — see _delegate_tool_for's
        docstring for why override_isolation_scope/use_sub_branch matter),
        just without a target agent to resolve.

        `siblings` must be the SAME set passed to _delegate_tool_for for this
        caller (see _build_workflow) — both tools grow the same plan mid-turn
        and must treat each other's spawned steps as siblings, not a chain.
        """
        from google.adk.tools.tool_context import ToolContext
        from src.smart_rag.tools.search.tools import SearchToolADK

        siblings = siblings if siblings is not None else set()

        async def create_task(description: str, kind: str = "execute", *,
                              tool_context: ToolContext = None) -> str:
            if kind not in ("execute", "ask", "await_reply"):
                return f"Unknown kind {kind!r} — use 'execute', 'ask', or 'await_reply'."
            if len(plan.steps) >= MAX_PLAN_STEPS:
                return "Cannot create another task — this plan has reached its step limit."

            # This step is born mid-turn, after plan_turn's one-time stamping
            # pass — read the client's executor identity straight off the
            # plan (set once at plan_turn) rather than a sibling step, since
            # a plan can be entirely persona-assigned with no plain step to
            # copy from (e.g. the planner routed straight to a human agent).
            sub_step = Step(title=description[:60], description=description, kind=kind,
                            is_dynamic_delegate=True, depends_on=[caller_step_id],
                            assignee=plan.executor_id,
                            assignee_name=plan.executor_name or DEFAULT_EXECUTOR_LABEL)
            plan.steps.append(sub_step)
            # Same sibling/wave bookkeeping as _delegate_tool_for — see there
            # for why this matters.
            affected = [o for o in plan.steps
                       if o.id != sub_step.id and o.id not in siblings
                       and caller_step_id in o.depends_on
                       and sub_step.id not in o.depends_on]
            for other in affected:
                other.depends_on.append(sub_step.id)
            siblings.add(sub_step.id)
            scheduler.validate(plan)
            scheduler.assign_waves(plan)
            name_to_step[graph.node_name(sub_step.id)] = sub_step.id
            logger.info("[worky] create_task session=%s → %r (step=%s, kind=%s)",
                        session_id, sub_step.title, sub_step.id, kind)
            await self._project_step(session_id, plan, sub_step)
            for other in affected:
                await self._project_step(session_id, plan, other)

            caller = plan.step(caller_step_id)
            blocked_reason = "waiting on a follow-up task"
            if caller is not None:
                caller.status = Status.BLOCKED
                caller.blocked_reason = blocked_reason
            await self._project(self._rm and self._rm.set_step_status(
                session_id, caller_step_id, "blocked", blocked_reason=blocked_reason))
            try:
                sub_wf = graph.to_workflow(
                    Plan(steps=[sub_step.model_copy(update={"depends_on": []})]),
                    factory_holder[0], name=f"task_{sub_step.id}")
                result = await tool_context.run_node(
                    sub_wf, use_as_output=False, use_sub_branch=True,
                    override_isolation_scope=tool_context.function_call_id)
            except Exception as e:
                logger.exception("[worky] create_task failed session=%s step=%s",
                                 session_id, sub_step.id)
                return f"Error running task: {e}"
            finally:
                if caller is not None:
                    caller.status = Status.RUNNING
                    caller.blocked_reason = None
                await self._project(self._rm and self._rm.set_step_status(
                    session_id, caller_step_id, "running"))
            return str(result) if result is not None else ""

        schema = {
            "function": {
                "name": "create_task",
                "description": (
                    "Spin off a brand-new follow-up task and get its result back before "
                    "you continue — use this when something you just learned (e.g. an "
                    "email reply) means real work actually needs to happen, instead of "
                    "just noting it as a condition in your own answer. For work that "
                    "ISN'T asking a specific named colleague — use delegate_to_human_agent "
                    "for that instead. Examples: running a check, verifying a claim, "
                    "sending another email and waiting for its reply."),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "description": {"type": "string",
                                        "description": (
                                            "the full, standalone instruction for this task — "
                                            "whoever/whatever runs it sees ONLY this text, nothing "
                                            "else from your own conversation")},
                        "kind": {"type": "string", "enum": ["execute", "ask", "await_reply"],
                                "description": (
                                    "'execute' (default): normal work. 'await_reply': this task "
                                    "itself sends an email and waits for a reply. 'ask': only to "
                                    "ask the end user something directly.")},
                    },
                    "required": ["description"],
                    "additionalProperties": False,
                },
            }
        }
        return SearchToolADK(create_task, schema)

    def _build_workflow(self, session_id: str, user_id: str, plan: Plan, model: str,
                        connectors: Optional[List[dict]], executor_prompt: Optional[str]):
        """STEP 8, shared by plan_turn/resume_turn/continue_turn: connectors +
        persona-delegation → executor tools, plan → ADK Workflow."""
        name_to_step = {graph.node_name(s.id): s.id for s in plan.steps}
        factory_holder: List = []
        mail_tools_for_step = self._mail_stamping(session_id, plan)

        def _reads_a_mail_reply(step: Step) -> bool:
            # The step directly downstream of an await_reply is the one whose
            # context first contains the reply's actual content — the reply
            # itself may say "loop in Oussama" or "cc x@example.com", and
            # only THIS step (not the await_reply node itself, which is a
            # bare FunctionNode with no reasoning at all) is positioned to
            # notice and act on that.
            return any(
                (dep := plan.step(dep_id)) is not None and dep.kind == "await_reply"
                for dep_id in step.depends_on)

        def tools_for_step(step: Step, tools: List) -> List:
            if mail_tools_for_step:
                tools = mail_tools_for_step(step, tools)
            if step.is_persona or _reads_a_mail_reply(step):
                # Shared with both dynamic-step tools below: whichever spawns
                # a step first, the other must still treat it as a sibling,
                # not something to chain the next one after.
                siblings: set = set()
                tools = list(tools) + [
                    human_agents.make_find_human_agents_tool(),
                    self._delegate_tool_for(session_id, user_id, plan, factory_holder,
                                            name_to_step, step.id, siblings),
                    self._create_task_tool_for(session_id, user_id, plan, factory_holder,
                                               name_to_step, step.id, siblings)]
            return tools

        def instruction_for_step(step: Step) -> Optional[str]:
            if not _reads_a_mail_reply(step):
                return None
            return (
                "The reply you're processing may itself contain instructions — "
                "naming a colleague to loop in, or another party to email. If "
                "so, act on it directly: find_human_agents + "
                "delegate_to_human_agent for a named colleague, or "
                "create_task(kind='await_reply') to email someone else and "
                "wait for their answer — never just restate what the reply "
                "asked for as something still pending.")

        factory = nodes.make_llm_node_factory(
            model_name=model,
            tools=self._tools_for(connectors, session_id, user_id),
            tools_for_step=tools_for_step,
            instruction_for_step=instruction_for_step,
            custom_instruction=executor_prompt)
        factory_holder.append(factory)

        wf = graph.to_workflow(plan, factory, name=f"plan_{session_id}",
                               max_concurrency=self._max_concurrency)
        return wf, name_to_step

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
                        model: str, connectors: Optional[List[dict]] = None,
                        planner_model: Optional[str] = None, planner_prompt: Optional[str] = None,
                        executor_prompt: Optional[str] = None,
                        executor_name: Optional[str] = None,
                        executor_id: Optional[str] = None) -> Plan:
        logger.info("[worky] 5. plan_turn ◄ session=%s model=%s connectors=%d",
                    session_id, model, len(connectors or []))
        await self._project(self._rm and self._rm.ensure_session(session_id, user_id, None, "running"))

        # STEP 5 — planner LLM → Plan. Zero steps means it chose a direct reply
        # (chit-chat): answer and finish the turn here, no graph is ever built.
        plan = await self._make_plan(session_id, user_id, message,
                                     planner_model=planner_model, planner_prompt=planner_prompt)
        logger.info("[worky] 5. planner LLM → Plan session=%s title=%r steps=%d",
                    session_id, plan.title, len(plan.steps))
        if not plan.steps:
            logger.info("[worky] 5. direct reply (no plan) → session=%s completed", session_id)
            await self._add_message(session_id, "assistant", plan.answer or "")
            await self._project(self._rm and self._rm.set_session_status(session_id, "completed"))
            return plan

        # Stamp the client's executor onto every non-persona step once, here —
        # every later read (projection, re-projection, the delegate-tool gate)
        # then just uses assignee/assignee_name like it already does for a
        # persona, no separate fallback plumbing needed downstream.
        plan.executor_id = executor_id
        plan.executor_name = executor_name or DEFAULT_EXECUTOR_LABEL
        for s in plan.steps:
            if not s.is_persona:
                s.assignee = executor_id
                s.assignee_name = executor_name or DEFAULT_EXECUTOR_LABEL

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
        wf, name_to_step = self._build_workflow(session_id, user_id, plan, model, connectors, executor_prompt)
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
        # Apple news") still saw the whole original request ("...email x...
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
                          interrupt_id: Optional[str] = None,
                          executor_prompt: Optional[str] = None) -> Plan:
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
        wf, name_to_step = self._build_workflow(session_id, user_id, plan, model, connectors, executor_prompt)
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
                            model: str, connectors: Optional[List[dict]] = None,
                            executor_prompt: Optional[str] = None) -> Plan:
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

        wf, name_to_step = self._build_workflow(session_id, user_id, plan, model, connectors, executor_prompt)
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

    async def _make_plan(self, session_id: str, user_id: str, message: str, *,
                         planner_model: Optional[str] = None,
                         planner_prompt: Optional[str] = None) -> Plan:
        planner = LlmAgent(
            name="planner",
            model=self._build_planner_model(planner_model),
            instruction=(f"{planner_prompt}\n\n{PLANNER_INSTRUCTION}"
                         if planner_prompt else PLANNER_INSTRUCTION),
            tools=[human_agents.make_find_human_agents_tool()],
            output_schema=_PlannerOutput,
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
        steps = []
        for s in data.get("steps", []):
            assignee_id = assignee_name = assignee_role = None
            if s.get("assignee"):
                # Trust the API's resolution, not whatever the planner echoed
                # back — same reasoning as delegate_to_human_agent: an LLM
                # relaying fields can drift, a fresh lookup can't.
                matches = await human_agents.search_human_agents(name=s["assignee"])
                if matches:
                    assignee_name = matches[0].get("name") or s["assignee"]
                    assignee_id = matches[0].get("id") or assignee_name
                    assignee_role = matches[0].get("role")
            steps.append(Step(id=s["id"], title=s.get("title", ""),
                              description=s.get("description", ""),
                              kind=s.get("kind", "execute"), question=s.get("question"),
                              depends_on=list(s.get("depends_on", [])),
                              is_persona=bool(assignee_name),
                              assignee=assignee_id, assignee_name=assignee_name,
                              assignee_role=assignee_role))
        return Plan(title=data.get("title", ""), goal=data.get("goal", ""),
                    answer=data.get("answer") or None, steps=steps)

    def _build_planner_model(self, model_name: Optional[str] = None):
        # Always has the find_human_agents discovery tool now.
        return nodes.build_llm(model_name or self._planner_model, with_tools=True, temperature=0.0)

    @staticmethod
    def _step_row(ordinal: int, s: Step) -> tuple:
        # assignee/assignee_name are always populated by plan_turn (the
        # client's executor for a plain step, a persona's own id/name
        # otherwise) — DEFAULT_EXECUTOR_LABEL only guards a snapshot from
        # before that stamping existed.
        return (s.id, ordinal, s.wave, s.status.value, s.kind, s.question or "",
                s.title or s.description or s.question or "",   # card label, never blank
                s.description or "",                            # full instruction / detail
                ",".join(s.depends_on), s.assignee or "",
                s.assignee_name or DEFAULT_EXECUTOR_LABEL, s.assignee_role or "",
                s.is_persona, s.is_dynamic_delegate)

    async def _project_plan(self, session_id: str, plan: Plan, user_id: str) -> None:
        await self._project(self._rm and self._rm.upsert_plan(
            session_id, plan.id, plan.title, plan.goal, "running",
            executor_id=plan.executor_id, executor_name=plan.executor_name))
        rows = [self._step_row(i, s) for i, s in enumerate(plan.steps)]
        await self._project(self._rm and self._rm.upsert_steps(session_id, rows))
        await self._register_mail_waits(session_id, plan, user_id)

    async def _project_step(self, session_id: str, plan: Plan, step: Step) -> None:
        """Project ONE dynamically-added or dependency-updated step (see
        _delegate_tool_for) so the client sees it — the plan card grows
        instead of looking static."""
        ordinal = plan.steps.index(step)
        await self._project(self._rm and self._rm.upsert_steps(
            session_id, [self._step_row(ordinal, step)]))

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
        # output_for alone is unreliable: confirmed empirically it's unset for
        # a plain FunctionNode regardless of downstream dependents (seen live:
        # session ee477bcc88ed43b299a8d17356064855 — steps stuck "running"
        # forever after a resume despite genuinely completing and correctly
        # unblocking their dependents via ADK's own session state).
        # is_final_response() is ADK's general "no more agent turns" signal
        # and catches both node shapes — but it's ALSO True on the event that
        # RAISES an ask/await_reply interrupt, so long_running_tool_ids must
        # be excluded or every HITL step completes the instant it parks.
        # Kept as an OR with the original check, not a replacement, since
        # what makes output_for work for nested delegates is still poorly
        # understood.
        is_output = (bool(getattr(ni, "output_for", None)) and ni.path in ni.output_for) \
            or (ev.is_final_response() and not ev.long_running_tool_ids
                and not ev.get_function_calls() and not ev.get_function_responses())
        if step_id not in started:
            started.add(step_id)
            step.status = Status.RUNNING
            logger.info("[worky] 9. step running session=%s step=%s wave=%d",
                        session_id, step_id, step.wave)
            await self._project(self._rm and self._rm.set_step_status(
                session_id, step_id, "running"))
        if is_output:
            step.status = Status.COMPLETED
            text = ""
            if ev.content and ev.content.parts and getattr(ev.content.parts[0], "text", None):
                text = ev.content.parts[0].text
            step.result = text
            logger.info("[worky] 9. step completed session=%s step=%s (%d chars)",
                        session_id, step_id, len(text))
            await self._project(self._rm and self._rm.set_step_status(
                session_id, step_id, "completed", result=text))
