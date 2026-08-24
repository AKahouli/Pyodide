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

import asyncio
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


class _PlannerOp(BaseModel):
    """An amend operation on an EXISTING step, used only by converse (see
    _amend_message). `op` is "cancel" or "modify"; for "modify", `description`
    is the step's new full instruction. Only PENDING steps can be amended —
    _apply_ops enforces that; a completed/running step can't be safely touched
    (see the cancel/modify feasibility note: it's the ADK replay barrier)."""
    op: str
    step_id: str
    description: str = ""


class _PlannerOutput(BaseModel):
    """Schema for the planner's whole JSON response — see _PlannerStepOut."""
    title: str = ""
    goal: str = ""
    answer: str = ""
    steps: List[_PlannerStepOut] = Field(default_factory=list)
    ops: List[_PlannerOp] = Field(default_factory=list)

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
  "answer": "<one short, friendly sentence to the user about what you're setting up>",
  "steps": [
    {{"id": "s1", "kind": "execute", "title": "<short label>", "description": "<full instruction>", "depends_on": []}},
    {{"id": "s2", "kind": "ask", "title": "<short label>", "question": "<question for the user>", "description": "", "depends_on": ["s1"]}},
    {{"id": "s3", "kind": "await_reply", "title": "<short label>", "question": "<what reply is awaited, and from whom>", "description": "", "depends_on": ["s1"]}}
  ]
}}

Rules:
- Prefer CASE A whenever one message answers the user. Most chit-chat and simple
  questions do NOT need a plan — only plan when there is genuine multi-step work.
- answer: ALWAYS write a short one-line reply to the user here, in BOTH cases —
  a full reply in CASE A; in CASE B a brief, natural acknowledgement of what
  you're about to do (e.g. "Sure — I'll pull the latest Ethereum price and add
  it."). Never leave it empty.
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
  An await_reply step must NEVER be the last step of the plan — the reply is
  the whole point of waiting, and nothing reads it unless a later step
  depends on it. Even if the user's own wording named no explicit follow-up
  ("email X asking Y" with nothing after), still add one more "execute" step
  depending on the await_reply whose job is to read the reply and act on it:
  report what it said, and if the reply itself asks for something further —
  a search, another email, looping someone else in — do that directly
  instead of leaving it as a restated pending item.
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
{{"title": "Bitcoin investment check", "goal": "Get Rabeb's investment call on Bitcoin", "answer": "On it — I'll pull the latest Bitcoin news and get Rabeb's call.",
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
{{"title": "Company report", "goal": "Report on the company x works for", "answer": "Sure — I'll email x, wait for her reply, then research the company.",
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


def requester_context(requester: Optional[dict]) -> str:
    """A short preamble naming who the turn is for, so the planner and executor
    address the requester directly and never email or delegate a task back to the
    person who asked for it. Empty when we have no name/email to give.

    `requester` is {name, email, role} — as carried on RunRequest.user_* and
    passed down from the servicer."""
    if not requester:
        return ""
    name = (requester.get("name") or "").strip()
    email = (requester.get("email") or "").strip()
    role = (requester.get("role") or "").strip()
    if not (name or email):
        return ""
    who = f"{name} <{email}>" if name and email else (name or email)
    if role:
        who += f", {role}"
    return (
        f"You are working for {who}. They are the requester — the person who asked "
        f"for this. Address them directly, and NEVER create a step that emails them "
        f"or delegates/assigns a task to them: they are not a colleague to hand work "
        f"to. If the task needs input from them, that is an 'ask' step, not an email."
    )


def _with_requester(prompt: Optional[str], requester: Optional[dict]) -> Optional[str]:
    """Append the requester preamble to a prompt (executor/planner), if any."""
    ctx = requester_context(requester)
    if not ctx:
        return prompt
    return f"{prompt}\n\n{ctx}" if prompt else ctx


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
        # Live handle to each session's executing Plan, kept only while its drive
        # loop is running (_drive_until_quiescent sets/clears it). converse_turn
        # uses it to append steps to a plan mid-flight — the drive loop then runs
        # them on its next pass, exactly as create_task grows a plan.
        self._active: Dict[str, Plan] = {}
        # One lock per session, serializing concurrent amends (converse_turn) so
        # they run one at a time and each plans against the plan the previous one
        # already changed — not from the same stale snapshot, which is what let
        # two near-simultaneous "update the plan" messages conflict. Structural
        # tearing is NOT the concern here: the in-memory step mutations are all
        # await-free blocks (atomic under single-threaded asyncio), and the drive
        # loop runs a pre-built graph, so it deliberately does NOT take this lock —
        # plan execution keeps running while amends queue behind each other.
        self._plan_locks: Dict[str, asyncio.Lock] = {}

    def _plan_lock(self, session_id: str) -> asyncio.Lock:
        # ponytail: grows one Lock per session, never evicted — fine at this scale;
        # evict on session finish if the process runs long enough to matter.
        lock = self._plan_locks.get(session_id)
        if lock is None:
            lock = asyncio.Lock()
            self._plan_locks[session_id] = lock
        return lock

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
            if not wait.get("interrupt_id"):
                # Never parked — either the ordinary tiny window between
                # registering and parking, or a step with create_task access
                # that sent mail eagerly-tokened but never actually created an
                # await_reply step to consume it. Nothing real is waiting on
                # this one, so there is no step or owner to notify.
                continue
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
        tools.

        The per-connector fire-and-forget `schedule_<connector>_task` tool is
        deliberately NOT granted. It was broken and dangerous:

        - long_running.start_task (and poller._poll_task) hardcode
          streamablehttp_client and never read the connector's
          mcp_transport_type, so on an SSE connector — which Microsoft365 is —
          it POSTs to the /sse endpoint and dies with 405. Seen live.
        - Worse if that were merely fixed: models were choosing it to SEND
          MAIL, reading "their reply can take hours or days" next to the
          prompt's "for a LONG-RUNNING action call schedule_*_task". Mail sent
          that way bypasses send_email, which is where the routing token is
          stamped (see _mail_stamping) — so the reply could never match its
          wait and the step would hang forever, silently. The 405 was the
          safer failure.

        Sending mail is instant; the WAITING is create_task(kind='await_reply')'s
        job, not a scheduled MCP task. Re-granting this needs both a transport
        column on mcp_tasks (the poller reconnects in another process, so it
        cannot infer it) and prompt wording that keeps it away from email.

        Uses the app's proven `create_connector_tools` (per-action function tools
        that open a one-shot MCP connection via call_mcp_tool) — NOT ADK's
        McpToolset, whose session manager triggers Google-auth mTLS metadata
        probes that stall and fail off-GCP."""
        connectors = connectors or []
        from src.smart_rag.tools.utilities.connector_tools import (
            create_connector_tools, ConnectorToolContext)
        return create_connector_tools(
            connectors, ConnectorToolContext(session_id=session_id))

    def _capture_artifacts(self, session_id: str, step: Step, tools: List) -> List:
        """Wrap this step's connector tools so files they produce become rows.

        The playbook surfaces a generated file as a gRPC artifact component on
        the turn's stream. Worky has no stream — the client reads the Postgres
        read model over Electric — so the same file has to become a durable row
        instead, or it is invisible: the model sees the storage key in its own
        tool result and nothing else ever does.

        Wrapped per step rather than once per turn because the row needs the
        step id, which is what lets the client hang each file off the card that
        produced it. Same reason _mail_stamping wraps per step.
        """
        if self._rm is None:
            return tools
        rm = self._rm

        async def on_artifact(artifact: dict, _step_id=step.id):
            await rm.add_step_artifact(session_id, _step_id, **artifact)

        return [nodes.capture_artifacts_tool(t, on_artifact=on_artifact)
                if getattr(t, "func", None) is not None else t
                for t in tools]

    def _mail_stamping(self, session_id: str, user_id: str, plan: Plan):
        """Give each send step the token of the step waiting on its reply.

        The link is the plan's own edge: an await_reply step depends_on the step
        that sends the mail it waits for. Nothing else in the plan needs to know,
        and the executor LLM never sees the token — a marker it was merely asked
        to include would be omitted eventually, and that step would wait forever.

        That edge only exists upfront for steps the planner already wired with
        an await_reply sibling. Any step can spin one up mid-turn instead
        (create_task(kind='await_reply'), after it has already sent the mail) —
        at that point the sibling doesn't exist yet, so there is nothing to look
        up. So every other send is tokened eagerly, the moment mail goes out,
        under a placeholder id; create_task rebinds it onto the real step if/when
        one is actually created (see _create_task_tool_for). If that never
        happens the row just expires unclaimed — see expire_mail_waits's
        interrupt_id guard — which is why stamping every step costs nothing and
        guessing which ones would need it cost replies.
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
        rm = self._rm

        def tools_for_step(step: Step, tools: List) -> List:
            await_step_id = await_step_for.get(step.id)
            if await_step_id:
                async def token_provider(_step_id=await_step_id):
                    return await rm.mail_token_for(session_id, _step_id)
                # The wait already exists (minted at projection); the recipients
                # are only known now, at send — record them so the reply's sender
                # is verified (against any recipient) when it arrives.
                async def on_sent(token, recipients):
                    if recipients:
                        await rm.set_mail_wait_expected_from(token, ",".join(recipients))
                return [nodes.stamp_send_email_tool(t, token_provider=token_provider, on_sent=on_sent)
                        if nodes.is_send_email_tool(t) else t
                        for t in tools]
            pending_id = f"__pending__:{step.id}"

            # Mint only — pure, no DB. The token has to be in the mail, so
            # it must exist before the send; the WAIT must not, or a send
            # that raises strands the step on a reply to an email that was
            # never sent. Persisting therefore happens in on_sent below.
            async def eager_token_provider():
                return mail_token.mint()

            async def eager_on_sent(token, recipients, _pending_id=pending_id):
                expires_at = datetime.now(timezone.utc) + timedelta(
                    hours=self._mail_wait_timeout_hours)
                await rm.register_mail_wait(
                    token, session_id=session_id, step_id=_pending_id,
                    user_id=user_id, expected_from=(",".join(recipients) or None),
                    expires_at=expires_at)
            return [nodes.stamp_send_email_tool(
                        t, token_provider=eager_token_provider, on_sent=eager_on_sent)
                    if nodes.is_send_email_tool(t) else t
                    for t in tools]

        return tools_for_step

    def _delegate_tool_for(self, session_id: str, user_id: str, plan: Plan,
                           factory_holder: list, name_to_step: dict, caller_step_id: str,
                           siblings: Optional[set] = None):
        """Tool given to every step (see nodes.py/human_agents.py):
        hand a question or task to ANOTHER human agent — e.g. Rabeb decides
        investment approval is out of her scope and asks Oussama.

        The delegate is a normal SCHEDULED step, and the caller does not wait
        for it: whatever needs the answer depends on that step. Asking a real
        colleague is asynchronous — they reply by email hours or days later —
        so it could never have completed inside the caller's turn anyway,
        exactly as create_task(kind='await_reply') already concluded.

        It also must not run nested. `ctx.run_node` buffers a sub-node's events
        until it finishes, while ADK rebuilds llm_request contents from session
        events before every call — so a nested sub-agent never saw its OWN
        previous tool calls (verified live: 0 model rounds and 0 function calls
        in context on all 25 of its calls). Any sub-agent using even one tool
        re-issued that call forever, since turn 2 could not see what turn 1
        did, until the budget cap forced a fabricated "could not escalate"
        answer. Only a single-turn, tool-free sub-agent ever worked, and ADK
        offers no flush/stream option on run_node to change that.

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
            # `siblings` only protects steps spawned in THIS SAME burst — it's
            # a fresh set per _build_workflow call, not persisted across turns.
            # A step from an EARLIER turn (already blocked on its own reply, or
            # already completed) can outlive that set and still show up here on
            # a later resume where the caller's replayed reasoning spawns
            # another, unrelated dynamic step. Restricting to PENDING excludes
            # it: only a same-burst sibling that hasn't started yet legitimately
            # needs to wait on this new one too.
            affected = [o for o in plan.steps
                       if o.id != sub_step.id and o.id not in siblings
                       and caller_step_id in o.depends_on
                       and sub_step.id not in o.depends_on
                       and o.status == Status.PENDING]
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

            # Deliberately does NOT run the delegate here and hand its answer
            # back. Asking a real colleague is asynchronous — they answer by
            # email, hours or days later — so it cannot complete inside the
            # caller's turn, exactly as create_task(kind='await_reply') already
            # concluded. The delegate is a normal scheduled step, and whatever
            # needs its answer depends on it.
            #
            # Running it nested (ctx.run_node) was also actively broken:
            # run_node buffers the sub-node's events and only flushes them to
            # the session once it finishes, while ADK rebuilds llm_request
            # contents from session events before every call. A nested
            # sub-agent therefore never saw its OWN previous tool calls —
            # verified live: contents came back with 0 model rounds and 0
            # function calls on every one of its 25 calls. Any sub-agent using
            # even one tool re-issued that call forever (turn 1 calls it, turn
            # 2 cannot see the result, so it calls it again) until the budget
            # cap forced a fabricated "could not escalate" answer. Only a
            # single-turn, tool-free sub-agent ever worked. ADK exposes no
            # flush/stream option on run_node to fix that in place.
            return (f"Asked {agent_display_name}. This is now its own step in the plan — "
                    "it will reach them and their real answer arrives there, not here. "
                    f"Do NOT wait for it, and never guess what {agent_display_name} will "
                    "say. End your own turn now, reporting plainly that you asked them "
                    "and their answer is pending.")

        # Built directly rather than via create_search_schema: that helper adds
        # a "strict" key that OpenAI-style function schemas accept but ADK's
        # own google.genai.types.FunctionDeclaration (what SearchToolADK feeds
        # this into) has no field for and rejects outright.
        schema = {
            "function": {
                "name": "delegate_to_human_agent",
                "description": (
                    "Hand a question or task to ANOTHER named human agent. Use this when "
                    "the task needs someone else's role or authority — e.g. you are not "
                    "authorized to decide something yourself and need to ask a colleague "
                    "who is. They are a real person and answer by email, hours or days "
                    "later, so this does NOT hand their answer back to you: it becomes "
                    "its own step in the plan where their real answer lands. Call it, "
                    "then end your own turn reporting that you asked them — never wait "
                    "for it and never guess what they will say. Use find_human_agents "
                    "first if you don't already know their exact name."),
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
        """Tool given to every step: spin off a brand-new follow-up
        task and get its result back before continuing — for when something
        just learned (e.g. an email reply) means real work needs to happen,
        not just get written down as a condition in your own final answer.

        Deliberately separate from delegate_to_human_agent: that tool is for
        a SPECIFIC named colleague's judgment; this one is for work that
        isn't anyone in particular — a check to run, something to verify,
        another email to send and wait on.

        Two shapes, by `kind`, and the split is not cosmetic:

        - 'execute' builds an LlmAgent, so like a delegate it is a SCHEDULED
          step and never runs nested — a nested sub-agent cannot see its own
          previous tool calls and loops forever (see _delegate_tool_for).
        - 'ask'/'await_reply' build one-shot WAIT nodes (hitl.make_*_node)
          with no LLM loop, so the amnesia cannot bite them, and they DO run
          here via ctx.run_node — they have to, so they park and register the
          interrupt that a chat answer or an incoming mail reply later
          resumes. Leaving one merely PENDING would strand the wait with
          nothing to resume and silently break the whole reply path.

        `siblings` must be the SAME set passed to _delegate_tool_for for this
        caller (see _build_workflow) — both tools grow the same plan mid-turn
        and must treat each other's spawned steps as siblings, not a chain.
        """
        from google.adk.tools.tool_context import ToolContext
        from src.smart_rag.tools.search.tools import SearchToolADK

        siblings = siblings if siblings is not None else set()

        async def create_task(description: str, kind: str = "execute",
                              after: Optional[List[str]] = None, *,
                              tool_context: ToolContext = None) -> str:
            """Spin off a follow-up task as its own step in the plan.

            description: what that step must do, as a complete standalone
                instruction — the step is not told anything else.
            kind: 'execute' for work, 'ask' to ask the user, 'await_reply' to
                wait on an email reply you have ALREADY sent.
            after: step ids this new step must wait for, from the ids earlier
                create_task calls returned. Omit it and the step starts
                immediately, in parallel with the others you created.
            """
            if kind not in ("execute", "ask", "await_reply"):
                return f"Unknown kind {kind!r} — use 'execute', 'ask', or 'await_reply'."
            if len(plan.steps) >= MAX_PLAN_STEPS:
                return "Cannot create another task — this plan has reached its step limit."

            caller = plan.step(caller_step_id)
            # Without `after`, every step spawned here hangs off the caller alone,
            # so they all run in parallel and can only fan out. A reply asking for
            # two searches AND a decision once both are in needs the third step to
            # join them — that shape is only expressible if the model can name
            # which siblings to wait for. Unknown ids are dropped rather than
            # rejected: a hallucinated id would otherwise fail the whole call,
            # where ignoring it merely loses the ordering.
            after_ids = [i for i in (after or [])
                         if i != caller_step_id and plan.step(i) is not None]

            # This step is born mid-turn, after plan_turn's one-time stamping
            # pass — read the client's executor identity straight off the
            # plan (set once at plan_turn) rather than a sibling step, since
            # a plan can be entirely persona-assigned with no plain step to
            # copy from (e.g. the planner routed straight to a human agent).
            sub_step = Step(title=description[:60], description=description, kind=kind,
                            is_dynamic_delegate=True,
                            depends_on=[caller_step_id] + after_ids,
                            assignee=plan.executor_id,
                            assignee_name=plan.executor_name or DEFAULT_EXECUTOR_LABEL)
            plan.steps.append(sub_step)
            followup_step = None
            if kind == "await_reply":
                if self._rm is not None:
                    # The caller already sent its mail before calling us — its
                    # send_email tool minted a token eagerly under a placeholder
                    # (see _mail_stamping), since this step didn't exist yet at
                    # send time. Retarget that token onto the real step now, so
                    # the reply this step is about to park on can actually match.
                    moved = await self._rm.rebind_mail_wait(
                        session_id, f"__pending__:{caller_step_id}", sub_step.id)
                    if not moved and not await self._rm.mail_token_for(session_id, sub_step.id):
                        # No token anywhere for this step, so no arriving reply
                        # could ever match it: the step would park on an
                        # interrupt nothing can resume, and the plan would block
                        # forever. Seen live in session
                        # 681a01cfcd014e80a851f2b33e2b823e, where the model
                        # created the wait ALONGSIDE the step meant to send the
                        # mail rather than after it — so at this moment nothing
                        # had been sent. Refuse and say how to order it; the
                        # model can still fix this within the same turn, which a
                        # silent block never allowed.
                        plan.steps.remove(sub_step)
                        logger.warning("[worky] create_task await_reply refused — no mail "
                                       "sent by caller session=%s caller=%s", session_id,
                                       caller_step_id)
                        return ("No email has been sent yet in THIS step, so there is nothing "
                                "to wait for — this wait could never be matched to a reply. "
                                "First check whether the reply you want is already in your "
                                "context above: if a step before you sent that mail and its "
                                "answer has come back, you are the step meant to ACT on it — "
                                "do that now and do not email anyone again. Only if no such "
                                "mail has gone out at all should you send it yourself and "
                                "then call this again; and if another task you created is "
                                "the one that sends it, create this wait with "
                                "after=['<that task's id>'] instead, so it starts only once "
                                "that task has actually sent it.")
                # A real reply can take hours or days — far longer than the
                # caller's own tool call can stay alive. Confirmed live: the
                # caller's turn simply ends once this call returns (see
                # persona_preamble/instruction_for_step); nothing is left
                # mid-flight to "continue" once the reply lands, no matter how
                # the resume is driven. A genuinely separate, independently
                # scheduled follow-up step is what reads the reply and gives
                # the real answer, on whatever later turn it actually arrives
                # — exactly the planner's own send/await/act shape (see
                # PLANNER_INSTRUCTION's await_reply rule), just spawned here
                # instead of planned upfront.
                # The SAME `description` cannot be reused verbatim here. It was
                # written as the WAIT's instruction, so it reads "wait for and
                # read X's reply" — handing that to the step that runs once the
                # reply is already in makes it try to wait all over again. Seen
                # live (session a936b31bf70246349a7df1463486020a): this step had
                # Firas's reply in its context, read its own task as "wait for a
                # reply", called create_task(kind='await_reply') again, and when
                # that was refused sent Firas a DUPLICATE of the original email.
                # So the reply's arrival has to be stated as fact, ahead of the
                # original wording rather than instead of it — the caller's
                # "when it arrives, do X" is still the right instruction for X.
                followup_step = Step(
                    title=f"Act on reply: {description[:40]}",
                    description=(
                        "The reply you were waiting for HAS ALREADY ARRIVED and is in "
                        "your context above — this step runs only because it came in. "
                        "Do not send another email about it and do not register another "
                        "wait for it; that would re-ask a question that has already been "
                        "answered. Read what the reply actually says and act on it, "
                        "following the instruction it was awaited under:\n\n"
                        f"{description}"),
                    kind="execute", is_dynamic_delegate=True, depends_on=[sub_step.id],
                    is_persona=bool(caller and caller.is_persona),
                    assignee=(caller.assignee if caller and caller.is_persona else plan.executor_id),
                    assignee_name=((caller.assignee_name if caller and caller.is_persona
                                    else plan.executor_name) or DEFAULT_EXECUTOR_LABEL),
                    assignee_role=caller.assignee_role if caller and caller.is_persona else None)
                plan.steps.append(followup_step)
            # Same sibling/wave bookkeeping as _delegate_tool_for — see there
            # for why this matters.
            # `siblings` only protects steps spawned in THIS SAME burst — it's
            # a fresh set per _build_workflow call, not persisted across turns.
            # A step from an EARLIER turn (already blocked on its own reply, or
            # already completed) can outlive that set and still show up here on
            # a later resume where the caller's replayed reasoning spawns
            # another, unrelated dynamic step. Restricting to PENDING excludes
            # it: only a same-burst sibling that hasn't started yet legitimately
            # needs to wait on this new one too.
            # `o.id not in after_ids` is the cycle guard: this step already waits
            # on those, so making them wait on it too is a deadlock the scheduler
            # would (rightly) refuse to order.
            affected = [o for o in plan.steps
                       if o.id != sub_step.id and o.id not in siblings
                       and o.id not in after_ids
                       and caller_step_id in o.depends_on
                       and sub_step.id not in o.depends_on
                       and o.status == Status.PENDING]
            for other in affected:
                other.depends_on.append(sub_step.id)
            siblings.add(sub_step.id)
            if followup_step is not None:
                siblings.add(followup_step.id)
            scheduler.validate(plan)
            scheduler.assign_waves(plan)
            name_to_step[graph.node_name(sub_step.id)] = sub_step.id
            if followup_step is not None:
                name_to_step[graph.node_name(followup_step.id)] = followup_step.id
            logger.info("[worky] create_task session=%s → %r (step=%s, kind=%s)",
                        session_id, sub_step.title, sub_step.id, kind)
            await self._project_step(session_id, plan, sub_step)
            if followup_step is not None:
                await self._project_step(session_id, plan, followup_step)
            for other in affected:
                await self._project_step(session_id, plan, other)

            # 'ask' and 'await_reply' build a WAIT node (hitl.make_ask_user_node /
            # make_await_reply_node), not an LlmAgent: one shot, no LLM loop, and
            # it must run HERE so it actually parks and registers its interrupt
            # within this turn — that interrupt is what a chat answer or an
            # incoming mail reply later resumes. Leaving it merely PENDING would
            # strand the wait with nothing to resume, silently breaking the whole
            # reply path. Having no LLM loop, it is immune to the nested-run
            # amnesia described below.
            if kind in ("ask", "await_reply"):
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
                    await tool_context.run_node(
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
                if kind == "await_reply":
                    # Deliberately not the reply's content — it isn't in yet, and
                    # won't be before this call returns. A separate follow-up
                    # step (already created above) reads it once it arrives.
                    return ("Await-reply step created. A separate follow-up step will "
                            "read the reply and give the real answer once it arrives — "
                            "end your own turn now reporting the draft as sent and "
                            "awaiting reply, and do not guess what they will decide.")
                return "Question put to the user; their answer resumes this plan."
            # 'execute' builds an LlmAgent, and THAT cannot run nested: run_node
            # buffers the sub-node's events until it finishes, while ADK rebuilds
            # the LLM contents from session events before every call — so a nested
            # sub-agent never saw its own previous tool calls and re-issued them
            # forever (see _delegate_tool_for for the full finding). It is a real
            # scheduled step instead, and whatever needs its result depends on it.
            return (f"Task created as its own step in the plan ({sub_step.id}). Its result "
                    "lands there, not here — do NOT wait for it or guess what it will "
                    "find. If a later task you create must not start until this one is "
                    f"done, pass after=['{sub_step.id}'] when you create it. Otherwise end "
                    "your own turn now, reporting plainly that you spun it off.")

        schema = {
            "function": {
                "name": "create_task",
                "description": (
                    "Spin off a brand-new follow-up task — use this when something you "
                    "just learned (e.g. an email reply) means real work actually needs to "
                    "happen, instead of just noting it as a condition in your own answer. "
                    "The task becomes its own step in the plan and runs separately: it "
                    "does NOT hand a result back to you, whatever the kind. Call it, then "
                    "end your own turn reporting that you spun it off — never wait for it "
                    "and never guess what it will find. For asking a specific named "
                    "colleague, use delegate_to_human_agent instead. Examples: running a "
                    "check, verifying a claim, sending another email and waiting for "
                    "its reply."),
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
                                    "'execute' (default): normal work, run as its own step — its "
                                    "result lands there, not back with you. 'await_reply': registers "
                                    "a wait for a reply to an email sent IN THIS STEP, and only that "
                                    "— it does not send anything, so send the mail first. Do NOT use "
                                    "it for mail an earlier step sent: if that reply has already come "
                                    "back it is in your context and you should act on it, and if it "
                                    "has not, that earlier step's own wait is already running. A "
                                    "reply can take hours or days, so this call does NOT wait for it "
                                    "and does not hand its result back to you; a separate follow-up "
                                    "step reads the reply and gives the real answer once it's in, "
                                    "using `description` as its instruction for what to do with it. "
                                    "'ask': only to ask the end user something directly.")},
                        "after": {"type": "array", "items": {"type": "string"},
                                  "description": (
                                      "ids of tasks this one must WAIT for, taken from the ids "
                                      "earlier create_task calls returned. Omit it and this task "
                                      "starts immediately, in parallel with the others you "
                                      "created — so a task that has to read what another one "
                                      "produced, or email someone about it, MUST list that task "
                                      "here or it will run before there is anything to read. Use "
                                      "it only for a real ordering need: parallel is faster.")},
                    },
                    "required": ["description"],
                    "additionalProperties": False,
                },
            }
        }
        return SearchToolADK(create_task, schema)

    def _build_workflow(self, session_id: str, user_id: str, plan: Plan, model: str,
                        connectors: Optional[List[dict]], executor_prompt: Optional[str],
                        replay_completed: bool = False):
        """STEP 8, shared by plan_turn/resume_turn/continue_turn: connectors +
        persona-delegation → executor tools, plan → ADK Workflow.

        `replay_completed`: rebuild already-COMPLETED steps as their stored result
        (no re-execution) — set on the plain-message re-drive paths (continuation
        loop, continue_turn) where ADK would otherwise re-run the whole graph.
        Left False on resume_turn, whose resume_part genuinely replays history."""
        name_to_step = {graph.node_name(s.id): s.id for s in plan.steps}
        factory_holder: List = []

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

        mail_tools_for_step = self._mail_stamping(session_id, user_id, plan)

        def tools_for_step(step: Step, tools: List) -> List:
            # Every step gets the same toolset, unconditionally. EXECUTOR_INSTRUCTION
            # tells each step that every other step has the SAME tools it does, and
            # orders any step that sends a reply-critical mail to register an
            # await_reply — a step that then finds create_task missing can only
            # stall or fabricate. Gating on persona/reads-a-reply guessed upfront
            # which steps would need to grow the plan, and guessed wrong whenever a
            # mail reply named work the planner never saw.
            if mail_tools_for_step:
                tools = mail_tools_for_step(step, tools)
            tools = self._capture_artifacts(session_id, step, tools)
            # Shared with both dynamic-step tools below: whichever spawns
            # a step first, the other must still treat it as a sibling,
            # not something to chain the next one after.
            siblings: set = set()
            return list(tools) + [
                human_agents.make_find_human_agents_tool(),
                self._delegate_tool_for(session_id, user_id, plan, factory_holder,
                                        name_to_step, step.id, siblings),
                self._create_task_tool_for(session_id, user_id, plan, factory_holder,
                                           name_to_step, step.id, siblings)]

        def instruction_for_step(step: Step) -> Optional[str]:
            if not _reads_a_mail_reply(step):
                return None
            return (
                "Work this reply asks for is never already covered by some other "
                "step: the plan was written BEFORE the reply existed, so nothing "
                "in it can have anticipated what the reply turned out to say. If "
                "the reply asks for something, it exists only because you create "
                "it — assuming another step has it is how a reply ends up "
                "actioned by nobody. Read it as the sender's own words, not as "
                "the plan restating itself.\n\n"
                "The reply you're processing may itself contain instructions — "
                "naming a colleague to loop in, another party to email, or any "
                "real work that was not part of your own step's original "
                "description. Even when you already have the tool to do that "
                "work yourself, spin it off instead of doing it inline: "
                "find_human_agents + delegate_to_human_agent for a named "
                "colleague's judgment, or create_task for anything else "
                "(kind='await_reply' if it itself means emailing someone and "
                "waiting on THEIR answer) — that keeps it tracked as its own "
                "step instead of silently folded into this one. Never just "
                "restate what the reply asked for as something still pending.\n\n"
                "This can chain as many times as it genuinely needs to: if "
                "handling this reply means sending another email and waiting, "
                "send it and wait, and if THAT reply asks for yet another "
                "round, keep going the same way — one reply is not the end by "
                "default, whatever it actually takes is. Only stop once "
                "nothing further is actually being asked for.")

        factory = nodes.make_llm_node_factory(
            model_name=model,
            tools=self._tools_for(connectors, session_id, user_id),
            tools_for_step=tools_for_step,
            instruction_for_step=instruction_for_step,
            custom_instruction=executor_prompt,
            replay_completed=replay_completed)
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
                        executor_id: Optional[str] = None,
                        requester: Optional[dict] = None) -> Plan:
        logger.info("[worky] 5. plan_turn ◄ session=%s model=%s connectors=%d requester=%r",
                    session_id, model, len(connectors or []), (requester or {}).get("name"))
        await self._project(self._rm and self._rm.ensure_session(session_id, user_id, None, "running"))
        # The executor must know who it is working for too (for how it addresses
        # the person and who it may/ may not email), so fold the requester context
        # into its prompt once here — it flows to both the workflow build and the
        # drive loop below.
        executor_prompt = _with_requester(executor_prompt, requester)

        # STEP 5 — planner LLM → Plan. Zero steps means it chose a direct reply
        # (chit-chat): answer and finish the turn here, no graph is ever built.
        plan = await self._make_plan(session_id, user_id, message,
                                     planner_model=planner_model, planner_prompt=planner_prompt,
                                     requester=requester)
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
        interrupt = await self._drive_until_quiescent(
            runner, session_id, user_id, plan, name_to_step,
            types.Content(role="user", parts=[types.Part(text="run the plan")]),
            model=model, connectors=connectors, executor_prompt=executor_prompt)

        # STEP 10 — derive the final status and post the assistant reply.
        await self._finalize(session_id, plan, interrupt)
        return plan

    async def converse_turn(self, *, session_id: str, user_id: str, message: str,
                            planner_model: Optional[str] = None,
                            planner_prompt: Optional[str] = None,
                            requester: Optional[dict] = None) -> Plan:
        """A message that arrives WHILE a plan is executing.

        This is deliberately NOT the old supersede (cancel the running turn and
        replan): that destroyed the plan the user was watching, and cancelling a
        mid-LLM-call turn is both slow and noisy (litellm wraps the aborted call
        as an APIError). Instead the planner runs conversationally ALONGSIDE the
        still-executing plan, on its own separate planner session — the two
        interleave on the event loop, neither cancels the other.

        A CASE A reply (no steps) is answered in place — chit-chat, plan
        untouched. A CASE B reply (the planner produced steps for a real task)
        is ADDED to the running plan: its steps are appended to the live plan
        object and the drive loop runs them on its next pass (Phase 2). We never
        fall back to the destructive cancel here.
        """
        # Give the planner the running plan AND its results, so an amend that
        # needs earlier output ("email the summary") can bake that output into
        # the new step — the results of the steps it depends on are already
        # produced, sitting in step.result. Without this the planner has no idea
        # what "the summary" is and asks the user instead (seen live: session
        # 3cd66578…). Still an EPHEMERAL planner session (no accumulated history),
        # so it never re-plans the existing work — the context is given
        # explicitly and framed as already-done.
        # Serialize amends per session: hold the lock across the WHOLE turn —
        # read the live plan, plan against it, apply — so a second amend waits and
        # then plans against the plan that already includes this one's steps,
        # instead of both planning from the same stale snapshot and conflicting.
        # The drive loop does NOT take this lock, so plan execution keeps running;
        # only concurrent amends queue behind each other (asyncio.Lock is FIFO).
        async with self._plan_lock(session_id):
            live = self._active.get(session_id)
            amend_message = self._amend_message(live, message) if live is not None else message
            plan = await self._make_plan(
                session_id, user_id, amend_message,
                planner_model=planner_model, planner_prompt=planner_prompt,
                plan_session=f"{session_id}_conv_{uuid.uuid4().hex[:8]}",
                requester=requester)
            live = self._active.get(session_id)  # re-check: may have finished while planning
            logger.info("[worky] converse ◄ session=%s steps=%d ops=%d live=%s",
                        session_id, len(plan.steps), len(plan.ops), live is not None)
            if not plan.steps and not plan.ops:
                await self._add_message(session_id, "assistant", plan.answer or "")
            elif live is not None:
                # Ops (cancel/modify existing pending steps) first, then new steps.
                op_notes = await self._apply_ops(session_id, live, plan.ops)
                # Grab titles BEFORE injecting (ids/deps are rewritten in place, but
                # titles are stable) so the reply names what was added.
                titles = [s.title or (s.description[:50] + "…" if len(s.description) > 50
                                      else s.description) for s in plan.steps]
                n = await self._inject_steps(session_id, user_id, live, plan.steps)
                # Prefer the planner's own words if it wrote any; otherwise a
                # content-aware line naming what changed — not a fixed line every time.
                reply = (plan.answer or "").strip()
                if not reply:
                    bits = list(op_notes)
                    joined = "; ".join(t for t in titles if t)
                    if joined:
                        bits.append(f"added: {joined}")
                    elif n:
                        bits.append(f"added {n} step{'s' if n != 1 else ''}")
                    reply = f"Got it — {'; '.join(bits)}." if bits \
                        else "Got it — nothing to change there."
                await self._add_message(session_id, "assistant", reply)
            else:
                # The plan finished between the routing check and now — nothing live
                # to amend. Don't silently drop the request.
                await self._add_message(
                    session_id, "assistant",
                    "The plan just finished — send that again and I'll start it fresh.")
        return plan

    @staticmethod
    def _amend_message(live: Plan, message: str) -> str:
        """Frame the user's amend as CASE-C context: the running plan and every
        result produced so far, marked ALREADY DONE, followed by the request.

        The planner then writes only the NEW step(s) and can paste an existing
        result straight into them (e.g. the summary into an email step), instead
        of asking the user what "the summary" is."""
        lines = []
        for s in live.steps:
            label = s.title or (s.description[:60] if s.description else s.id)
            lines.append(f"[{s.id}] {label} ({s.status.value})")
            if s.result:
                lines.append(f"    result: {s.result}")
        context = "\n".join(lines)
        return (
            "You are AMENDING a plan that is ALREADY RUNNING for the user. The "
            "steps below already exist and their results (where produced) are "
            "shown — they are DONE. Do NOT recreate or restate them.\n\n"
            f"--- running plan ---\n{context}\n--- end plan ---\n\n"
            "The user now says the following. Usually you ADD work: return the "
            "NEW step(s) needed for it as a normal plan. Where a new step needs an "
            "existing result, paste that result directly into the step's "
            "description (do not refer to it as 'the summary' — the executor can't "
            "see other steps).\n\n"
            "But if the user instead wants to CHANGE a step that is still "
            "'pending' above, don't add a step — return an `ops` entry keyed by "
            "that step's [id]:\n"
            "  - to drop it:   {\"op\": \"cancel\", \"step_id\": \"<id>\"}\n"
            "  - to reword it: {\"op\": \"modify\", \"step_id\": \"<id>\", "
            "\"description\": \"<the step's full new instruction>\"}\n"
            "Only a 'pending' step can be changed — a 'running' or 'completed' one "
            "has already started, so amend it by adding a follow-up step instead. "
            "You may combine `ops` and new `steps` in one response.\n\n"
            "Give a short, friendly `answer`.\n\n"
            f"USER MESSAGE: {message}")

    async def _inject_steps(self, session_id: str, user_id: str, live: Plan, new_steps: List[Step]) -> int:
        """Append planner-produced steps to a LIVE, executing plan.

        The drive loop (_drive_until_quiescent) rebuilds the workflow each pass
        and runs any PENDING step that wasn't in the graph it just ran — the same
        path create_task uses — so appending here is all it takes for the new
        steps to execute.

        The planner built these standalone (ids 's1'…, not knowing the running
        plan), so: give each a fresh id that can't collide with a live step,
        remap the batch's internal depends_on to those ids, and drop any
        depends_on that isn't in the batch (they don't depend on existing running
        steps — a first cut; "insert after step X" is a later refinement). Each
        runs as soon as its own deps (if any) are met.
        """
        if not new_steps:
            return 0
        # The plan's frontier: steps nothing currently depends on. Injected steps
        # hang off it so they schedule in a NEW wave AFTER all existing work.
        # Without this, an independent step (no deps) lands in wave 0 alongside
        # already-completed steps, and the re-drive re-RUNS that whole wave
        # instead of replaying it — seen live: adding "search Ethereum" re-ran the
        # finished Bitcoin step. create_task never hits this because its spawned
        # steps always depend on their caller, i.e. a later wave.
        frontier = [s.id for s in live.steps
                    if not any(s.id in o.depends_on for o in live.steps)]
        id_map = {s.id: uuid.uuid4().hex[:12] for s in new_steps}
        for s in new_steps:
            s.id = id_map[s.id]
            # Keep the batch's own ordering; a batch-root (no in-batch dep) hangs
            # off the frontier so no completed wave is disturbed.
            s.depends_on = [id_map[d] for d in s.depends_on if d in id_map] or list(frontier)
            s.status = Status.PENDING
            if not s.is_persona:
                s.assignee = live.executor_id
                s.assignee_name = live.executor_name or DEFAULT_EXECUTOR_LABEL
        live.steps.extend(new_steps)
        scheduler.validate(live)
        scheduler.assign_waves(live)
        for s in new_steps:
            await self._project_step(session_id, live, s)
        # An await_reply step ADDED by an amend needs its own routing token, or
        # the mail it waits on can never be matched and the step hangs forever.
        # cancel_mail_waits (via _register_mail_waits) is NOT called here — that
        # would drop the tokens the already-running steps depend on; only the new
        # await_reply steps get minted.
        await self._mint_mail_waits(session_id, user_id, new_steps)
        logger.info("[worky] converse injected %d step(s) into live plan session=%s: %s",
                    len(new_steps), session_id, [s.id for s in new_steps])
        return len(new_steps)

    async def _apply_ops(self, session_id: str, live: Plan, ops: List[dict]) -> List[str]:
        """Apply converse cancel/modify ops to a LIVE plan — PENDING steps only.

        This is the whole "safe subset" of amending a running plan: it never
        touches the graph topology, only what a not-yet-fired node will do. The
        node factory closed over these same step objects and reads status/
        description at model-call time (_skip_if_cancelled, the lazy task turn),
        so mutating them here takes effect on the current drive pass with no
        rebuild. A step that has already started (running/completed/blocked)
        can't be safely re-touched — its events are in ADK's replay history —
        so we refuse and say so, the same way the amend prompt tells the planner
        to add a follow-up step instead.
        """
        notes: List[str] = []
        for op in ops:
            step = live.step(op.get("step_id", ""))
            if step is None:
                continue
            label = step.title or (step.description[:40] if step.description else step.id)
            if step.status != Status.PENDING:
                notes.append(f"couldn't change '{label}' — it's already {step.status.value}")
                continue
            kind = op.get("op")
            if kind == "cancel":
                step.status = Status.CANCELLED
                # A status change must go through set_step_status — upsert_steps
                # (what _project_step uses) deliberately does NOT touch `status`
                # on conflict, so projecting a cancelled step that way leaves the
                # read-model row 'pending' (seen live: session e9adde, s2).
                await self._project(self._rm and self._rm.set_step_status(
                    session_id, step.id, Status.CANCELLED.value))
                notes.append(f"cancelled '{label}'")
            elif kind == "modify" and op.get("description"):
                step.description = op["description"]
                # Only the description changed; upsert_steps DOES update that.
                await self._project_step(session_id, live, step)
                notes.append(f"updated '{label}'")
            else:
                continue
            logger.info("[worky] converse op=%s step=%s session=%s", kind, step.id, session_id)
        return notes

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
        outstanding_pairs = await self._rm.outstanding_interrupts(session_id)
        outstanding = {i for i, _ in outstanding_pairs}
        if outstanding and interrupt_id not in outstanding:
            raise RuntimeError(
                f"interrupt {interrupt_id} is not outstanding for session {session_id}")

        # STEP 8 (resume) — same step ids + depends_on ⇒ same node names + edges,
        # which is what lets the interrupt id from the earlier run still match.
        # That stability assumption does NOT hold for a step create_task/
        # delegate_to_human_agent spawned mid-turn: its first-ever park happened
        # inside a throwaway nested run (ctx.run_node), whose node path this flat
        # rebuild structurally cannot reproduce — ADK would just re-block it
        # under a brand new interrupt id, silently dropping the answer we have
        # right here. Apply it directly and let the SAME short-circuit that
        # replays an already-completed dynamic step (see nodes.py factory)
        # carry it, instead of routing through node-path matching that can
        # never succeed for this category of step.
        plan = _plan_from_snapshot(snap)
        target_step_id = next((s for i, s in outstanding_pairs if i == interrupt_id), None)
        target_step = plan.step(target_step_id) if target_step_id else None
        resumed_out_of_band = bool(
            target_step and target_step.is_dynamic_delegate and target_step.kind == "await_reply")
        if resumed_out_of_band:
            target_step.status = Status.COMPLETED
            target_step.result = answer
            await self._project(self._rm.set_step_status(
                session_id, target_step.id, "completed", result=answer))

        wf, name_to_step = self._build_workflow(session_id, user_id, plan, model, connectors, executor_prompt)
        runner = self._runner_factory(wf, f"orch_{session_id}")
        await _ensure_session(runner, f"orch_{session_id}", user_id, session_id)
        # Keep the pending interrupt set while resuming so a correction that
        # arrives mid-resume is still routed as the answer (last-answer-wins). It
        # is cleared only when the turn finishes (set_session_status clears it, or
        # _finalize re-blocks with a new interrupt).

        # STEP 9 (resume) — always a resume_part, even for a dynamic step
        # resolved out-of-band above. A generic "continue" trigger (like
        # continue_turn's) was tried here and reverted: confirmed live, it
        # makes ADK treat the whole run as a fresh turn rather than a
        # continuation, so a rerun_on_resume caller (e.g. the persona step
        # that spawned the dynamic step) redoes its ENTIRE reasoning from
        # scratch — including sending a second real email. resume_part, by
        # contrast, still resolves to a real prior invocation (the interrupt
        # id came from an actual earlier request_input event, just at a node
        # path this turn's rebuild can't reproduce for THIS step) and lets
        # ADK correctly replay everything already-recorded, including the
        # caller, without re-invoking it — confirmed against sessions
        # ceacc30ae21e4ce99d4ddbe5119f67f7/aaebd35d3c0645d39de4679dfaa8f991/
        # e27897853e834bef8a270db6d95e73dd (persona replayed twice, duplicate
        # await_reply, under the "continue" version). The out-of-band step's
        # OWN resolution above (already marked completed with the real
        # answer) is what matters — the node this id would have targeted
        # never gets rebuilt as a real await_reply node this turn at all
        # (see nodes.py's is_dynamic_delegate short-circuit), so it doesn't
        # matter that this exact id can't match anything current.
        logger.info("[worky] 9. Runner.run_async → resuming session=%s interrupt=%s%s",
                    session_id, interrupt_id, " (out-of-band dynamic step)" if resumed_out_of_band else "")
        interrupt = await self._drive_until_quiescent(
            runner, session_id, user_id, plan, name_to_step,
            types.Content(role="user", parts=[hitl.resume_part(interrupt_id, {"value": answer})]),
            model=model, connectors=connectors, executor_prompt=executor_prompt)

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

        # Plain "continue" message → ADK re-runs the graph, so replay completed
        # steps from their stored result instead of re-executing them.
        wf, name_to_step = self._build_workflow(session_id, user_id, plan, model,
                                                connectors, executor_prompt, replay_completed=True)
        runner = self._runner_factory(wf, f"orch_{session_id}")
        await _ensure_session(runner, f"orch_{session_id}", user_id, session_id)
        await self._project(self._rm.set_session_status(session_id, "running"))  # paused -> running

        logger.info("[worky] 9. Runner.run_async → continuing paused plan session=%s", session_id)
        # A benign message: completed nodes replay and won't re-run, so its text
        # is irrelevant; the graph engine just proceeds with the pending steps.
        interrupt = await self._drive_until_quiescent(
            runner, session_id, user_id, plan, name_to_step,
            types.Content(role="user", parts=[types.Part(text="continue")]),
            model=model, connectors=connectors, executor_prompt=executor_prompt)
        await self._finalize(session_id, plan, interrupt)
        return plan

    async def _drive_until_quiescent(self, runner, session_id, user_id, plan, name_to_step,
                                     new_message, *, model, connectors, executor_prompt):
        """Drive the workflow, then keep driving while it keeps growing.

        The graph is built from plan.steps at the START of a turn, so a step
        another step spawns mid-turn (delegate_to_human_agent,
        create_task(kind='execute')) is not in it and cannot run this time
        round. Only a later turn, rebuilt from the grown plan, executes it.

        For await_reply that later turn is guaranteed — the incoming mail
        reply triggers it. Nothing triggers one for a delegate, so without
        this the step was created and then orphaned: seen live, session
        6f5b45c30e42 finished 'completed' with its "ask Firas Kahia" step
        still PENDING and never run.

        So: rebuild and run again while the last pass left runnable work
        behind. Each pass replays already-completed steps from their recorded
        events (exactly as a resume does) and executes only what is new.
        Bounded by progress — if a pass runs nothing, stop rather than spin —
        and by MAX_PLAN_STEPS, which caps how far a plan can grow at all.
        """
        # Expose the live plan so converse_turn can append steps mid-flight; the
        # loop below already re-runs any PENDING step that appears after a pass.
        self._active[session_id] = plan
        try:
            return await self._drive_loop(runner, session_id, user_id, plan, name_to_step,
                                          new_message, model=model, connectors=connectors,
                                          executor_prompt=executor_prompt)
        finally:
            if self._active.get(session_id) is plan:
                self._active.pop(session_id, None)

    async def _drive_loop(self, runner, session_id, user_id, plan, name_to_step,
                          new_message, *, model, connectors, executor_prompt):
        in_graph = {s.id for s in plan.steps}
        interrupts = await self._drive(
            runner, session_id, user_id, plan, name_to_step, new_message)
        # A parked interrupt means the turn is legitimately over: the plan is
        # waiting on a human, not on us.
        while not interrupts:
            # Only steps that did not exist when this graph was built. A step
            # left pending for any other reason (its dependency errored, say)
            # would not run on a rebuild either, so re-driving for it just
            # burns a pass.
            spawned = {s.id for s in plan.steps
                       if s.status == Status.PENDING and s.id not in in_graph}
            if not spawned:
                return interrupts
            logger.info("[worky] 9b. %d step(s) spawned mid-turn — continuing session=%s %s",
                        len(spawned), session_id, [s[:12] for s in spawned])
            in_graph = {s.id for s in plan.steps}
            # replay_completed: this re-drive passes the same plain new_message, so
            # ADK re-runs the whole graph — rebuild completed steps as their stored
            # result so only the spawned/pending steps actually execute.
            wf, name_to_step = self._build_workflow(
                session_id, user_id, plan, model, connectors, executor_prompt,
                replay_completed=True)
            runner = self._runner_factory(wf, f"orch_{session_id}")
            await _ensure_session(runner, f"orch_{session_id}", user_id, session_id)
            interrupts = await self._drive(
                runner, session_id, user_id, plan, name_to_step, new_message)
            if spawned & {s.id for s in plan.steps if s.status == Status.PENDING}:
                # The pass that was supposed to run them left them pending —
                # running again would only repeat itself.
                logger.warning("[worky] 9b. spawned step(s) still pending after a "
                               "continuation pass — stopping session=%s", session_id)
                return interrupts
        return interrupts

    async def _drive(self, runner, session_id, user_id, plan, name_to_step, new_message):
        """Run the workflow, project step statuses, and capture every
        ask-the-user interrupt this run raised as [(interrupt_id, step_id), ...].

        A wave can park several steps at once (each asks its own question), and
        each is resumable on its own — so collect them all, not just the first.
        """
        started: set = set()
        interrupts: List[Tuple[str, Optional[str]]] = []
        seen: set = set()
        # DIAGNOSTIC: what SHOULD replay (already terminal) vs run (pending) this
        # pass. Cross-reference with the "⚡ REAL MODEL CALL" lines: a completed
        # step here that also logs a real model call was re-executed, not replayed.
        by_status: dict = {}
        for s in plan.steps:
            by_status.setdefault(s.status.value, []).append(s.id[:8])
        logger.info("[worky] 9. drive pass session=%s statuses=%s", session_id, by_status)
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
                         planner_prompt: Optional[str] = None,
                         plan_session: Optional[str] = None,
                         requester: Optional[dict] = None) -> Plan:
        # The planner's ADK session accumulates history across calls. The main
        # flow shares one ("<id>_plan") on purpose, so the planner keeps context
        # across a user's turns. converse passes an EPHEMERAL session instead:
        # otherwise an amend like "also search Ethereum" would see the earlier
        # "search Bitcoin" in history and re-plan BOTH, and _inject_steps would
        # append a duplicate of the step already running.
        plan_session = plan_session or (session_id + "_plan")
        planner = LlmAgent(
            name="planner",
            model=self._build_planner_model(planner_model),
            # The DB prompt (agentstore) is the source of truth: it REPLACES the
            # instruction rather than stacking on it. PLANNER_INSTRUCTION is only
            # a fallback when the DB has none. Concatenating the two made the
            # planner read the whole prompt twice -- once from the DB, once from
            # this hardcoded copy (whose {{ }} JSON examples reached the model as
            # invalid doubled braces). Same replace-semantics the executor uses.
            instruction=(planner_prompt or PLANNER_INSTRUCTION),
            tools=[human_agents.make_find_human_agents_tool()],
            output_schema=_PlannerOutput,
        )
        runner = self._runner_factory(planner, f"planner_{session_id}")
        await _ensure_session(runner, f"planner_{session_id}", user_id, plan_session)
        # Tell the planner who it is planning for, so it addresses the requester
        # directly and never assigns work or emails back to them. Kept as a
        # per-turn preamble on the message (not the DB instruction) so it works
        # whatever prompt the agentstore supplies.
        ctx = requester_context(requester)
        planner_message = f"{ctx}\n\n---\nUser's request:\n{message}" if ctx else message
        text = ""
        async for ev in runner.run_async(
            user_id=user_id, session_id=plan_session,
            new_message=types.Content(role="user", parts=[types.Part(text=planner_message)])):
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
                    answer=data.get("answer") or None, steps=steps,
                    ops=[dict(o) for o in data.get("ops", []) if o.get("step_id")])

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
        # This plan supersedes any prior waits, so drop them first, then mint for
        # every await_reply step. (A mid-run amend uses _mint_mail_waits directly
        # so it does NOT cancel the running plan's live waits.)
        await self._project(self._rm.cancel_mail_waits(session_id))
        await self._mint_mail_waits(session_id, user_id, plan.steps)

    async def _mint_mail_waits(self, session_id: str, user_id: str, steps: List[Step]) -> None:
        """Register a routing token for each await_reply step in `steps` — without
        cancelling any existing wait. Shared by _register_mail_waits (whole plan,
        after a cancel) and _inject_steps (amend-added steps only)."""
        if self._rm is None:
            return
        awaiting = [s for s in steps if s.kind == "await_reply"]
        if not awaiting:
            return
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
        # A step the user cancelled mid-run (converse amend) still gets scheduled
        # and emits a no-op event (_skip_if_cancelled short-circuits its model
        # call). Ignore those events so its status stays CANCELLED instead of
        # being flipped back to running/completed here.
        if step is not None and step.status == Status.CANCELLED:
            return
        # Which step called which tool, with what args — logged here (not at the
        # MCP call site) because that log line carries no step id, and during a
        # parallel wave several steps' calls interleave: log order alone cannot
        # tell you which step made a given call. This can.
        for part in (ev.content.parts if ev.content else []):
            fc = getattr(part, "function_call", None)
            if fc is not None:
                logger.info("[worky] 9. step=%s tool_call name=%s args=%s",
                            step_id, fc.name, dict(fc.args or {}))
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
            # DIAGNOSTIC: a step that was already terminal re-entering means ADK
            # emitted events for it again this pass. On its own that can be a
            # benign replay; pair it with the "⚡ REAL MODEL CALL" line for the
            # same node to tell replay (no model call) from a true re-run.
            if step.status.is_terminal():
                logger.warning("[worky] 9. ⟲ completed step re-entered session=%s step=%s "
                               "(was %s) — replay unless it also logs a REAL MODEL CALL",
                               session_id, step_id, step.status.value)
            step.status = Status.RUNNING
            logger.info("[worky] 9. step running session=%s step=%s wave=%d",
                        session_id, step_id, step.wave)
            await self._project(self._rm and self._rm.set_step_status(
                session_id, step_id, "running"))
        if is_output:
            step.status = Status.COMPLETED
            # Keep the LAST text part, not the first. A reasoning model emits its
            # thinking as an earlier part and the actual answer as a later one, so
            # parts[0] stored the deliberation as the step's result — which then
            # became the next step's context. Seen live in session
            # 3c6f49bdf4a7445c8f00f6bf57b1405c, where the result read "The user
            # says \"run the plan.\" My task instruction is..." instead of the
            # answer. Same loop the planner path already uses.
            text = ""
            if ev.content and ev.content.parts:
                for part in ev.content.parts:
                    if getattr(part, "text", None):
                        text = part.text
            step.result = text
            logger.info("[worky] 9. step completed session=%s step=%s (%d chars)",
                        session_id, step_id, len(text))
            await self._project(self._rm and self._rm.set_step_status(
                session_id, step_id, "completed", result=text))
