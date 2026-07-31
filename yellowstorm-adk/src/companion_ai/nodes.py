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
from .plan import Step

logger = logging.getLogger(__name__)

# ADK's own RunConfig.max_llm_calls is invocation-wide (shared across every
# step in the plan) and hard-aborts the whole run on trip. This caps a
# single step instead, and recovers gracefully.
MAX_STEP_MODEL_CALLS = 15


def _stop_after_n_calls(limit: int, model_name: str):
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
    """
    state = {"n": 0, "forced": False}

    async def _cb(callback_context, llm_request):
        state["n"] += 1
        if state["n"] > limit and not state["forced"]:
            state["forced"] = True
            logger.warning("[worky] step exceeded %d model calls — forcing a final answer", limit)
            from google.adk.models.llm_request import LlmRequest
            nudge = genai_types.Content(role="user", parts=[genai_types.Part(
                text="Stop calling tools now. Give your best answer using only what you "
                     "already know from this conversation so far — do not ask for more "
                     "information and do not say you are unable to answer.")])
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
    whose reply another step is waiting on.
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
            f"You are {step.assignee_name} — a real person at this company."
            + (f" {step.assignee_role}" if step.assignee_role else "")
            + "\n\n"
            f"Act exactly as {step.assignee_name} would in real life: do your "
            "own job yourself, using your own judgment and expertise — you "
            "don't need anyone's permission for what's already inside your "
            "role, and a question that just happens to match your job title "
            "is still your own job to answer, not a reason to go find "
            "yourself. But you're not the only person here: if something "
            "genuinely falls outside your role or authority, do what any "
            "real colleague would — find the right person (find_human_agents, "
            "there is no fixed roster) and actually ask them "
            "(delegate_to_human_agent), then answer using what they told you. "
            "Never invent their answer, never tell the user to go ask someone "
            "else yourself, and never leave your turn on 'I'll check with "
            "so-and-so' without having actually checked. You can't ask "
            "yourself, and you don't reach out just because a question is "
            "hard — only when the authority or expertise genuinely isn't yours."
        ) if step.is_persona else None
        # A client prompt may carry a literal "{description}" token (see
        # PROMPTS.txt); ADK's instruction templating treats any unresolved
        # "{...}" as a session-variable lookup and raises KeyError, so this
        # must be substituted here too. .replace(), not .format(): the
        # client's text may contain other, incidental braces.
        custom_instruction_resolved = (
            custom_instruction.replace("{description}", step.description)
            if custom_instruction else None)
        preambles = [p for p in (custom_instruction_resolved, persona_preamble) if p]
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
            before_model_callback=_stop_after_n_calls(MAX_STEP_MODEL_CALLS, model_name),
        )

    return factory
