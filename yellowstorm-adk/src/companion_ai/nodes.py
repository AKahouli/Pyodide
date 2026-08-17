"""Executor node factory — turns each plan step into an LlmAgent graph node.

The graph accepts an LlmAgent directly as a node (ADK coerces it via
run_llm_agent_as_node), so a step's node is just a per-step LlmAgent whose
instruction is the step description and whose result is written to session
state under the node's name (output_key).

Reuses the project's LLMFactory so model/proxy config stays in one place.
"""
from __future__ import annotations

import logging
import re
from typing import Awaitable, Callable, List, Optional

from google.adk.agents import LlmAgent
from google.genai import types as genai_types

from . import mail_token
from .graph import NodeFactory
from .plan import Status, Step

logger = logging.getLogger(__name__)

# ADK's own RunConfig.max_llm_calls is invocation-wide (shared across every
# step in the plan) and hard-aborts the whole run on trip. This caps a
# single step instead, and recovers gracefully.
MAX_STEP_MODEL_CALLS = 15
# A persona step's own job is now longer by design (find the real person's
# email, send it, create_task(await_reply)) before it can even reach a
# genuine parked state — the plain cap was tripping before that chain
# finished, forcing a fabricated decision.
MAX_PERSONA_STEP_MODEL_CALLS = 25


STUCK_LOOP_WINDOW = 3


def _lookup_signature(part) -> Optional[tuple]:
    """(tool_name, normalized target) for a function_call part that looks like
    a directory/search lookup — keyed on the actual subject being looked up,
    not the full arg dict, so a model that keeps re-verifying the SAME person
    still gets caught even when it jitters incidental args between calls
    (e.g. sometimes passing role='', sometimes not; sometimes pairing the
    call with an unrelated tool, or alternating which of two names it
    re-checks). Seen live: find_human_agents('Firas Kahia') called 6+ times
    across one step with the args shape changing almost every round — a
    strict "same 3 rounds in a row, byte-identical" check never caught it."""
    fc = getattr(part, "function_call", None)
    if fc is None:
        return None
    args = fc.args or {}
    target = args.get("name") or args.get("agent_name") or args.get("query")
    if not target:
        return None
    return (fc.name, str(target).strip().lower())


def _stop_after_n_calls(limit: int, model_name: str, *,
                         is_persona: bool = False, assignee_name: Optional[str] = None):
    """Forces a real answer once a step exceeds `limit` model calls, instead
    of looping forever or returning a non-answer a caller could mistake for
    a genuine one.

    Routes the forced answer through a separate with_tools=False client
    rather than stripping tools from the current request: the tool-enabled
    client has parallel_tool_calls=True baked in at construction time (see
    llm_factory.py), and a tools-less request through it gets rejected by
    Azure outright ("parallel_tool_calls is only allowed when tools are
    specified") — litellm.drop_params doesn't catch this, it's a value-level
    conflict, not an unsupported param.

    A persona step gets a DIFFERENT nudge: "give your best answer" is exactly
    the fabricated-decision behavior persona_preamble forbids (the whole point
    of the new design is that {assignee_name}'s real decision comes from their
    own email reply, never a guess) — and since this fallback call has no
    tools, the step can't place its usual create_task(kind='await_reply')
    escalation here either. So it must say plainly that it ran out of budget
    before reaching them, not present a guess as their answer.

    Separately: before that budget is anywhere near exhausted, also watch for
    a step re-issuing the exact same tool call(s) round after round — seen
    live, a step re-verified the same two already-confirmed find_human_agents
    lookups 7+ times with identical, successful results each time, making no
    other progress. That is a model reasoning stall, not a budget problem, so
    it gets a different remedy: a pointed nudge with tools still available
    (not the budget-exhausted fallback above, which strips them), so it can
    actually act on being told to stop re-checking and move on.
    """
    state = {"n": 0, "forced": False}

    async def _cb(callback_context, llm_request):
        state["n"] += 1
        lookup_counts = state.setdefault("lookup_counts", {})
        nudged_keys = state.setdefault("nudged_keys", set())
        model_rounds = [c for c in llm_request.contents if c.role == "model"]
        if model_rounds:
            # Only the newest round -- earlier ones were already counted on a
            # prior _cb call, since model_rounds grows by exactly one per turn.
            for part in (model_rounds[-1].parts or []):
                sig = _lookup_signature(part)
                if sig is not None:
                    lookup_counts[sig] = lookup_counts.get(sig, 0) + 1
        stuck = next(((sig, n) for sig, n in lookup_counts.items()
                      if n >= STUCK_LOOP_WINDOW and sig not in nudged_keys), None)
        if stuck is not None:
            (tool_name, target), count = stuck
            nudged_keys.add((tool_name, target))
            logger.warning(
                "[worky] step re-looked-up %r via %s %d times — nudging",
                target, tool_name, count)
            nudge_text = (
                f"You've already called {tool_name} for {target!r} {count} times in "
                "this step and gotten a successful result every time — calling it "
                "again will not tell you anything new. You already have this "
                "information. Stop re-checking it and move on to the next real "
                "action — actually doing the work this step needs (e.g. "
                "drafting/sending the email, escalating to someone genuinely "
                "different, or giving your answer), not verifying the same fact "
                "again.")
            llm_request.contents = llm_request.contents + [genai_types.Content(
                role="user", parts=[genai_types.Part(text=nudge_text)])]
        if state["n"] > limit and not state["forced"]:
            state["forced"] = True
            logger.warning("[worky] step exceeded %d model calls — forcing a final answer", limit)
            from google.adk.models.llm_request import LlmRequest
            if is_persona:
                nudge_text = (
                    "Stop calling tools now. You have run out of budget before reaching "
                    f"{assignee_name}'s real decision — do NOT invent one now. Say plainly "
                    "that this could not be escalated to them within this turn and needs "
                    "manual follow-up; never present your own guess as their answer.")
            else:
                nudge_text = (
                    "Stop calling tools now. Give your best answer using only what you "
                    "already know from this conversation so far — do not ask for more "
                    "information and do not say you are unable to answer.")
            nudge = genai_types.Content(role="user", parts=[genai_types.Part(text=nudge_text)])
            fallback_request = LlmRequest(model=model_name, contents=llm_request.contents + [nudge])
            # contents alone drops the task/persona instruction — a separate field.
            fallback_request.config.system_instruction = llm_request.config.system_instruction
            fallback_llm = build_llm(model_name, with_tools=False)
            async for resp in fallback_llm.generate_content_async(fallback_request, stream=False):
                return resp
        return None

    return _cb


# The filler messages the backend passes as the workflow's shared new_message
# (see service.py _drive/resume). They carry no task — the real per-step task is
# injected below — so a step-agent is better off never seeing them. Kept exact so
# a real email reply (which a resumed step gets as its front user turn) is never
# mistaken for one.
_KICKOFF_SENTINELS = frozenset({"run the plan", "continue"})


def _inject_task_turn(task_text: str):
    """Deliver the step's task as a USER turn instead of baking it into the
    system prompt.

    ADK hands the whole workflow ONE shared kickoff message ("run the plan"), so
    a step's own task can normally only reach it through system_instruction. We
    put it in as a distinct user turn — which lets the big rules block stay
    identical across every step (cacheable) — placed EARLY, never last. A task
    pinned last is re-read as the most-recent instruction every round and
    out-shouts terminal flow signals: seen live, a persona step that had already
    sent its mail and created its await_reply step (whose tool result says "end
    your turn now") kept polling the mailbox because the appended task stayed
    more recent than that stop. Kept early, the growing tool history — including
    those stop messages — stays more recent than the task.

    If the front turn is the shared filler kickoff, we REPLACE it (no reason to
    keep noise the model has to reconcile). Otherwise the front turn is real —
    on a resume it's the incoming email reply — so we keep it and splice the task
    in right after. Re-applied every model call (the splice lives only on the
    transient request, never in session state) and idempotent.
    """
    async def _cb(callback_context, llm_request):
        contents = list(llm_request.contents or [])
        task = genai_types.Content(
            role="user", parts=[genai_types.Part(text=task_text)])

        def user_text(c):
            return (c.parts[0].text if getattr(c, "role", None) == "user"
                    and c.parts and getattr(c.parts[0], "text", None) is not None else None)

        first_txt = user_text(contents[0]) if contents else None
        if first_txt in _KICKOFF_SENTINELS:
            contents[0] = task                       # drop the filler, task takes its place
        elif not (len(contents) > 1 and user_text(contents[1]) == task_text):
            contents.insert(1, task)                 # keep the real front turn, task right after
        else:
            return None                              # already spliced
        llm_request.contents = contents
        return None
    return _cb


def _compose_before_model(*cbs):
    """Chain before_model callbacks; the first to return a response wins."""
    async def _run(callback_context, llm_request):
        for cb in cbs:
            resp = await cb(callback_context, llm_request)
            if resp is not None:
                return resp
        return None
    return _run


EXECUTOR_INSTRUCTION = """{identity}

{do_this_line}
{description}

You are not told the plan's wider goal or its other steps, on purpose — the
planner already wrote your task as a complete, standalone instruction,
and every other step in this plan has the SAME toolset you do (including
things like sending email). Reaching for one of those tools because it looks
useful for the overall task is another step's job, not yours.

Use the available tools when needed — call them directly; there is nothing to
schedule and nothing that runs in the background. Sending an email is instant,
even when the answer takes days: send it, then register the wait. Waiting is a
separate step's job, never something you sit and hold this turn open for.

If you send an email whose REPLY matters to this plan, you MUST call
create_task(kind='await_reply') before you finish, describing what to do with
that reply. Sending and then ending your turn loses the answer for good: nothing
is watching for it, so when they write back the plan is already finished and
their reply goes nowhere. This applies whoever you are and whoever you wrote to.
If no reply is expected — you were only informing someone — say so plainly and
finish.

When one thing must happen before another, say so instead of hoping: every task
you create starts immediately and they all run in parallel, so two searches you
spin off run at once — but a task that has to READ their findings must wait for
them. create_task returns each new step's id; pass those ids as
after=['<id>', '<id>'] on the task that depends on them. Use it only for a real
ordering need — parallel is faster, and a chain of after= on work that could run
at once just makes the plan slower.

Return a concise result for this step only — other steps are handled by other
agents, so just produce your part directly."""


def build_llm(model_name: str, *, with_tools: bool, temperature: float = 0.0):
    """Build a LiteLlm for an agent. When the agent has NO tools we must not send
    `tool_choice`/`parallel_tool_calls` — the API rejects them without tools — so
    we build a plain model in that case."""
    if with_tools:
        from src.smart_rag.infrastructure.factories.llm_factory import LLMFactory
        return LLMFactory.create_parallel_tool_calls_llm(model_name, temperature=temperature)
    import litellm
    litellm.drop_params = True
    from google.adk.models.lite_llm import LiteLlm
    from src.config.settings import get_settings
    from src.smart_rag.infrastructure.model_parameters import normalize_temperature_for_model
    app_settings = get_settings()
    temperature = normalize_temperature_for_model(model_name, temperature)
    if "ollama" in model_name.lower():
        return LiteLlm(model=model_name, api_base=app_settings.OLLAMA_API_BASE_URL,
                       api_key=app_settings.OLLAMA_API_KEY, temperature=temperature, stream=True)
    return LiteLlm(model=model_name, api_base=app_settings.LITELLM_API_BASE_URL,
                   api_key=app_settings.LITELLM_API_SECRET_KEY, temperature=temperature, stream=True)


def is_send_email_tool(tool) -> bool:
    """True for a connector's send_email action tool, whatever connector it came
    from (tool names are `{connector_slug}_{action_key}`)."""
    name = getattr(getattr(tool, "func", None), "__name__", "") or ""
    return name.endswith("_send_email")


def artifacts_from_tool_result(result) -> List[dict]:
    """Every file a connector tool just produced — none, one, or several.

    Keyed on the RESULT carrying a storage path, not on the tool's name. A
    connector that uploads a file says so by returning one — code-interpreter's
    send_file_to_user does, and any future tool that stores something will too.
    Matching on names instead would silently miss every one of them. Same test
    the playbook path uses (flow_engine/tools/langchain_factory.py).

    Two result shapes carry files, and a single call can produce many:
    `generated_files: [...]` (one entry per file, as the interpreter returns),
    and a bare `ceph_path` on the result itself (a single-file send). Both are
    read, so a step that writes a chart, a CSV and a report gets three rows
    rather than only whichever the first branch happened to match.
    """
    if not isinstance(result, dict):
        return []
    entries = [e for e in (result.get("generated_files") or []) if isinstance(e, dict)]
    # A single-file result IS the entry — only when it isn't already listed
    # above, or the same file would be recorded twice under two names.
    if not entries and (result.get("ceph_path") or "").strip():
        entries = [result]
    return [a for a in (_artifact_from_entry(e) for e in entries) if a]


def _artifact_from_entry(entry: dict) -> Optional[dict]:
    file_path = str(
        entry.get("ceph_path") or entry.get("object_key")
        or entry.get("azure_path") or entry.get("file_path") or ""
    ).strip()
    if not file_path:
        return None
    # `path` is the sandbox path the model asked to send; its basename is the
    # only human-meaningful name available, since the stored key is opaque.
    filename = str(entry.get("filename") or entry.get("name")
                   or entry.get("path") or file_path)
    filename = filename.rstrip("/").split("/")[-1]
    size = entry.get("size")
    return {
        "file_path": file_path,
        "filename": filename,
        "artifact_kind": _artifact_kind_for(filename),
        "mime_type": str(entry.get("mime_type") or entry.get("mimeType") or "") or None,
        "size": int(size) if isinstance(size, (int, float)) else None,
    }


def _artifact_kind_for(filename: str) -> Optional[str]:
    """Same buckets the playbook uses, so both surfaces classify a file alike."""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    for kind, exts in (
        ("image", {"png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"}),
        ("data", {"csv", "tsv", "json", "xlsx", "xls", "parquet"}),
        ("code", {"py", "js", "ts", "sql", "sh", "yaml", "yml"}),
        ("document", {"pdf", "doc", "docx", "md", "txt", "html", "pptx"}),
    ):
        if ext in exts:
            return kind
    return "document" if ext else None


def capture_artifacts_tool(tool, *, on_artifact: Callable[[dict], Awaitable[None]]):
    """Wrap a connector tool so any file it produces is recorded for the client.

    Worky has no component stream: the client reads the Postgres read model over
    Electric, so a file has to become a durable row or it is invisible. The tool
    result still goes back to the model untouched — this only observes.

    A projection failure must never fail the tool call. The file exists either
    way, and losing a step's real work because a read-model write failed would
    be a far worse trade than a missing download link.
    """
    from src.smart_rag.tools.search.tools import SearchToolADK

    original = tool.func

    async def capturing(**kwargs):
        result = await original(**kwargs)
        for artifact in artifacts_from_tool_result(result):
            # Recorded one at a time: a step producing three files should not
            # lose the other two because one of them failed to project.
            try:
                await on_artifact(artifact)
            except Exception as e:
                logger.warning("artifact projection failed for %s: %s",
                               artifact.get("filename"), e)
        return result

    capturing.__name__ = original.__name__
    capturing.__signature__ = original.__signature__
    capturing.__annotations__ = original.__annotations__
    return SearchToolADK(capturing, {"function": tool.custom_schema})


def stamp_send_email_tool(tool, *, token_provider: Callable[[], Awaitable[Optional[str]]],
                          on_sent: Optional[Callable[[str], Awaitable[None]]] = None):
    """Wrap a send_email tool so the outbound mail carries its routing token.

    `on_sent(token)` — optional — runs only after the underlying send returns
    successfully, for callers that need to persist the wait (see
    _mail_stamping's eager path). A send that raises must leave no wait behind.

    Deterministic on purpose. The alternative — telling the executor LLM to put a
    marker in the subject — fails open: the one time the model omits it, the
    reply routes nowhere and the step waits forever. Nothing about the token is
    the model's business, so it never sees it.

    The wrapper keeps the original's name, signature and schema, so the executor
    sees exactly the tool the connector published.
    """
    from src.smart_rag.tools.search.tools import SearchToolADK

    original = tool.func

    async def stamped(**kwargs):
        token = await token_provider()
        if token:
            # Two carriers: a sender may rewrite the subject or trim the quote,
            # but rarely both. See mail_token.
            if kwargs.get("subject"):
                kwargs["subject"] = mail_token.stamp_subject(kwargs["subject"], token)
            if kwargs.get("body"):
                kwargs["body"] = mail_token.stamp_body(kwargs["body"], token)
        else:
            # The step still sends; it just cannot be replied *to*. Better a mail
            # that lands than a step that refuses to run.
            logger.warning("send_email: no routing token for this step — a reply "
                           "will not resume anything")
        result = await original(**kwargs)
        # Only NOW does a mail exist that a reply could answer, so only now is
        # there a wait worth recording. Registering before the send meant a send
        # that raised (MCP transport, auth, a 4xx from Graph) still left a wait
        # row behind: the step then parked on a reply to an email that was never
        # sent, and nothing could ever resume it. Minting stays above — the
        # token has to be IN the mail — but persisting waits for the send to
        # come back.
        if token and on_sent is not None:
            await on_sent(token)
        return result

    stamped.__name__ = original.__name__
    stamped.__signature__ = original.__signature__
    stamped.__annotations__ = original.__annotations__
    return SearchToolADK(stamped, {"function": tool.custom_schema})


def make_llm_node_factory(
    *,
    model_name: str,
    tools: Optional[List] = None,
    temperature: float = 0.0,
    custom_instruction: Optional[str] = None,
    tools_for_step: Optional[Callable[[Step, List], List]] = None,
    instruction_for_step: Optional[Callable[[Step], Optional[str]]] = None,
) -> NodeFactory:
    """Build a NodeFactory that creates one LlmAgent per step.

    Deliberately no plan-wide goal is threaded through to executors — only the
    planner/orchestrator holds the whole plan. Every step shares one full
    toolset, so a step told the whole goal (and every other step's job) has
    both the motive and the means to reach for a tool that isn't its own,
    which is exactly how one step ends up sending an email or re-running a
    search another step already owns. Each step's `description` is written by
    the planner to be a complete, standalone instruction on its own.

    tools: ADK tools available to every executor (e.g. the request's MCP
    connectors materialized as tools). `custom_instruction`, if given, is
    prepended to the standard per-step instruction — the actual step
    description is always appended by us, never left to the caller to
    interpolate, so a client prompt that forgets to reference it can't produce
    a step that doesn't know its own task. `tools_for_step` may swap a step's
    tools for step-specific ones — used to stamp the routing token into a mail
    whose reply another step is waiting on. `instruction_for_step` mirrors
    that same pattern for extra instruction text instead of tools — used to
    tell the step directly downstream of an await_reply that the reply it is
    reading may itself carry further instructions (see _build_workflow).
    """
    from . import hitl

    shared_tools = list(tools or [])

    def factory(step: Step, name: str):
        # A dynamically-delegated step (delegate_to_human_agent, or create_task
        # — including kind='await_reply') that already completed: its ORIGINAL
        # run happened inside a throwaway nested Workflow, at a node path
        # ADK's own session replay can't match once resume_turn rebuilds it as
        # a plain top-level node here — so ADK can't tell it already ran.
        # Checked BEFORE the kind-based checks below on purpose: an
        # await_reply step resolved out-of-band (see resume_turn) is marked
        # COMPLETED directly, without ever getting a chance to re-park — if
        # the kind=="await_reply" check ran first it would rebuild a bare
        # wait node regardless of status and re-block it under a fresh
        # interrupt id, discarding the real answer that's already sitting
        # in step.result. Short-circuit with the stored result instead.
        if step.is_dynamic_delegate and step.status == Status.COMPLETED:
            from google.adk.workflow import FunctionNode
            stored_result = step.result or ""

            # Must return types.Content, not a plain string: _function_node.py's
            # _to_event() only populates ev.content (what _apply_event reads
            # the result text from, below) for a Content return — a bare
            # string instead becomes ev.output, which _apply_event never
            # looks at, so the read model would silently get "" for a step
            # that actually already has a real answer.
            async def _replay_stored_result():
                return genai_types.Content(role="model", parts=[genai_types.Part(text=stored_result)])

            return FunctionNode(func=_replay_stored_result, name=name)
        # An "ask" step blocks deterministically asking the user (FunctionNode:
        # its interrupt id is stable across replays, so resume matches — unlike an
        # LLM tool call whose id is random each rerun).
        if step.kind == "ask":
            return hitl.make_ask_user_node(name, step.question or step.description or "Please provide input.")
        # An "await_reply" step parks the same way, but only an incoming email
        # reply can answer it — never the chat.
        if step.kind == "await_reply":
            return hitl.make_await_reply_node(
                name, step.question or step.description or "Awaiting an email reply.")
        # A persona step already has an identity ("You are Rabeb."); a second,
        # contradicting "You are an execution agent" right after undermines it.
        identity = ("You are working on ONE step of a larger plan." if step.is_persona else
                    "You are an execution agent working on ONE step of a larger plan.")
        # "...and nothing else" contradicts a persona's mandate to consult
        # others first — consulting per the role above IS "doing this".
        do_this_line = (
            "Do exactly this — using whatever consultation your role above requires — "
            "and nothing else:" if step.is_persona else
            "Do exactly this and nothing else:")
        # The task ({do_this_line}+{description}) no longer lives in the system
        # prompt: it is delivered as a user turn (see _inject_task_turn), where
        # attention is highest and the shared "run the plan" kickoff otherwise
        # competes with it. So the built-in instruction is resolved with the task
        # placeholders emptied, leaving identity + the invariant rules.
        base_instruction = re.sub(r"\n{3,}", "\n\n", EXECUTOR_INSTRUCTION.format(
            identity=identity, do_this_line="", description="")).strip()
        task_text = f"{do_this_line}\n{step.description}"
        # A dynamic delegate's description is ALREADY the message to relay to
        # assignee_name (composed by the caller, typically second-person:
        # "Hi Firas — ... Do you confirm?") — not an open question this step
        # must draft an as-them answer to. The full persona_preamble below
        # tells the model "you represent {assignee_name} ... get the real
        # decision from {assignee_name} themselves" — for a delegate that is
        # self-referential (you represent Firas, but must also email Firas
        # and await Firas's reply), a real, confirmed trigger for the step
        # stalling on repeated find_human_agents lookups instead of ever
        # sending the email. Give delegates a distinct preamble: relay and
        # wait, no "draft as if you were them" framing.
        if step.is_persona and step.is_dynamic_delegate:
            persona_preamble = (
                f"{step.assignee_name} is being asked the question below "
                "directly by a colleague — the task text below IS the "
                "question to relay, not something for you to answer in "
                f"their place. Your job is to get {step.assignee_name}'s "
                "ACTUAL answer, never invent or guess it: look up their "
                "email via find_human_agents (there is no fixed roster), "
                "send them the question below as a real email, then call "
                "create_task(kind='await_reply') — that hands the actual "
                "waiting off to a separate step, since their real reply can "
                "take hours or days, far longer than this turn can stay "
                "open. Your OWN turn ends right there: report plainly that "
                "you sent it and are awaiting their reply. If a reply from "
                "them settling this has already arrived earlier in THIS "
                "conversation (you are that separate step, now running "
                "with their reply in hand), report their actual answer "
                "directly — instead of emailing again or restating it as "
                "still pending.\n\n"
                f"Before you send anything: if the matter genuinely falls "
                f"outside {step.assignee_name}'s own role or authority, do "
                "what any real colleague would first — find the right "
                "person (find_human_agents) and actually ask them "
                "(delegate_to_human_agent). That becomes its own step and "
                "their answer arrives there, not back here, so don't wait "
                "for it and never invent what they said.\n\n"
                "None of this stops after one round: if their reply itself "
                "asks for another email and another wait, send it and wait "
                "again, for as many rounds as the situation genuinely "
                "takes."
            )
        elif step.is_persona:
            persona_preamble = (
                f"You are an assistant acting for {step.assignee_name} — a real "
                "person at this company. You never answer in their place; your "
                "job is to reach them and get their real words."
                + (f" Their role: {step.assignee_role}" if step.assignee_role else "")
                + "\n\n"
                f"The task below is addressed to {step.assignee_name} and is theirs "
                f"to answer — not something you answer as them. That holds "
                "however easy the answer looks: if it reads as a question about "
                "what they want, have, or plan, you do not know that, and "
                "\"nothing\" or \"none\" is still THEIR answer to give, never "
                "yours to assume. Having no information about it is exactly why "
                "it has to be asked, not grounds to answer it empty.\n\n"
                f"You never make the final call in {step.assignee_name}'s place — "
                "your job is to PREPARE, not decide. Think it through with their "
                "judgment and expertise, draft the analysis, recommendation, or "
                f"answer they would need — then get the actual decision from "
                f"{step.assignee_name} themselves: look up their email via "
                "find_human_agents (there is no fixed roster), send them your "
                "draft as a real email laying out the situation and asking for "
                "their call, then call create_task(kind='await_reply') — that "
                "hands the actual waiting off to a separate step, since their "
                "real reply can take hours or days, far longer than this turn "
                "can stay open. Your OWN turn ends right there: report plainly "
                "that you drafted it, sent it, and are awaiting their reply — "
                "never invent or guess what they'll decide here. A separate "
                "step reads their actual reply once it's in and gives the real, "
                "final answer based on exactly what they said — never on your "
                "own draft. If a reply from them settling this has already "
                "arrived earlier in THIS conversation (you are that separate "
                "step, now running with their reply in hand), treat it as their "
                "real decision and act on it directly — approve, reject, or "
                "proceed accordingly — instead of drafting or emailing again, "
                "or restating it as still pending.\n\n"
                f"Before you draft anything: if the matter genuinely falls "
                f"outside {step.assignee_name}'s own role or authority, do what "
                "any real colleague would first — find the right person "
                "(find_human_agents) and actually ask them "
                "(delegate_to_human_agent). They are a real person who answers "
                "by email in their own time, so that becomes its own step and "
                "their answer arrives THERE, not back here: do not wait for it "
                "and never invent what they said. Say plainly that you asked "
                "them and their answer is pending. You don't reach "
                "out just because a question is hard — only when the authority "
                f"or expertise genuinely isn't {step.assignee_name}'s. If other "
                "real follow-up work turns up that isn't a specific named "
                "colleague's judgment call — a check to run, something to "
                "verify, another email to send and wait on — spin it off "
                "yourself with create_task, which likewise runs as its own "
                "step rather than handing you a result, instead of "
                "writing it down as something still owed. Do this even when you "
                "already have the tool to do that work yourself — spinning it "
                "off keeps it tracked as its own step instead of silently "
                "folded into this one.\n\n"
                "None of this stops after one round: if a reply — theirs, or a "
                "delegate's, or a create_task follow-up's — itself asks for "
                "another email and another wait, send it and wait again, for as "
                "many rounds as the situation genuinely takes. One reply is not "
                "the end by default, whatever it actually takes is."
            )
        else:
            persona_preamble = None
        # A client prompt carrying "{description}" IS the executor instruction,
        # so it REPLACES the built-in one instead of being stacked on top of
        # it. Seen live: the configured prompt was a copy of
        # EXECUTOR_INSTRUCTION, so the step's task and the whole "you are not
        # told the plan's wider goal..." block were sent TWICE, with
        # contradictory framing between the copies — the client's hardcoded
        # "You are an execution agent" / "Do exactly this and nothing else"
        # against the persona-aware "You are working on ONE step" / "using
        # whatever consultation your role above requires". A prompt with no
        # "{description}" cannot carry the task, so it stays an extra preamble
        # ahead of the built-in one, as before.
        #
        # {identity} and {do_this_line} are offered to the client template too,
        # so a custom prompt can opt into the persona-aware wording rather than
        # hardcoding the plain-step one. ADK's instruction templating treats
        # any unresolved "{...}" as a session-variable lookup and raises
        # KeyError, so every token must be substituted here. .replace(), not
        # .format(): the client's text may contain other, incidental braces.
        def _resolve(text: str) -> str:
            return (text.replace("{identity}", identity)
                        .replace("{do_this_line}", do_this_line)
                        .replace("{description}", step.description))

        # A full instruction carries the task itself ({description}); strip that
        # task out to the user turn exactly as the built-in path does — otherwise
        # the agentstore executor prompt (a byte-copy of EXECUTOR_INSTRUCTION,
        # {description} and all) would bake the task back into system and the
        # injection would never fire in production.
        def _resolve_full(text: str) -> str:
            return re.sub(r"\n{3,}", "\n\n",
                          text.replace("{identity}", identity)
                              .replace("{do_this_line}", "")
                              .replace("{description}", "")).strip()

        custom_is_full_instruction = bool(
            custom_instruction and "{description}" in custom_instruction)
        body = _resolve_full(custom_instruction) if custom_is_full_instruction else base_instruction
        mail_reply_instruction = instruction_for_step(step) if instruction_for_step else None
        extra_preamble = None if custom_is_full_instruction or not custom_instruction \
            else _resolve(custom_instruction)
        preambles = [p for p in (extra_preamble, persona_preamble, mail_reply_instruction) if p]
        instruction = "\n\n".join(preambles + [body]) if preambles else body
        step_tools = tools_for_step(step, shared_tools) if tools_for_step else shared_tools
        stop_cb = _stop_after_n_calls(
            MAX_PERSONA_STEP_MODEL_CALLS if step.is_persona else MAX_STEP_MODEL_CALLS,
            model_name, is_persona=step.is_persona, assignee_name=step.assignee_name)
        return LlmAgent(
            name=name,
            model=build_llm(model_name, with_tools=bool(step_tools), temperature=temperature),
            instruction=instruction,
            tools=step_tools,
            output_key=name,  # step result lands in session state under this key
            # Inject the task as the user turn first, then run the call-budget
            # guard on the resulting contents (so its forced-answer fallback also
            # carries the task).
            before_model_callback=_compose_before_model(
                _inject_task_turn(task_text), stop_cb),
        )

    return factory
