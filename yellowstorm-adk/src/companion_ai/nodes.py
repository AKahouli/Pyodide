"""Executor node factory — turns each plan step into an LlmAgent graph node.

The graph accepts an LlmAgent directly as a node (ADK coerces it via
run_llm_agent_as_node), so a step's node is just a per-step LlmAgent whose
instruction is the step description and whose result is written to session
state under the node's name (output_key).

Reuses the project's LLMFactory so model/proxy config stays in one place.
"""
from __future__ import annotations

from typing import Callable, List, Optional

from google.adk.agents import LlmAgent

from .graph import NodeFactory
from .plan import Step

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


def make_llm_node_factory(
    *,
    model_name: str,
    goal: str,
    tools: Optional[List] = None,
    temperature: float = 0.0,
    instruction_for: Optional[Callable[[Step], str]] = None,
) -> NodeFactory:
    """Build a NodeFactory that creates one LlmAgent per step.

    tools: ADK tools available to every executor (e.g. the request's MCP
    connectors materialized as tools). `instruction_for` overrides the default
    per-step prompt if given.
    """
    from . import hitl

    shared_tools = list(tools or [])

    def factory(step: Step, name: str):
        # An "ask" step blocks deterministically asking the user (FunctionNode:
        # its interrupt id is stable across replays, so resume matches — unlike an
        # LLM tool call whose id is random each rerun).
        if step.kind == "ask":
            return hitl.make_ask_user_node(name, step.question or step.description or "Please provide input.")
        instruction = (
            instruction_for(step)
            if instruction_for is not None
            else EXECUTOR_INSTRUCTION.format(goal=goal, description=step.description)
        )
        return LlmAgent(
            name=name,
            model=build_llm(model_name, with_tools=bool(shared_tools), temperature=temperature),
            instruction=instruction,
            tools=shared_tools,
            output_key=name,  # step result lands in session state under this key
        )

    return factory
