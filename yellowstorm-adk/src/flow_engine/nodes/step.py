"""Step node implementation.

A step node executes a single task (LLM call + tool invocations).
Uses LangGraph's ``get_stream_writer()`` for lifecycle events and
token-level streaming via ``litellm.acompletion(stream=True)``.
Agent config is read from ``metadata.agent`` (resolved by the backend).

Output is stored into task_outputs[(node_id, iteration)].
"""

from __future__ import annotations

import json
from typing import Any

import litellm
from structlog import get_logger
from langgraph.config import get_stream_writer

from src.config.settings import get_settings
from src.flow_engine.state import ExecutionState

logger = get_logger(__name__)
settings = get_settings()

DEFAULT_MODEL = "gpt-4o-mini"


def _build_prompt(
    input_context: dict[str, Any],
    label: str,
    agent_description: str = "",
) -> str:
    lines = [f"Task: {label}"]
    if agent_description:
        lines.append(f"Context: {agent_description}")
    if input_context:
        lines.append(f"Input: {json.dumps(input_context, indent=2, default=str)}")
    lines.append("Provide your response:")
    return "\n".join(lines)


async def run_step(
    node_id: str,
    node_config: dict[str, Any],
    state: ExecutionState,
) -> dict[str, Any]:
    iteration = state["iterations"].get(node_id, 0)
    label = str(node_config.get("label") or node_id)
    metadata = node_config.get("metadata", {})
    if not isinstance(metadata, dict):
        metadata = {}

    agent_name = str(metadata.get("agent_name") or "")
    agent_description = str(metadata.get("agent_description") or "")
    agent_model = metadata.get("agent_model") or node_config.get("model_id")
    agent_prompt = str(metadata.get("agent_prompt") or "")

    model_id = str(agent_model or DEFAULT_MODEL)
    system_prompt = str(agent_prompt or metadata.get("system_prompt", "") or f"You are executing the step: {label}. Respond concisely.")
    has_agent = bool(agent_name)

    logger.info(
        "[step] Running step node",
        node_id=node_id,
        iteration=iteration,
        model=model_id,
        has_agent=has_agent,
        agent_name=agent_name,
        agent_model=agent_model,
        node_model_id=node_config.get("model_id"),
    )

    writer = get_stream_writer()
    writer({
        "type": "NodeStarted",
        "node_id": node_id,
        "iteration": iteration,
        "payload": {"label": label},
    })

    input_context = state.get("inputs", {})
    user_msg = _build_prompt(input_context, label, agent_description)

    try:
        litellm.api_base = settings.LITELLM_API_BASE_URL
        litellm.api_key = settings.LITELLM_API_SECRET_KEY
        litellm.drop_params = True

        response = await litellm.acompletion(
            model=model_id,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_msg},
            ],
            temperature=0.7,
            max_tokens=4096,
            stream=True,
        )

        full_output = ""
        async for chunk in response:
            delta = chunk.choices[0].delta
            token = delta.content or ""
            if token:
                full_output += token
                writer({
                    "type": "NodeToken",
                    "node_id": node_id,
                    "iteration": iteration,
                    "token": token,
                })

            if hasattr(delta, "model_extra") and delta.model_extra and "tool_calls" in (delta.model_extra or {}):
                writer({
                    "type": "NodeToken",
                    "node_id": node_id,
                    "iteration": iteration,
                    "token": str(delta.model_extra.get("tool_calls", "")),
                })

        logger.info("[step] Step completed", node_id=node_id, streamed_chars=len(full_output))

        result_payload = {
            "node_id": node_id,
            "iteration": iteration,
            "output": full_output,
        }
        writer({
            "type": "NodeCompleted",
            "node_id": node_id,
            "iteration": iteration,
            "payload": result_payload,
        })

        return {
            "task_outputs": {(node_id, iteration): result_payload},
            "iterations": {node_id: iteration + 1},
        }

    except Exception as exc:
        logger.error("[step] LLM call failed", node_id=node_id, error=str(exc))
        writer({
            "type": "NodeFailed",
            "node_id": node_id,
            "iteration": iteration,
            "payload": {"error": str(exc)},
        })
        return {
            "errors": [{"node_id": node_id, "iteration": iteration, "message": f"LLM error: {exc}"}],
            "iterations": {node_id: iteration + 1},
        }
