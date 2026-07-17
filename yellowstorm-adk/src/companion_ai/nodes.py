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

from . import mail_token
from .graph import NodeFactory
from .plan import Step

logger = logging.getLogger(__name__)

EXECUTOR_INSTRUCTION = """You are an execution agent working on ONE step of a larger plan.

Overall goal (context only): {goal}

Your task — do exactly this and nothing else:
{description}

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
    goal: str,
    tools: Optional[List] = None,
    temperature: float = 0.0,
    instruction_for: Optional[Callable[[Step], str]] = None,
    tools_for_step: Optional[Callable[[Step, List], List]] = None,
) -> NodeFactory:
    """Build a NodeFactory that creates one LlmAgent per step.

    tools: ADK tools available to every executor (e.g. the request's MCP
    connectors materialized as tools). `instruction_for` overrides the default
    per-step prompt if given. `tools_for_step` may swap a step's tools for
    step-specific ones — used to stamp the routing token into a mail whose reply
    another step is waiting on.
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
        instruction = (
            instruction_for(step)
            if instruction_for is not None
            else EXECUTOR_INSTRUCTION.format(goal=goal, description=step.description)
        )
        step_tools = tools_for_step(step, shared_tools) if tools_for_step else shared_tools
        return LlmAgent(
            name=name,
            model=build_llm(model_name, with_tools=bool(step_tools), temperature=temperature),
            instruction=instruction,
            tools=step_tools,
            output_key=name,  # step result lands in session state under this key
        )

    return factory
