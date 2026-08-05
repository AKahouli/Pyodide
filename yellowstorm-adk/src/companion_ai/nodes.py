"""Executor node factory — turns each plan step into an LlmAgent graph node.

The graph accepts an LlmAgent directly as a node (ADK coerces it via
run_llm_agent_as_node), so a step's node is just a per-step LlmAgent whose
instruction is the step description and whose result is written to session
state under the node's name (output_key).

Reuses the project's LLMFactory so model/proxy config stays in one place.
"""
from __future__ import annotations

import logging
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
    """
    state = {"n": 0, "forced": False}

    async def _cb(callback_context, llm_request):
        state["n"] += 1
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

EXECUTOR_INSTRUCTION = """{identity}

{do_this_line}
{description}

You are not told the plan's wider goal or its other steps, on purpose — the
planner already wrote your task above as a complete, standalone instruction,
and every other step in this plan has the SAME toolset you do (including
things like sending email). Reaching for one of those tools because it looks
useful for the overall task is another step's job, not yours.

Use the available tools when needed. For a LONG-RUNNING action (e.g. setting a
reminder for hours, scheduling a delayed job), call the `schedule_*_task` tool so
it starts in the background and returns immediately — never wait for it to finish.
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
    app_settings = get_settings()
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


def stamp_send_email_tool(tool, *, token_provider: Callable[[], Awaitable[Optional[str]]]):
    """Wrap a send_email tool so the outbound mail carries its routing token.

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
        return await original(**kwargs)

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
        # A dynamically-delegated step (delegate_to_human_agent) that already
        # completed: its ORIGINAL run happened inside a throwaway nested
        # Workflow, at a node path ADK's own session replay can't match once
        # resume_turn rebuilds it as a plain top-level node here — so ADK
        # can't tell it already ran and would otherwise silently re-call the
        # LLM, producing a different answer and discarding the original.
        # Short-circuit with the stored result instead of risking that.
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
        base_instruction = EXECUTOR_INSTRUCTION.format(
            identity=identity, do_this_line=do_this_line, description=step.description)
        persona_preamble = (
            f"You represent {step.assignee_name} — a real person at this company."
            + (f" {step.assignee_role}" if step.assignee_role else "")
            + "\n\n"
            f"You never make the final call in {step.assignee_name}'s place — "
            "your job is to PREPARE, not decide. Think it through with their "
            "judgment and expertise, draft the analysis, recommendation, or "
            f"answer they would need — then get the actual decision from "
            f"{step.assignee_name} themselves: look up their email via "
            "find_human_agents (there is no fixed roster), send them your "
            "draft as a real email laying out the situation and asking for "
            "their call, then call create_task(kind='await_reply') to wait "
            "for their real reply. Give your final answer only once that "
            "reply is in, based on exactly what they said — never on your "
            "own draft, and never invented or assumed. If a reply from them "
            "settling this already arrived earlier in this conversation, "
            "treat it as their real decision and act on it directly — "
            "approve, reject, or proceed accordingly — instead of emailing "
            "again or restating it as still pending.\n\n"
            f"Before you draft anything: if the matter genuinely falls "
            f"outside {step.assignee_name}'s own role or authority, do what "
            "any real colleague would first — find the right person "
            "(find_human_agents) and actually ask them "
            "(delegate_to_human_agent), then fold what they told you into "
            f"the draft that goes to {step.assignee_name}. Never invent "
            "their input, and never leave your turn on 'I'll check with "
            "so-and-so' without having actually checked. You don't reach "
            "out just because a question is hard — only when the authority "
            f"or expertise genuinely isn't {step.assignee_name}'s. If other "
            "real follow-up work turns up that isn't a specific named "
            "colleague's judgment call — a check to run, something to "
            "verify, another email to send and wait on — spin it off "
            "yourself with create_task and use its result, instead of "
            "writing it down as something still owed."
        ) if step.is_persona else None
        # A client prompt may carry a literal "{description}" token (see
        # PROMPTS.txt); ADK's instruction templating treats any unresolved
        # "{...}" as a session-variable lookup and raises KeyError, so this
        # must be substituted here too. .replace(), not .format(): the
        # client's text may contain other, incidental braces.
        custom_instruction_resolved = (
            custom_instruction.replace("{description}", step.description)
            if custom_instruction else None)
        mail_reply_instruction = instruction_for_step(step) if instruction_for_step else None
        preambles = [p for p in (custom_instruction_resolved, persona_preamble, mail_reply_instruction) if p]
        instruction = "\n\n".join(preambles + [base_instruction]) if preambles else base_instruction
        step_tools = tools_for_step(step, shared_tools) if tools_for_step else shared_tools
        tool_names = [getattr(getattr(t, "func", None), "__name__", "?") for t in step_tools]
        logger.info("[worky] 8. step=%s executor context:\n--- instruction ---\n%s\n"
                    "--- tools (%d) ---\n%s", step.id, instruction, len(tool_names), tool_names)
        return LlmAgent(
            name=name,
            model=build_llm(model_name, with_tools=bool(step_tools), temperature=temperature),
            instruction=instruction,
            tools=step_tools,
            output_key=name,  # step result lands in session state under this key
            before_model_callback=_stop_after_n_calls(
                MAX_PERSONA_STEP_MODEL_CALLS if step.is_persona else MAX_STEP_MODEL_CALLS,
                model_name, is_persona=step.is_persona, assignee_name=step.assignee_name),
        )

    return factory
