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
from contextvars import ContextVar
import json
import logging
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Optional, Tuple

active_turn_id: ContextVar[Optional[str]] = ContextVar("worky_active_turn_id", default=None)

from google.adk.agents import LlmAgent
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
    new: str = ""                                         # insert_before: the new gate step's id
    depends_on: List[str] = Field(default_factory=list)   # reparent: the step's new dependencies


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
  a REAL external person (anyone human-agents_search_human_agents does not find — see below) —
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
  NEVER use it for a human agent found via human-agents_search_human_agents — see below,
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
"someone in support"), you MUST call human-agents_search_human_agents(name=...) and/or
human-agents_search_human_agents(role=...) to check whether they are a human agent — never
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
human-agents_search_human_agents first, and if she's a match, delegate to her, full stop.
Do not also try a connector's send_email/send_teams_message tool "just in
case" — if human-agents_search_human_agents found her, that IS the entire interaction, and
if it found no one, then and only then does an ordinary step / connector
send make sense.

When human-agents_search_human_agents finds a match, that's ONE "execute" step: set
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
If human-agents_search_human_agents finds no match, treat it as an ordinary step (or, if the
user clearly means to email a real external person by address, use the
normal execute + await_reply pattern above).

Example — "search bitcoin news, then send it to Rabeb and ask if we should
invest today" — human-agents_search_human_agents(name="Rabeb") found her, so this is
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
literal message to compose, instead of checking human-agents_search_human_agents first.

Example — "email x asking which company she works for, then report on it":
{{"title": "Company report", "goal": "Report on the company x works for", "answer": "Sure — I'll email x, wait for her reply, then research the company.",
  "steps": [
    {{"id": "s1", "kind": "execute", "title": "Email x", "description": "Send an email to x@example.com asking which company she works for.", "depends_on": []}},
    {{"id": "s2", "kind": "await_reply", "title": "Await her reply", "question": "Awaiting a reply from x@example.com naming her company", "description": "", "depends_on": ["s1"]}},
    {{"id": "s3", "kind": "execute", "title": "Research the company", "description": "Research the company named in the reply and write a short report.", "depends_on": ["s2"]}}
  ]}}"""


# Appended to the planner message on the schema-less fallback pass (see
# _make_plan). output_schema makes the PROVIDER enforce JSON; without it the
# only thing keeping the model honest is the prompt, so restate the contract
# plainly. Not a template — appended to the message, so single braces are fine.
_PLANNER_JSON_REMINDER = (
    "Respond with ONLY a single strict JSON object — no prose, no markdown "
    "fences. Shape: "
    '{"title": "", "goal": "", "answer": "<one short reply to the user>", '
    '"steps": [{"id": "s1", "kind": "execute", "title": "<short label>", '
    '"description": "<full instruction>", "depends_on": []}]}. '
    'For chit-chat, use an empty "steps" list and put your reply in "answer". '
    "Every step id is unique, every depends_on entry names another step, and "
    "the graph has no cycles."
)


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
            is_dynamic_delegate=bool(row.get("is_dynamic_delegate")),
            interrupt_id=row.get("interrupt_id")))
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


_APPROVE_WORDS = ("approve", "approuver", "yes", "oui")


def _parse_verdict(answer: str):
    """A confirm answer → (confirmed, edits). Plain text is the verdict; an
    edit-on-card approval is JSON {"verdict": "approve", "edits": {...}} whose
    edits become the ToolConfirmation payload (only kept when confirmed)."""
    a = (answer or "").strip()
    if a.startswith("{"):
        try:
            d = json.loads(a)
            confirmed = str(d.get("verdict", "")).strip().lower() in _APPROVE_WORDS
            edits = d.get("edits") if isinstance(d.get("edits"), dict) and d.get("edits") else None
            return confirmed, (edits if confirmed else None)
        except (ValueError, TypeError):
            pass
    return a.lower() in _APPROVE_WORDS, None


def _answer_target(answer: str) -> Optional[str]:
    """The specific interrupt id an approval is FOR, if the card sent one.

    With several confirm gates open at once the session-level interrupt id is a
    single value, so every plain 'approve' resolved whichever gate it happened to
    point at — a second card's approval then hit the FIRST card's gate (seen live:
    session 33dfebfa, Firas's approval applied to Rabeb's send and Firas's own
    gate left unanswered). The card carries its own questionId; when the approval
    JSON echoes it we target THAT gate instead of the session default. Only a
    confirm id is honoured — an ask/mail id or none falls back to the old
    behaviour."""
    a = (answer or "").strip()
    if not a.startswith("{"):
        return None
    try:
        qid = json.loads(a).get("questionId")
    except (ValueError, TypeError):
        return None
    return qid if isinstance(qid, str) and qid.startswith(f"{hitl.CONFIRM}::") else None


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
        f"for this, and they are ALREADY in this conversation. Address them directly. "
        f"NEVER create a step or call a tool that sends them a message on ANY channel "
        f"(Teams, email, etc.) or delegates/assigns a task to them: they are not a "
        f"colleague to hand work to, and messaging the requester on Teams/email is "
        f"invalid — it tries to open a chat with the account itself and fails. To ASK "
        f"them something, use an 'ask' step. To TELL them a result — or relay someone "
        f"else's reply back to them — put it in your own reply/step result; never send "
        f"it to them as a Teams or email message."
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

        def wrap(t, token_provider, mail_on_sent, teams_on_sent):
            # A send step carries the token/chat of the reply its await sibling
            # waits on. Mail stamps the token into the message; Teams stamps
            # nothing (the chat id, learned from the send result, is the
            # correlation). Every other tool passes through untouched.
            if nodes.is_send_email_tool(t):
                return nodes.stamp_send_email_tool(t, token_provider=token_provider,
                                                   on_sent=mail_on_sent)
            if nodes.is_send_teams_tool(t):
                return nodes.record_send_teams_tool(t, token_provider=token_provider,
                                                    on_sent=teams_on_sent)
            return t

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
                # Teams: bind the wait to the chat the message was sent in; the
                # chat membership is the trust boundary, so there is no recipient
                # list to record.
                async def on_sent_teams(token, chat_id):
                    await rm.bind_teams_wait_target(token, chat_id)
                return [wrap(t, token_provider, on_sent, on_sent_teams) for t in tools]
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

            async def eager_on_sent_teams(token, chat_id, _pending_id=pending_id):
                expires_at = datetime.now(timezone.utc) + timedelta(
                    hours=self._mail_wait_timeout_hours)
                await rm.register_mail_wait(
                    token, session_id=session_id, step_id=_pending_id,
                    user_id=user_id, conversation_id=chat_id, expires_at=expires_at)
            return [wrap(t, eager_token_provider, eager_on_sent, eager_on_sent_teams)
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
                return (f"Unknown agent {agent_name!r} — no match via human-agents_search_human_agents. "
                        "Call human-agents_search_human_agents first to discover who actually exists.")
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
                       # Never delay a step a PLANNED await_reply depends on — it
                       # is that await's SEND; delaying it inverts send->await and
                       # deadlocks the await (see create_task block below).
                       and not any(s.kind == "await_reply" and o.id in s.depends_on
                                   for s in plan.steps)
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
                    "for it and never guess what they will say. Use human-agents_search_human_agents "
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
                            # An ask card shows `question`; a dynamic ask has none
                            # unless we set it, so the card fell back to the 60-char
                            # truncated title. The description IS the question here.
                            question=description if kind == "ask" else None,
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
                        # Idempotent re-run: if this caller already has a bound
                        # await_reply (a prior create_task, whose rebind consumed
                        # the eager token), don't refuse — the wait already exists.
                        for existing in plan.steps:
                            if (existing is not sub_step and existing.kind == "await_reply"
                                    and caller_step_id in existing.depends_on
                                    and await self._rm.mail_token_for(session_id, existing.id)):
                                plan.steps.remove(sub_step)
                                logger.info(
                                    "[worky] create_task await_reply idempotent — caller %s "
                                    "already has bound wait %s (session=%s)",
                                    caller_step_id, existing.id, session_id)
                                return (
                                    "A reply-wait for this step's email is ALREADY registered — "
                                    "the email was sent and the plan is already waiting for the "
                                    "reply. Do not send another email or register another wait; "
                                    "end your step.")
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
                       # A step a PLANNED await_reply depends on is the SEND for
                       # that await; delaying it behind this spawn inverts
                       # send->await and parks the await before the send runs
                       # (deadlock, session 40465b3f). Don't re-parent it.
                       and not any(s.kind == "await_reply" and o.id in s.depends_on
                                   for s in plan.steps)
                       and o.status == Status.PENDING]
            # Re-parent each caller-dependent onto the spawned chain's TAIL — the
            # "act on reply" step that reads the reply — not the raw await. Hung on
            # the await, a pre-planned dependent (e.g. the N2 step) runs in PARALLEL
            # with the act instead of AFTER it. tail == the await when there is no
            # followup. Only steps that ALREADY depended on the caller are in
            # `affected`, so unrelated parallel steps stay parallel, and several
            # dependents each just wait on the tail (still parallel to one another).
            tail = followup_step.id if followup_step is not None else sub_step.id
            for other in affected:
                other.depends_on.append(tail)
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

            # await_reply is NOT run nested. It used to run here via
            # tool_context.run_node in an isolation sub-branch, but that nested
            # branch is what diverges ADK's replay barrier on a later resume —
            # reproduced: the same plan growth over a TOP-LEVEL await does not
            # diverge, a nested one does. So leave it PENDING as a top-level
            # step; _drive_loop runs it on this turn's rebuild as a real graph
            # node (the exact replay-safe shape a planner-emitted await_reply
            # uses), where it parks and _finalize binds its mail wait. The
            # caller completes normally when its turn ends — no BLOCKED/RUNNING
            # dance, which also removes the phantom-running the finally caused.
            if kind == "await_reply":
                return ("Await-reply step created. A separate follow-up step will "
                        "read the reply and give the real answer once it arrives — "
                        "end your own turn now reporting the draft as sent and "
                        "awaiting reply, and do not guess what they will decide.")
            # 'ask' still runs its WAIT node HERE: it is answered in-chat on the
            # same turn's flow and is not subject to the mail-reply rebuild path.
            # One shot, no LLM loop, so it parks and registers its interrupt now.
            if kind == "ask":
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

    def _mark_step_running(self, session_id: str):
        """Project a step RUNNING when its request is sent to the model (see
        nodes._mark_running), so the UI shows it in-progress at once instead of
        lagging on 'pending' until ADK returns the first event."""
        async def _on_start(step: Step) -> None:
            await self._project(self._rm and self._rm.set_step_status(
                session_id, step.id, Status.RUNNING.value))
        return _on_start

    def _project_step_tool_activity(self, session_id: str):
        """Project one tool call as a plan_step_component (see
        nodes._project_tool_activity), so the task drawer shows the step's tool
        trace as an activity card."""
        async def _on_tool(step: Step, component_id: str, ordinal: int,
                           type: str, data: dict) -> None:
            await self._project(self._rm and self._rm.add_step_component(
                session_id, step.id, component_id, type, data, ordinal))
        return _on_tool

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
                "human-agents_search_human_agents + delegate_to_human_agent for a named "
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
            context_for_step=self._dep_results_context(plan),
            gate_for_step=self._unmet_deps(plan),
            custom_instruction=executor_prompt,
            replay_completed=replay_completed,
            on_model_start=self._mark_step_running(session_id),
            on_tool_activity=self._project_step_tool_activity(session_id))
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
        if not content or self._rm is None:
            return
        # Terminal chat projection is the UI completion signal. Let failures
        # reach the servicer so it can attempt a correlated failure outcome.
        await self._rm.add_message(
            uuid.uuid4().hex, session_id, role, content, active_turn_id.get())

    async def _add_error_message(self, session_id: str, content: str,
                                 title: str = "This task couldn't be completed") -> None:
        """Surface a failure in the chat as an ERROR — an assistant message
        carrying an `error` message-component ({title, content}), the same shape
        the main chat module uses, so the client renders a destructive card
        instead of a normal reply. The plain-text content is kept on the message
        too, for consumers that don't read components (voice)."""
        if not content:
            return
        msg_id = uuid.uuid4().hex
        await self._project(self._rm and self._rm.add_message(
            msg_id, session_id, "assistant", content))
        await self._project(self._rm and self._rm.add_message_component(
            session_id, msg_id, uuid.uuid4().hex, "error",
            {"title": title, "content": content}))

    async def _project_approval_choice(self, session_id: str, interrupt_id: str,
                                       preview: dict) -> None:
        """Surface a gated send (require_confirmation) as an approve/decline card.

        Reuses the `choice` component the chat module already renders (a
        present_choices payload) rather than a bespoke widget: two options whose
        submitText is the verdict. Selecting one sends that verdict as a normal
        chat message; the session is `waiting` on this interrupt, so RunTask
        routes it to resume_turn, which maps `approve` → confirmed (see there).
        `preview` is the drafted call: for a mail, to/subject/body; else a
        message/args blob."""
        raw = preview.get("args") or {}
        # Connector tools wrap the real arguments under `params` and add a
        # `display_purpose` sibling (see smart_rag/tools/utilities/connector_tools.py).
        # Unwrap it, or the card can't find subject/body/message and falls back to
        # dumping the raw JSON blob at the owner.
        args = raw["params"] if isinstance(raw.get("params"), dict) else raw

        def _recipients(a: dict) -> str:
            v = (a.get("to") or a.get("to_recipients") or a.get("recipient")
                 or a.get("user_email") or "")
            # A Teams *channel* send has no user recipient (team_id + channel_id
            # instead of user_email), so the card used to render "À : —". Label the
            # channel so the recipient is never blank.
            if not v and (a.get("channel_id") or a.get("team_id")):
                return f"Canal Teams ({a.get('channel_id') or a.get('team_id')})"
            return ", ".join(str(x) for x in v) if isinstance(v, list) else str(v)

        # Editable fields (edit-on-card): keyed by the connector schema names so a
        # submitted edit merges straight into the send. The frontend renders these
        # as inputs; approve returns {"verdict":"approve","edits":{key:value}}.
        fields = []
        if "subject" in args or "body" in args:
            title = "Approuver l'envoi de cet e-mail ?"
            draft = (f"À : {_recipients(args) or '?'}\n"
                     f"Objet : {args.get('subject', '')}\n\n{args.get('body', '')}")
            fields = [
                {"key": "to_recipients", "label": "À", "value": _recipients(args), "type": "list"},
                {"key": "subject", "label": "Objet", "value": args.get("subject", "")},
                {"key": "body", "label": "Message", "value": args.get("body", ""),
                 "multiline": True, "markdown": True},
            ]
        elif "message" in args:
            title = "Approuver l'envoi de ce message ?"
            to = _recipients(args)
            draft = (f"À : {to}\n\n" if to else "") + str(args.get("message", ""))
            fields = [
                {"key": "user_email", "label": "À", "value": to},
                {"key": "message", "label": "Message", "value": args.get("message", ""), "multiline": True},
            ]
        else:
            title = "Approuver l'envoi de ce message ?"
            draft = json.dumps(args, ensure_ascii=False)
        data = {
            "schemaVersion": 1, "status": "ready",
            "questionId": interrupt_id[:100],
            "prompt": title,
            "description": (draft or "")[:1500],
            "presentation": "quick_replies", "selectionMode": "single",
            "submitBehavior": "immediate",
            "options": [
                {"id": "approve", "label": "Approuver", "submitText": "approve"},
                {"id": "decline", "label": "Refuser", "submitText": "decline"},
            ],
            "fallbackText": title,
        }
        if fields:
            # Signals the chat UI to render the draft as editable inputs and,
            # on approve, submit {"verdict":"approve","edits":{...}}.
            data["editable"] = True
            data["fields"] = fields
        msg_id = uuid.uuid4().hex
        await self._project(self._rm and self._rm.add_message(msg_id, session_id, "assistant", title))
        await self._project(self._rm and self._rm.add_message_component(
            session_id, msg_id, uuid.uuid4().hex, "choice", data))

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
                        planner_connectors: Optional[List[dict]] = None,
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
                                     planner_connectors=planner_connectors,
                                     requester=requester)
        logger.info("[worky] 5. planner LLM → Plan session=%s title=%r steps=%d",
                    session_id, plan.title, len(plan.steps))
        # A genuine direct reply (CASE A) has an ANSWER. Zero steps AND an empty
        # answer is a broken/empty planner response, not chit-chat — seen live:
        # glm-5.3-go returned {steps:[], answer:"", ops:[{op:"human-agents_search_human_agents"}]}
        # for "search solana and email Imed", so the turn silently 'completed'
        # having done and said nothing. Retry the planner once on a fresh session
        # (a flaky planner often succeeds on the second try); if it's STILL empty,
        # tell the user rather than posting an empty reply.
        if not plan.steps and not (plan.answer or "").strip():
            logger.warning("[worky] 5. empty plan (0 steps, no answer) — retrying planner once session=%s",
                           session_id)
            plan = await self._make_plan(
                session_id, user_id, message,
                planner_model=planner_model, planner_prompt=planner_prompt,
                planner_connectors=planner_connectors,
                plan_session=f"{session_id}_plan_retry_{uuid.uuid4().hex[:6]}",
                requester=requester)
            logger.info("[worky] 5. planner retry → steps=%d answer=%s",
                        len(plan.steps), bool((plan.answer or "").strip()))
        if not plan.steps:
            answer = (plan.answer or "").strip()
            if answer:
                # A genuine direct reply (CASE A): it has an answer — complete.
                logger.info("[worky] 5. direct reply (no plan) → session=%s completed", session_id)
                await self._add_message(session_id, "assistant", answer)
                await self._project(self._rm and self._rm.set_session_status(session_id, "completed"))
            else:
                # Still empty after the retry — the planner failed to produce a plan
                # (0 steps, no answer). FAIL the turn with the cause instead of
                # silently 'completing' on nothing, so the client sees a real error.
                reason = ("Échec de la planification : le planificateur n'a produit aucun "
                          "plan (0 étape, réponse vide), même après une nouvelle tentative "
                          "— impossible de traiter cette demande.")
                logger.warning("[worky] 5. empty plan after retry → session=%s FAILED (%s)",
                               session_id, reason)
                await self._add_error_message(session_id, reason,
                                              title="Échec de la planification")
                await self._project(self._rm and self._rm.set_session_status(session_id, "failed"))
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
                            planner_connectors: Optional[List[dict]] = None,
                            requester: Optional[dict] = None,
                            # Accepted for signature parity with the LangGraph engine
                            # (LgService.converse_turn drives amend-added steps itself);
                            # the ADK drive loop already carries these, so unused here.
                            connectors: Optional[List[dict]] = None,
                            executor_prompt: Optional[str] = None,
                            model: Optional[str] = None) -> Plan:
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
            # Context = the in-memory plan while executing, else the read-model
            # snapshot when the plan is PARKED (blocked/waiting). Either way the
            # planner sees the plan, every result, AND the questions awaiting the
            # user — so it can answer status/results and mention what's pending,
            # even when nothing is actively driving.
            snap = await self._rm.snapshot(session_id) if self._rm else None
            ctx_plan = live if live is not None else (_plan_from_snapshot(snap) if snap else None)
            if ctx_plan is not None:
                amend_message = self._amend_message(ctx_plan, message) + self._pending_note(snap)
            else:
                amend_message = message
            plan = await self._make_plan(
                session_id, user_id, amend_message,
                planner_model=planner_model, planner_prompt=planner_prompt,
                planner_connectors=planner_connectors,
                plan_session=f"{session_id}_conv_{uuid.uuid4().hex[:8]}",
                requester=requester)
            live = self._active.get(session_id)  # re-check: may have finished while planning
            logger.info("[worky] converse ◄ session=%s steps=%d ops=%d live=%s",
                        session_id, len(plan.steps), len(plan.ops), live is not None)
            # target = the still-executing plan if any, else the parked snapshot
            # plan (amends there persist and run on the next resume/drive).
            target = live if live is not None else ctx_plan
            if not plan.steps and not plan.ops:
                # CASE A — a direct reply (status/results/pending). Plan untouched.
                await self._add_message(session_id, "assistant", plan.answer or "")
            elif target is not None:
                # Ops (cancel/modify existing pending steps) first, then new steps.
                op_notes = await self._apply_ops(session_id, target, plan.ops)
                # Grab titles BEFORE injecting (ids/deps are rewritten in place, but
                # titles are stable) so the reply names what was added.
                titles = [s.title or (s.description[:50] + "…" if len(s.description) > 50
                                      else s.description) for s in plan.steps]
                n = await self._inject_steps(session_id, user_id, target, plan.steps)
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
                # Parked plans aren't being driven right now — the new steps run when
                # the plan resumes (a reply lands / a card is answered).
                if live is None and (plan.steps or plan.ops):
                    reply += " (le plan est en attente — ceci s'exécutera à sa reprise)"
                await self._add_message(session_id, "assistant", reply)
            else:
                # No plan at all — nothing to amend. Don't silently drop the request.
                await self._add_message(
                    session_id, "assistant",
                    "The plan just finished — send that again and I'll start it fresh.")
        return plan

    @staticmethod
    def _pending_note(snap: Optional[dict]) -> str:
        """A trailing block naming the questions awaiting the user (parked asks +
        gated steps), so the planner can tell the user what's pending. The user
        answers these in their CARDS, not in this chat — so never treat them as
        answered here."""
        steps = (snap or {}).get("steps") or []
        pending = [s for s in steps
                   if s.get("interrupt_id")
                   or (s.get("kind") == "ask" and s.get("status") in ("blocked", "waiting"))]
        if not pending:
            return ""
        lines = "\n".join(f"- {s.get('question') or s.get('title') or s.get('step_id')}"
                          for s in pending)
        return ("\n\nQUESTIONS EN ATTENTE de la réponse de l'utilisateur (il y répond dans "
                "les cartes de l'interface, PAS dans le chat) :\n" + lines)

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
            deps = ", ".join(s.depends_on) if s.depends_on else "—"
            lines.append(f"[{s.id}] {label}  (status={s.status.value}; kind={s.kind}; "
                         f"after=[{deps}])")
            if s.result:
                lines.append(f"    result: {s.result}")
        context = "\n".join(lines)
        return (
            "You are AMENDING a plan that is ALREADY RUNNING for the user. Below is "
            "the FULL current plan — every step with its status, kind, and its "
            "dependencies, where after=[...] lists the step ids it runs AFTER. Steps "
            "that show a result are DONE; never recreate or restate them.\n\n"
            f"--- running plan ---\n{context}\n--- end plan ---\n\n"
            "READ the structure above and decide WHERE the user's change belongs in "
            "it, then return only the delta (new `steps` and/or `ops`). Placement:\n"
            "- ADD work: return the new step(s). To run a new step AFTER an existing "
            "one, set its \"depends_on\" to that step's [id]. If a new step needs an "
            "existing result, paste that result into its description (the executor "
            "can't see other steps).\n"
            "- Run a new step BEFORE an existing PENDING step — i.e. gate/precede it "
            "('ask me before X', 'check before the update', 'validate before sending', "
            "'... avant X') — put the new step in `steps` AND add {\"op\": "
            "\"insert_before\", \"step_id\": \"<the existing step's id>\", \"new\": "
            "\"<the new step's id>\"}. The existing step will then wait for your new "
            "step, and the new step automatically inherits that step's current "
            "after=[...] (so any gate already before it stays intact). This is the "
            "ONLY correct way to insert before a step — do NOT just add a standalone "
            "step (it would run in parallel, not before), and do NOT cancel+recreate "
            "it (that drops its dependencies).\n"
            "- CHANGE a pending step in place: {\"op\": \"cancel\", \"step_id\": "
            "\"<id>\"} to drop it; {\"op\": \"modify\", \"step_id\": \"<id>\", "
            "\"description\": \"<new full instruction>\"} to reword it; {\"op\": "
            "\"reparent\", \"step_id\": \"<id>\", \"depends_on\": [\"<ids>\"]} to "
            "change what it waits on.\n"
            "Only a PENDING step can be changed or gated — a running/completed one has "
            "already started, so amend it by adding a follow-up step instead. Combine "
            "`ops` and new `steps` freely. Give a short, friendly `answer`.\n\n"
            f"USER MESSAGE: {message}")

    async def _inject_steps(self, session_id: str, user_id: str, live: Plan, new_steps: List[Step],
                            id_map_out: Optional[dict] = None) -> int:
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
        if len({s.id for s in new_steps}) != len(new_steps):
            raise ValueError("plan has duplicate step ids")
        # The amend planner is shown the running plan WITH real step ids (see
        # _amend_message), so a dep it names on a LIVE step is its placement
        # decision — honor it ("email the summary" -> after the summary step),
        # not just in-batch deps. Placement is the planner's, not the frontier's.
        live_ids = {s.id for s in live.steps}
        # Fallback for a step the planner left independent (depends_on: []): hang
        # it off leaves that are already COMPLETED or RUNNING — a fresh later wave
        # that won't re-run a started step (seen live: adding "search Ethereum"
        # re-ran the finished Bitcoin step) — but NEVER off a BLOCKED or PENDING
        # leaf (an open await, or work sitting behind one), so "also ask Imed" runs
        # in PARALLEL with Adem's blocked reply instead of stranded behind it
        # (session c7b084e1). Empty (nothing started) is safe: no wave to disturb.
        anchor_frontier = [s.id for s in live.steps
                           if s.status in (Status.COMPLETED, Status.RUNNING)
                           and not any(s.id in o.depends_on for o in live.steps)]
        id_map = {s.id: uuid.uuid4().hex[:12] for s in new_steps}
        if id_map_out is not None:            # let converse resolve new ids for its ops
            id_map_out.update(id_map)
        for s in new_steps:
            s.id = id_map[s.id]
            # Keep in-batch deps (remapped) AND planner-named live-plan deps; only
            # a step with no valid dep at all falls back to the anchor frontier.
            kept = [id_map[d] if d in id_map else d
                    for d in s.depends_on if d in id_map or d in live_ids]
            s.depends_on = kept or list(anchor_frontier)
            s.status = Status.PENDING
            if not s.is_persona:
                s.assignee = live.executor_id
                s.assignee_name = live.executor_name or DEFAULT_EXECUTOR_LABEL
        scheduler.validate(Plan(steps=[*live.steps, *new_steps]))
        live.steps.extend(new_steps)
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

    async def _apply_ops(self, session_id: str, live: Plan, ops: List[dict],
                         id_map: Optional[dict] = None) -> List[str]:
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
            elif kind == "insert_before":
                # Blocking insert (mirrors the executor's _spawn_ops): put a NEW
                # step before this pending one — the gate inherits THIS step's
                # current deps, and this step now waits on the gate. Preserves the
                # existing chain (e.g. an approval gate stays), unlike cancel+recreate.
                imap = id_map or {}
                gate_id = imap.get(op.get("new", ""), op.get("new", ""))
                gate = live.step(gate_id)
                if gate is None:
                    notes.append(f"couldn't gate '{label}' — new step not found")
                    continue
                gate.depends_on = list(step.depends_on)
                step.depends_on = [gate_id]
                await self._project_step(session_id, live, gate)
                await self._project_step(session_id, live, step)
                notes.append(f"inserted '{gate.title or gate.id}' before '{label}'")
            elif kind == "reparent":
                imap = id_map or {}
                new_deps = []
                for d in (op.get("depends_on") or []):
                    rd = imap.get(d, d)
                    if rd != step.id and live.step(rd) is not None:
                        new_deps.append(rd)
                step.depends_on = new_deps
                await self._project_step(session_id, live, step)
                notes.append(f"re-pointed '{label}'")
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
        # A confirm card's questionId identifies the only gate its verdict may
        # answer. Otherwise use the caller's interrupt id or the session default.
        card_target = _answer_target(answer)
        interrupt_id = card_target or interrupt_id or snap["session"].get("interrupt_id")
        if not interrupt_id:
            raise RuntimeError(f"session {session_id} is not waiting on input")
        # Resuming an id that is not parked would answer nothing yet still let
        # _finalize complete the plan; refuse instead. Legacy untargeted
        # sessions may have no per-step rows; targeted confirm cards must match.
        outstanding_pairs = await self._rm.outstanding_interrupts(session_id)
        outstanding = {i for i, _ in outstanding_pairs}
        step_by_interrupt = {i: sid for i, sid in outstanding_pairs}
        if card_target and card_target not in outstanding:
            raise RuntimeError(f"approval {card_target} is no longer pending")
        if outstanding and interrupt_id not in outstanding:
            # The session-level interrupt id can go STALE relative to the
            # per-step outstanding rows when several steps park in parallel and
            # the turn re-drives: a confirm gets a fresh ADK-generated id on
            # every drive, so the id recorded in `set_waiting` no longer matches
            # the step row after a re-drive resolves a sibling. A chat answer
            # (approve/decline/text) carries no specific target, so answering a
            # currently-outstanding interrupt is correct — pick one of the SAME
            # dialect as the stale id (a verdict answers a confirm; text answers
            # an ask) rather than failing the whole turn. An explicitly
            # targeted confirm card has already been rejected above if stale.
            same_dialect = [i for i, _ in outstanding_pairs
                            if hitl.is_confirm(i) == hitl.is_confirm(interrupt_id)]
            fallback = (same_dialect or [i for i, _ in outstanding_pairs])[0]
            logger.warning(
                "[worky] resume: stored interrupt %s not outstanding (outstanding=%s) "
                "— answering %s instead (parallel-gate id drift)",
                interrupt_id, sorted(outstanding), fallback)
            interrupt_id = fallback

        # STEP 8 (resume) — same step ids + depends_on ⇒ same node names + edges,
        # which is what lets the interrupt id from the earlier run still match.
        plan = _plan_from_snapshot(snap)
        # A create_task(await_reply) step now parks as a real TOP-LEVEL node (see
        # create_task — it is no longer a nested ctx.run_node), so its node path
        # and interrupt id ARE reproducible and it resumes through resume_part
        # exactly like a planner-emitted await. The old out-of-band shortcut
        # (mark it completed + replay it as a stored-result node) was for the
        # nested era; it is now HARMFUL — swapping the recorded park events for a
        # stored-result node diverges ADK's replay barrier on the await's own
        # sequence key (seen live: session 188cbdbe, "Replay divergence …
        # c593f1e04dfa@1"). So resume every await, dynamic or planned, the same
        # normal way.

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
        logger.info("[worky] 9. Runner.run_async → resuming session=%s interrupt=%s",
                    session_id, interrupt_id)
        # A confirm interrupt resumes with a tool-confirmation VERDICT, which ADK's
        # native processor turns back into a real re-invocation of the gated send
        # (approve) or a rejection to the model (decline) — the send's reasoning
        # continues in place. This works through the rebuild because every step is
        # fed None node_input (silent join) and sees its own scoped history
        # (include_contents='default'), so the verdict stays the last user turn.
        # ask/mail resume with the answer as before.
        if hitl.is_confirm(interrupt_id):
            # Edit-on-card: an approval may arrive as JSON {"verdict","edits"};
            # the edits ride along as the ToolConfirmation payload and the
            # connector tool merges them into the send. Plain text still works.
            confirmed, edits = _parse_verdict(answer)
            resume = hitl.confirmation_resume_part(
                hitl.confirm_fc_id(interrupt_id), confirmed=confirmed, payload=edits)
            # Close the answered card (and any stale re-drive duplicate) NOW —
            # BEFORE the send/report drive, not after — so the resolved state
            # propagates (Postgres → Electric → Mongo) while the turn runs.
            # Closing after the drive left the card 'ready' for the whole turn,
            # so a refresh mid-send still showed it armed until the next refresh.
            # A still-open parallel gate keeps its latest card armed (its id is
            # still outstanding); we exclude only the card being answered.
            answered = card_target or interrupt_id
            keep_open = [i for i, _ in await self._rm.outstanding_interrupts(session_id)
                         if hitl.is_confirm(i) and i != answered]
            await self._project(self._rm.close_confirm_choices(session_id, keep_open))
        else:
            resume = hitl.resume_part(interrupt_id, {"value": answer})
        # An ask/await node emits no final text when resumed (the answer is a
        # function-response, not model output), so _handle_event would complete it
        # with an EMPTY result — and _dep_results_context only injects a
        # dependency's non-empty .result into the downstream step's prompt. So the
        # answer got stored in ADK state, the step closed, but no downstream LLM
        # ever saw it. Seed the answer AS the step's result BEFORE the drive, on
        # the very object _dep_results_context reads, so the step that depends on
        # this ask receives it this turn (and the drawer shows it). Not for
        # confirm gates — their step produces its own send result.
        if not hitl.is_confirm(interrupt_id) and answer.strip():
            answered_sid = step_by_interrupt.get(interrupt_id)
            answered_step = plan.step(answered_sid) if answered_sid else None
            if answered_step is not None and not (answered_step.result or "").strip():
                answered_step.result = answer.strip()
        interrupt = await self._drive_until_quiescent(
            runner, session_id, user_id, plan, name_to_step,
            types.Content(role="user", parts=[resume]),
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
        except asyncio.CancelledError:
            # A supersede / StopSession, not a failure — StopSession's own path
            # marks the session cancelled. Let it propagate untouched.
            raise
        except Exception as exc:  # noqa: BLE001 — re-raised after failing loudly
            # A model / tool / transport error raised out of the drive. Without
            # this the turn aborts, _finalize never runs, and the read-model is
            # left stuck: the session stays 'running' and the in-flight step shows
            # a phantom 'completed'/'pending' with no error (proven — an executor
            # model 401 left the session 'running' forever). Fail loud so the
            # client sees a terminal state and a new message re-plans instead of
            # routing to converse on a phantom-live session.
            await self._fail_turn(session_id, plan, exc)
            raise
        finally:
            if self._active.get(session_id) is plan:
                self._active.pop(session_id, None)

    async def fail_session(self, session_id: str, exc: BaseException) -> None:
        """Top-level safety net for a turn that raised OUTSIDE the drive — most
        importantly the PLANNER LLM call (e.g. a RateLimitError), which happens
        before any graph is built, so _drive_until_quiescent's _fail_turn never
        runs. Without this the session is left 'running' and the UI hangs on
        'assistant is typing' forever with nothing shown (seen live: planner
        glm-5.3-go weekly-limit rate error). Surface the cause in the chat and
        fail the session. Idempotent: if the drive already failed it, do nothing
        (so a drive-phase error isn't double-posted)."""
        if self._rm is None:
            return
        try:
            snap = await self._rm.snapshot(session_id)
            if snap and snap["session"].get("status") == "failed":
                return  # already surfaced by _fail_turn
            err = f"{type(exc).__name__}: {exc}"[:500]
            await self._add_error_message(session_id, err)
            await self._project(self._rm.set_session_status(session_id, "failed"))
            logger.warning("[worky] turn raised outside the drive → session=%s failed (%s)",
                           session_id, err)
        except Exception:  # noqa: BLE001 — never mask the real failure
            logger.exception("[worky] fail_session projection failed session=%s", session_id)

    async def _fail_turn(self, session_id: str, plan: Plan, exc: BaseException) -> None:
        """Record an aborted turn as failed in the read-model (see
        _drive_until_quiescent). A step still RUNNING when the turn blew up is the
        one that failed — mark it failed with the error; pending steps never ran,
        so leave them, but the session and plan go 'failed' so nothing is left
        phantom-'running'. Best-effort: a projection error here must never mask
        the original exception."""
        err = f"{type(exc).__name__}: {exc}"[:500]
        try:
            # Surface the failure in the chat so the user sees WHY the task
            # stopped, not just a silently-'failed' session. Every turn error
            # (model/tool/transport) routes through here.
            await self._add_error_message(session_id, err)
            for s in plan.steps:
                if s.status is Status.RUNNING:
                    s.status = Status.FAILED
                    s.error = err
                    await self._project(self._rm and self._rm.set_step_status(
                        session_id, s.id, Status.FAILED.value, blocked_reason=err))
            plan.status = Status.FAILED
            await self._project(self._rm and self._rm.upsert_plan(
                session_id, plan.id, plan.title, plan.goal, Status.FAILED.value))
            await self._project(self._rm and self._rm.set_session_status(session_id, "failed"))
            logger.warning("[worky] turn failed → session=%s marked failed (%s)", session_id, err)
        except Exception:  # noqa: BLE001 — never mask the real failure
            logger.exception("[worky] _fail_turn projection failed session=%s", session_id)

    async def _drive_loop(self, runner, session_id, user_id, plan, name_to_step,
                          new_message, *, model, connectors, executor_prompt):
        in_graph = {s.id for s in plan.steps}
        interrupts = await self._drive(
            runner, session_id, user_id, plan, name_to_step, new_message)
        # Accumulate every parked interrupt ACROSS passes, keyed by step. A step
        # that parked in an earlier pass is replayed SILENTLY on a later rebuild
        # (ADK emits no fresh request_input event for it), so that pass's list
        # omits it. Returning only the last pass's list left _finalize unable to
        # bind the earlier-parked step, which then stayed stuck 'running' with its
        # mail wait unbound — seen live in session d624d1df: planner await 's3'
        # was dropped when the rebuild ran the Firas create_task await. fixed_iid
        # keeps each step's id stable across passes, so the key/value stay right.
        parked: dict = {sid: iid for iid, sid in interrupts if sid}
        # A step spawned mid-pass (create_task / delegate) is not in the graph
        # this pass ran, so it never executed — only a rebuild runs it. This now
        # includes create_task(kind='await_reply'), left PENDING as a top-level
        # step (never nested — a nested run diverges replay): its wait must run
        # on a rebuild to park and register its interrupt, or the reply path is
        # stranded. So re-drive whenever a spawned step is READY (all deps
        # complete) but hasn't run — even if the pass already parked OTHER
        # interrupts (a gate, or a sibling wait). Keying on readiness rather than
        # "no interrupts" is what lets a spawned await run alongside a parked one
        # instead of being abandoned. A spawned step whose deps aren't met yet
        # (e.g. the act step waiting on the await) is not "ready", so it doesn't
        # spin the loop; it runs on a later resume once its dep completes.
        unmet = self._unmet_deps(plan)
        while True:
            ready = [s.id for s in plan.steps
                     if s.status == Status.PENDING and s.id not in in_graph and not unmet(s)]
            if not ready:
                break
            logger.info("[worky] 9b. %d spawned step(s) ready mid-turn — continuing session=%s %s",
                        len(ready), session_id, [s[:12] for s in ready])
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
            for iid, sid in interrupts:
                if sid:
                    parked[sid] = iid
            stuck = [s for s in ready
                     if (st := plan.step(s)) and st.status == Status.PENDING and not unmet(st)]
            if stuck:
                # A ready step still pending after its own rebuild pass won't make
                # progress on another — stop rather than spin.
                logger.warning("[worky] 9b. ready spawned step(s) still pending after a "
                               "continuation pass — stopping session=%s %s", session_id,
                               [s[:12] for s in stuck])
                break
        # The union of everything parked this turn — a still-parked step (not
        # terminal) must be bound by _finalize even if a later pass didn't re-emit
        # its interrupt.
        return [(iid, sid) for sid, iid in parked.items()
                if (st := plan.step(sid)) is not None and not st.is_done()]

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
            # A send tool marked require_confirmation parks under a *different*
            # dialect (adk_request_confirmation) that interrupt_ids can't see. The
            # preview (the drafted mail/message) is only on this event, so project
            # the approval card now, while we still have it — a resume re-emits
            # nothing for it (like every other interrupt).
            for iid, preview in hitl.confirmation_interrupts(ev):
                if iid not in seen:
                    seen.add(iid)
                    interrupts.append((iid, step_id))
                    await self._project_approval_choice(session_id, iid, preview)
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
        dead: set = set()
        for interrupt_id, step_id in interrupts:
            if not step_id:
                continue
            step = plan.step(step_id)
            # An await_reply whose upstream send FAILED can never be answered — the
            # message was never sent. Parking it strands the session on a DEAD
            # interrupt: it blocks forever AND makes a later amend look "owned" by a
            # live await, so the amended step is never driven (session 0a08ea4b:
            # 'Await Adam' hung on a failed 'Message Adam', and the corrected 'Ask
            # Adem' never ran). Cancel it instead of blocking so the plan moves on.
            if step is not None and step.kind == "await_reply" and any(
                    (dep := plan.step(d)) is not None and dep.status is Status.FAILED
                    for d in step.depends_on):
                step.status = Status.CANCELLED
                dead.add(step_id)
                await self._project(self._rm and self._rm.set_step_status(
                    session_id, step_id, Status.CANCELLED.value,
                    blocked_reason="the message this awaited a reply to was not sent"))
                await self._project(self._rm and self._rm.cancel_mail_wait(session_id, step_id))
                continue
            step.status = Status.BLOCKED
            # Remember the exact id so a later same-turn rebuild re-parks this
            # ask/await under it rather than a shifted node-path id (see Step).
            step.interrupt_id = interrupt_id
            step.blocked_reason = ("awaiting your approval" if hitl.is_confirm(interrupt_id)
                                   else "awaiting user input" if hitl.is_ask(interrupt_id)
                                   else "awaiting email reply")
            await self._project(self._rm and self._rm.set_step_status(
                session_id, step_id, "blocked", blocked_reason=step.blocked_reason,
                interrupt_id=interrupt_id))
            if not hitl.is_ask(interrupt_id):
                # The step is parked now, so its wait becomes deliverable: the
                # token was minted at projection but had no interrupt to resume.
                await self._project(self._rm and self._rm.bind_mail_wait_interrupt(
                    session_id, step_id, interrupt_id))
            if hitl.is_ask(interrupt_id) and not hitl.is_confirm(interrupt_id):
                # Surface the ask-the-user question in the chat. A mail wait has
                # nothing to ask the owner — it is waiting on the outside world.
                # A confirm already projected its approve/decline card in _drive.
                await self._add_message(session_id, "assistant",
                                        step.question or step.description or "")

        # Cancel the dead branch below a cancelled zombie await — those steps
        # waited (transitively) on a reply that will never come, so the cleanup
        # below must not mark them 'completed' with no result.
        while dead:
            propagated = False
            for s in plan.steps:
                if s.status in (Status.PENDING, Status.BLOCKED) and s.id not in dead \
                        and any(d in dead for d in s.depends_on):
                    s.status = Status.CANCELLED
                    dead.add(s.id)
                    propagated = True
                    await self._project(self._rm and self._rm.set_step_status(
                        session_id, s.id, Status.CANCELLED.value,
                        blocked_reason="an upstream step it depended on could not complete"))
            if not propagated:
                break

        outstanding = await self._outstanding(session_id, interrupts)
        # Reconcile send-approval cards against the PER-STEP outstanding set (the
        # real multi-interrupt record), not the single sessions.interrupt_id. A
        # confirm card stays armed only while a step is still parked on its gate;
        # close every other one. Parallel gates from spawned steps drift the
        # single session slot, orphaning cards whose step already resolved — those
        # were never closed by the resume path and lingered 'ready' forever. Runs
        # every turn end: keep_confirm empty on completion closes all of them.
        keep_confirm = [i for i, _ in outstanding if hitl.is_confirm(i)]
        await self._project(self._rm and self._rm.close_confirm_choices(session_id, keep_confirm))
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
        # A step that failed via an ADK error EVENT (e.g. an LLM error) doesn't
        # raise, so it never reaches _fail_turn — surface its error in the chat
        # here, appended to whatever partial results did complete.
        await self._add_message(session_id, "assistant", self._assistant_answer(plan))
        failed = [s for s in plan.steps if s.status is Status.FAILED]
        if failed:
            errs = "\n".join(f"• {s.title or s.id}: {s.error or 'failed'}" for s in failed)
            await self._add_error_message(session_id, errs,
                                          title="Some steps couldn't be completed")
        await self._project(self._rm and self._rm.upsert_plan(
            session_id, plan.id, plan.title, plan.goal, plan.status.value))
        await self._project(self._rm and self._rm.set_session_status(
            session_id, "completed" if plan.status is Status.COMPLETED else plan.status.value))

    async def _make_plan(self, session_id: str, user_id: str, message: str, *,
                         planner_model: Optional[str] = None,
                         planner_prompt: Optional[str] = None,
                         planner_connectors: Optional[List[dict]] = None,
                         plan_session: Optional[str] = None,
                         requester: Optional[dict] = None) -> Plan:
        # The planner's ADK session accumulates history across calls. The main
        # flow shares one ("<id>_plan") on purpose, so the planner keeps context
        # across a user's turns. converse passes an EPHEMERAL session instead:
        # otherwise an amend like "also search Ethereum" would see the earlier
        # "search Bitcoin" in history and re-plan BOTH, and _inject_steps would
        # append a duplicate of the step already running.
        plan_session = plan_session or (session_id + "_plan")
        # output_schema forces provider structured output (response_schema +
        # application/json): a capable model gets the strongest shape guarantee on
        # the first pass. But it HARD-REQUIRES provider support — a model without
        # it 400s or ignores the schema. So try WITH the schema, then fall back to
        # a schema-less prompt-mode pass whose JSON contract lives in the
        # instruction (the DB prompt / PLANNER_INSTRUCTION) and is restated in the
        # message. The plan was always parsed from text via _extract_json anyway,
        # so prompt mode needs nothing else — it just lets the planner run on ANY
        # model that can emit JSON, not only structured-output ones.
        model_obj = self._build_planner_model(planner_model)
        # The DB prompt (agentstore) is the source of truth: it REPLACES the
        # instruction rather than stacking on it. PLANNER_INSTRUCTION is only a
        # fallback when the DB has none. (Concatenating the two made the planner
        # read the whole prompt twice, and its {{ }} JSON examples reached the
        # model as invalid doubled braces.)
        planner_instruction = (planner_prompt or PLANNER_INSTRUCTION)
        # The planner runs on ITS OWN connectors (like the executor). Human-agent
        # lookup comes from the human-agents connector's tool
        # (human-agents_search_human_agents), attached to every agent — the old
        # built-in human-agents_search_human_agents wrapper has been dropped to avoid a duplicate.
        planner_tools = list(self._tools_for(planner_connectors, session_id, user_id))

        def _planner_agent(use_schema: bool) -> LlmAgent:
            kwargs = dict(name="planner", model=model_obj,
                          instruction=planner_instruction, tools=planner_tools)
            if use_schema:
                kwargs["output_schema"] = _PlannerOutput
            return LlmAgent(**kwargs)

        async def _run_planner(agent: LlmAgent, msg: str) -> str:
            runner = self._runner_factory(agent, f"planner_{session_id}")
            await _ensure_session(runner, f"planner_{session_id}", user_id, plan_session)
            text = ""
            async for ev in runner.run_async(
                user_id=user_id, session_id=plan_session,
                new_message=types.Content(role="user", parts=[types.Part(text=msg)])):
                if ev.content and ev.content.parts:
                    for p in ev.content.parts:
                        if getattr(p, "text", None):
                            text = p.text
            return text

        # Tell the planner who it is planning for, so it addresses the requester
        # directly and never assigns work or emails back to them. Kept as a
        # per-turn preamble on the message (not the DB instruction) so it works
        # whatever prompt the agentstore supplies.
        ctx = requester_context(requester)
        planner_message = f"{ctx}\n\n---\nUser's request:\n{message}" if ctx else message

        # Pass 1: structured. Pass 2: schema-less prompt mode — reached when the
        # provider can't do structured output (the run raises) OR the structured
        # reply wasn't parseable JSON. asyncio.CancelledError is a BaseException,
        # so a supersede/stop still propagates through the `except Exception`.
        data = None
        attempts = ((True, planner_message),
                    (False, planner_message + "\n\n" + _PLANNER_JSON_REMINDER))
        for idx, (use_schema, msg) in enumerate(attempts):
            try:
                data = _extract_json(await _run_planner(_planner_agent(use_schema), msg))
                break
            except Exception as exc:  # provider rejected structured output, or no JSON
                logger.warning(
                    "[worky] planner pass %d failed (use_schema=%s) session=%s: %s",
                    idx, use_schema, session_id, exc)
                if idx == len(attempts) - 1:
                    raise
        steps = []
        seen_ids: set = set()
        for s in data.get("steps", []):
            # A flaky planner (observed live with glm-5.3-go) can emit the same
            # step twice or a blank id. Both collapse to one row under
            # _namespace_step_ids and trip scheduler.validate ("duplicate step
            # ids"), which aborts the WHOLE turn so nothing is projected and the
            # session hangs 'running'. Drop the offender and keep the plan.
            sid = s.get("id")
            if not sid or sid in seen_ids:
                logger.warning("[worky] planner emitted a %s step id %r — dropping it (session=%s)",
                               "duplicate" if sid in seen_ids else "blank", sid, session_id)
                continue
            seen_ids.add(sid)
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
            steps.append(Step(id=sid, title=s.get("title", ""),
                              description=s.get("description", ""),
                              kind=s.get("kind", "execute"), question=s.get("question"),
                              depends_on=list(s.get("depends_on", [])),
                              is_persona=bool(assignee_name),
                              assignee=assignee_id, assignee_name=assignee_name,
                              assignee_role=assignee_role))
        # Prune deps validate() would also reject: a self-dep or a reference to a
        # step the planner never emitted (or that we just dropped). A dangling dep
        # is meaningless work-ordering, so drop it rather than abort the turn.
        kept = {s.id for s in steps}
        for s in steps:
            s.depends_on = [d for d in s.depends_on if d in kept and d != s.id]
        plan = Plan(title=data.get("title", ""), goal=data.get("goal", ""),
                    answer=data.get("answer") or None, steps=steps,
                    ops=[dict(o) for o in data.get("ops", []) if o.get("step_id")])
        self._namespace_step_ids(plan)
        return plan

    @staticmethod
    def _namespace_step_ids(plan: Plan) -> None:
        """Prefix every step id with this plan's id, in place (deps too).

        Step ids come verbatim from the planner (see _make_plan: Step(id=s["id"])),
        which labels them s1, s2, … on EVERY turn — it can't see prior turns. But
        the read-model keys plan_steps by (session_id, step_id) and one session is
        reused across turns, so a later turn's bare s1/s2 collided with an earlier,
        already-EXECUTED turn's rows and overwrote their title/description in place
        (upsert's ON CONFLICT rewrites content but not status/result → a finished
        step the user watched complete silently relabelled to the new message's
        task). Namespacing by the per-turn plan.id makes ids unique across turns;
        depends_on is remapped the same way so intra-plan wiring is unchanged.
        node_name() sanitises the id for ADK anyway, so the prefix is transparent
        downstream. converse's _inject_steps re-ids to fresh uuids regardless, so
        this only has to fix the plan_turn path — the one that reuses the session.
        """
        if not plan.steps:
            return
        idmap = {s.id: f"{plan.id}_{s.id}" for s in plan.steps}
        for s in plan.steps:
            s.id = idmap[s.id]
            s.depends_on = [idmap.get(d, d) for d in s.depends_on]

    @staticmethod
    def _dep_results_context(plan: Plan):
        """Per-step hook handing a step the RESULTS of the completed steps it
        depends_on, so a downstream step can actually use upstream output.

        `depends_on` is ordering only: each step runs as its own ADK node on its
        own branch and normally sees nothing but its own description (proven — a
        step asked to echo an upstream secret returned NONE). But the orchestrator
        holds every completed step's result on the live Plan, so we read it fresh
        at model-call time and inject just the DIRECT dependencies' results — not
        the whole plan, so a step still never learns its siblings' tasks (that
        leak is exactly what the isolation was built to prevent).
        """
        by_id = {s.id: s for s in plan.steps}

        def ctx(step: Step) -> Optional[str]:
            blocks = []
            for dep_id in step.depends_on:
                dep = by_id.get(dep_id)
                if dep and dep.status is Status.COMPLETED and (dep.result or "").strip():
                    r = dep.result.strip()
                    # ponytail: flat cap per dependency; summarise upstream if a
                    # step ever needs to lean on a result larger than this.
                    if len(r) > 4000:
                        r = r[:4000] + "\n[…tronqué]"
                    blocks.append(f"— Étape « {dep.title or dep.id} » :\n{r}")
            upstream = (
                "Résultats des étapes précédentes dont dépend la tienne "
                "(sers-t'en, ne les refais pas) :\n\n" + "\n\n".join(blocks)
            ) if blocks else None

            # Downstream awareness (CONTEXT ONLY): the steps that depend on this
            # one. It tells the executor/persona that a reply-wait or a follow-up
            # is ALREADY planned, so it must not spawn its own create_task — a
            # runtime await_reply reshapes the graph and breaks replay. It must
            # NOT perform these steps; another node owns them.
            dependents = [s for s in plan.steps if step.id in s.depends_on]
            down = None
            if dependents:
                tag = {"await_reply": "attend la réponse",
                       "ask": "demande à l'utilisateur"}
                lines = [f"— « {d.title or d.id} » ({tag.get(d.kind, 'étape suivante')})"
                         for d in dependents]
                waits = "\nUne étape attend déjà la réponse à ton message : envoie " \
                        "puis termine, ne crée PAS d'attente toi-même." \
                        if any(d.kind == "await_reply" for d in dependents) else ""
                down = ("Étapes qui suivent la tienne (POUR CONTEXTE — ne les fais "
                        "pas, un autre nœud s'en charge) :\n" + "\n".join(lines) + waits)

            parts = [p for p in (upstream, down) if p]
            return "\n\n".join(parts) if parts else None
        return ctx

    @staticmethod
    def _unmet_deps(plan: Plan):
        """Per-step hook: the ids of this step's dependencies that are still
        non-terminal (pending/running/blocked), read LIVE at model-call time.

        The gate (nodes._defer_if_deps_unmet) uses it to decline a node ADK
        fired before a runtime-added dependency finished — see that callback.
        Reads the CURRENT plan (plan.step), never a build-time snapshot, so a
        dependency a mid-pass create_task/delegate just re-parented onto this
        step (and appended to plan.steps) is seen. A missing or terminal dep is
        NOT unmet: a terminal-failed dep can never become ready, so deferring on
        it would hang — let the step proceed as it did before the gate existed."""
        def unmet(step: Step) -> list:
            out = []
            for dep_id in step.depends_on:
                dep = plan.step(dep_id)
                if dep is not None and dep.status in (
                        Status.PENDING, Status.RUNNING, Status.BLOCKED):
                    out.append(dep_id)
            return out
        return unmet

    def _build_planner_model(self, model_name: Optional[str] = None):
        # Always has the human-agents_search_human_agents discovery tool now.
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

    async def _keep_completed_on_rerun_failure(self, session_id: str, step) -> bool:
        """A re-drive of an already-completed step self-reported a failure. Its
        work is already done, so keep the recorded result instead of downgrading
        (see the _completed_once note at re-entry). Returns True if it protected
        the step (caller must then stop, not write FAILED)."""
        if not getattr(step, "_completed_once", False):
            return False
        step.status = Status.COMPLETED
        step.error = None
        logger.warning("[worky] 9. re-run failure IGNORED for already-completed step=%s "
                       "— keeping recorded result", step.id)
        await self._project(self._rm and self._rm.set_step_status(
            session_id, step.id, "completed", result=step.result))
        return True

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
                # Protect real prior work: a step that already COMPLETED with a
                # result must not be downgraded to FAILED by a re-drive. Its side
                # effect already happened (e.g. the GitHub ticket exists), and the
                # re-run can self-report STEP_FAILED on stale/ambiguous context
                # (seen live: session 09bf4bea, "Créer ticket Sophie" completed
                # then failed after an ambiguous email answer). Completed→completed
                # re-runs stay allowed (a step may re-run to add more).
                if step.status is Status.COMPLETED and (step.result or "").strip():
                    step._completed_once = True
                logger.warning("[worky] 9. ⟲ completed step re-entered session=%s step=%s "
                               "(was %s) — replay unless it also logs a REAL MODEL CALL",
                               session_id, step_id, step.status.value)
            step.status = Status.RUNNING
            logger.info("[worky] 9. step running session=%s step=%s wave=%d",
                        session_id, step_id, step.wave)
            await self._project(self._rm and self._rm.set_step_status(
                session_id, step_id, "running"))
        # A model/tool error ADK reports as an EVENT (not a raise) is a
        # final_response with empty content — is_output below would then mark the
        # step 'completed' with an empty result (seen live: an executor model 401
        # left the step falsely 'completed'). Catch it first and mark the step
        # FAILED with the error, so the failing step reads correctly.
        err = getattr(ev, "error_message", None) or getattr(ev, "error_code", None)
        if err:
            if await self._keep_completed_on_rerun_failure(session_id, step):
                return
            step.status = Status.FAILED
            step.error = str(err)[:500]
            step.result = step.error
            logger.warning("[worky] 9. step FAILED session=%s step=%s err=%s",
                           session_id, step_id, step.error)
            # Store the error as the result too, so the task drawer's Résultats
            # tab shows the explanation instead of "Aucun résultat généré".
            await self._project(self._rm and self._rm.set_step_status(
                session_id, step_id, "failed", result=step.error,
                blocked_reason=step.error))
            return
        if is_output:
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
            # A step self-reports failure with the STEP_FAILED sentinel (e.g. it
            # could not identify the recipient). Without this a plain final text —
            # even one saying "I failed" — is recorded as 'completed'; only an ADK
            # error event (above) otherwise fails a step. ponytail: free-text
            # sentinel, fragile; a fail_task tool would be sturdier if it drifts.
            if text.lstrip().upper().startswith("STEP_FAILED"):
                if await self._keep_completed_on_rerun_failure(session_id, step):
                    return
                step.status = Status.FAILED
                step.error = text.lstrip()[len("STEP_FAILED"):].lstrip(" :–-\t").strip()[:500] or "step failed"
                step.result = step.error
                logger.warning("[worky] 9. step self-reported FAILED session=%s step=%s err=%s",
                               session_id, step_id, step.error)
                # Store the error as the result too (see the ADK-error path above).
                await self._project(self._rm and self._rm.set_step_status(
                    session_id, step_id, "failed", result=step.error,
                    blocked_reason=step.error))
                return
            step.status = Status.COMPLETED
            # Don't clobber a pre-seeded result with empty terminal text: an ask
            # node completes with no model text but resume_turn already seeded the
            # user's answer as its result (so downstream _dep_results_context can
            # read it). Any real output still wins.
            step.result = text or step.result
            logger.info("[worky] 9. step completed session=%s step=%s (%d chars)",
                        session_id, step_id, len(step.result or ""))
            await self._project(self._rm and self._rm.set_step_status(
                session_id, step_id, "completed", result=step.result))
