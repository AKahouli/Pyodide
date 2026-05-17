from __future__ import annotations

import json
from typing import Any

import litellm
from structlog import get_logger

logger = get_logger(__name__)

MAX_TOOL_ITERATIONS = 10


def build_agent_config(metadata: dict[str, Any]) -> dict[str, Any]:
    agent_params = metadata.get("agent_params")
    if not isinstance(agent_params, dict):
        agent_params = {}

    agent_tools = metadata.get("agent_tools")
    if not isinstance(agent_tools, list):
        agent_tools = []

    return {
        "name": str(metadata.get("agent_name") or ""),
        "tools": [tool for tool in agent_tools if isinstance(tool, dict)],
        "agent_params": agent_params,
        "brain_ids": _extract_brain_ids(metadata.get("brain_context")),
    }


def parse_connector_bindings(
    metadata: dict[str, Any],
    agent_params: dict[str, Any],
) -> list[dict[str, Any]]:
    connector_bindings = metadata.get("connector_bindings")
    if isinstance(connector_bindings, list):
        return [item for item in connector_bindings if isinstance(item, dict)]

    raw_connector_bindings = agent_params.get("connector_bindings_json")
    if not isinstance(raw_connector_bindings, str) or not raw_connector_bindings.strip():
        return []

    try:
        parsed = json.loads(raw_connector_bindings)
    except json.JSONDecodeError:
        logger.warning("[step] Failed to parse connector_bindings_json")
        return []

    if not isinstance(parsed, list):
        return []
    return [item for item in parsed if isinstance(item, dict)]


async def run_step_with_tools(
    model_id: str,
    system_prompt: str,
    user_msg: str,
    tools: list[Any],
    on_progress: Any = None,
) -> str:
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_msg},
    ]
    tool_map = {tool.name: tool for tool in tools}
    tool_definitions = [_tool_to_openai_definition(tool) for tool in tools]

    for _ in range(MAX_TOOL_ITERATIONS):
        response = await litellm.acompletion(
            model=model_id,
            messages=messages,
            temperature=0.7,
            max_tokens=4096,
            tools=tool_definitions,
            tool_choice="auto",
        )
        message = _message_to_dict(response.choices[0].message)
        tool_calls = message.get("tool_calls") or []
        messages.append({
            "role": "assistant",
            "content": message.get("content", ""),
            "tool_calls": tool_calls,
        })

        if not tool_calls:
            return str(message.get("content") or "")

        for tool_call in tool_calls:
            function_payload = tool_call.get("function") or {}
            tool_name = str(function_payload.get("name") or "")
            tool = tool_map.get(tool_name)
            if tool is None:
                raise ValueError(f"Unknown tool requested by model: {tool_name}")
            if on_progress is not None:
                on_progress(f"[tool] {tool_name}\n")

            raw_arguments = function_payload.get("arguments") or "{}"
            tool_arguments = json.loads(raw_arguments) if isinstance(raw_arguments, str) else raw_arguments
            tool_result = await tool.ainvoke(tool_arguments)
            tool_content = tool_result if isinstance(tool_result, str) else json.dumps(tool_result, default=str)
            if on_progress is not None:
                on_progress(f"[tool-result] {tool_name}\n")
            messages.append({
                "role": "tool",
                "tool_call_id": tool_call.get("id", ""),
                "name": tool_name,
                "content": tool_content,
            })

    raise RuntimeError("Max tool iterations reached without a final response")


def _extract_brain_ids(brain_context: Any) -> list[str]:
    if not isinstance(brain_context, list):
        return []

    brain_ids: list[str] = []
    for item in brain_context:
        if not isinstance(item, dict):
            continue
        workspace_id = str(item.get("workspace_id") or "").strip()
        if workspace_id:
            brain_ids.append(workspace_id)
    return brain_ids


def _content_to_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
                continue
            if isinstance(item, dict):
                text = item.get("text")
                if isinstance(text, str):
                    parts.append(text)
        return "".join(parts)
    return str(content or "")


def _normalize_tool_calls(raw_tool_calls: Any) -> list[dict[str, Any]]:
    if not isinstance(raw_tool_calls, list):
        return []

    normalized: list[dict[str, Any]] = []
    for raw_call in raw_tool_calls:
        if isinstance(raw_call, dict):
            call = dict(raw_call)
        elif hasattr(raw_call, "model_dump"):
            call = raw_call.model_dump()
        else:
            function = getattr(raw_call, "function", None)
            call = {
                "id": getattr(raw_call, "id", ""),
                "type": getattr(raw_call, "type", "function"),
                "function": {
                    "name": getattr(function, "name", ""),
                    "arguments": getattr(function, "arguments", "{}"),
                },
            }

        function_payload = call.get("function") or {}
        if not isinstance(function_payload, dict):
            function_payload = {
                "name": getattr(function_payload, "name", ""),
                "arguments": getattr(function_payload, "arguments", "{}"),
            }

        normalized.append({
            "id": str(call.get("id") or ""),
            "type": str(call.get("type") or "function"),
            "function": {
                "name": str(function_payload.get("name") or ""),
                "arguments": function_payload.get("arguments") or "{}",
            },
        })

    return normalized


def _message_to_dict(message: Any) -> dict[str, Any]:
    if isinstance(message, dict):
        payload = dict(message)
    elif hasattr(message, "model_dump"):
        payload = message.model_dump()
    else:
        payload = {
            "content": getattr(message, "content", ""),
            "tool_calls": getattr(message, "tool_calls", None),
        }

    payload["content"] = _content_to_text(payload.get("content"))
    payload["tool_calls"] = _normalize_tool_calls(payload.get("tool_calls"))
    return payload


def _tool_to_openai_definition(tool: Any) -> dict[str, Any]:
    args_schema = getattr(tool, "args_schema", None)
    parameters = {"type": "object", "properties": {}}
    if args_schema is not None and hasattr(args_schema, "model_json_schema"):
        parameters = args_schema.model_json_schema()

    return {
        "type": "function",
        "function": {
            "name": tool.name,
            "description": getattr(tool, "description", "") or "",
            "parameters": parameters,
        },
    }
