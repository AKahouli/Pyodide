from __future__ import annotations

import json
import time
from dataclasses import dataclass
from typing import Any, List

import litellm
from langgraph.types import interrupt
from structlog import get_logger
from src.flow_engine.tools.langchain_factory import _last_mcp_actual_args

from src.config.settings import get_settings
from src.flow_engine.nodes.step_hitl import (
    _build_interrupt_payload,
    extract_interrupt_message,
    normalize_interrupt_action,
)

logger = get_logger(__name__)
settings = get_settings()

MAX_TOOL_ITERATIONS = 50
MAX_IMAGES_PER_ITERATION = 50
MAX_IMAGES_TOTAL = 50


@dataclass(frozen=True)
class ToolHitlApprovalContext:
    hitl_policy: dict[str, Any]
    hitl_blockers: list[dict[str, Any]]
    node_id: str
    label: str
    iteration: int
    writer: Any


def _parse_tool_result(result: Any) -> Any:
    if isinstance(result, str):
        try:
            return json.loads(result)
        except (json.JSONDecodeError, ValueError):
            return result
    return result


def _extract_images_from_result(result: Any) -> List[str]:
    images = []
    if isinstance(result, dict):
        for k, v in result.items():
            if k == "image_base64" and isinstance(v, str) and v:
                images.append(v)
            else:
                images.extend(_extract_images_from_result(v))
    elif isinstance(result, list):
        for item in result:
            images.extend(_extract_images_from_result(item))
    return images


def _strip_images_from_tool_result(result: Any) -> Any:
    if isinstance(result, dict):
        return {k: _strip_images_from_tool_result(v) for k, v in result.items() if k != "image_base64"}
    if isinstance(result, list):
        return [_strip_images_from_tool_result(item) for item in result]
    return result


def _compress_tool_json(data: Any) -> Any:
    """Remove redundant blocks array when a content summary string is already present."""
    if isinstance(data, dict):
        if isinstance(data.get("blocks"), list) and isinstance(data.get("content"), str):
            data = {k: v for k, v in data.items() if k != "blocks"}
        return {k: _compress_tool_json(v) for k, v in data.items()}
    if isinstance(data, list):
        return [_compress_tool_json(item) for item in data]
    return data


def _build_tool_text_content(result: Any) -> str:
    parsed = _parse_tool_result(result)
    cleaned = _compress_tool_json(_strip_images_from_tool_result(parsed))
    return cleaned if isinstance(cleaned, str) else json.dumps(cleaned, default=str)


def _cap_images_in_messages(messages: list[dict[str, Any]], max_images: int = MAX_IMAGES_TOTAL) -> list[dict[str, Any]]:
    """Keep the most recent images, replace older ones with a text note when over the limit."""
    def _count_images(msg: dict) -> int:
        content = msg.get("content")
        if isinstance(content, list):
            return sum(1 for b in content if isinstance(b, dict) and b.get("type") == "image_url")
        return 0

    counts = [_count_images(m) for m in messages]
    if sum(counts) <= max_images:
        return messages

    budget = max_images
    keep_flags = []
    for count in reversed(counts):
        if budget >= count:
            keep_flags.append(True)
            budget -= count
        else:
            keep_flags.append(False)
    keep_flags.reverse()

    result = list(messages)
    dropped = 0
    for i, (msg, should_keep, count) in enumerate(zip(messages, keep_flags, counts)):
        if should_keep or count == 0:
            continue
        content = msg.get("content")
        if isinstance(content, list):
            text_blocks = [b for b in content if isinstance(b, dict) and b.get("type") == "text"]
            text_blocks.append({"type": "text", "text": f"[{count} image(s) removed — global {max_images}-image limit reached]"})
            result[i] = {**msg, "content": text_blocks}
        dropped += count

    logger.warning("Global image cap applied", total=sum(counts), kept=sum(counts) - dropped, dropped=dropped)
    return result


def build_agent_config(metadata: dict[str, Any]) -> dict[str, Any]:
    agent_params = metadata.get("agent_params")
    if not isinstance(agent_params, dict):
        agent_params = {}

    agent_tools = metadata.get("agent_tools")
    if not isinstance(agent_tools, list):
        agent_tools = []

    return {
        "name": str(metadata.get("agent_name") or ""),
        "type": str(metadata.get("agent_type") or metadata.get("type") or ""),
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
    trace_collector: Any = None,
    hitl_approval: ToolHitlApprovalContext | None = None,
) -> str:
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_msg},
    ]
    tool_map = {tool.name: tool for tool in tools}
    tool_definitions = [_tool_to_openai_definition(tool) for tool in tools]

    for _ in range(MAX_TOOL_ITERATIONS):
        if trace_collector is not None:
            trace_collector.record_prompt(
                stage=f"tool_iteration_{len(messages)}",
                model=model_id,
                prompt=_messages_to_trace_prompt(messages),
            )
        response = await litellm.acompletion(
            model=model_id,
            messages=messages,
            temperature=0,
            max_tokens=32000,
            tools=tool_definitions,
            tool_choice="auto",
        )
        if trace_collector is not None:
            from src.flow_engine.observability.usage_extractor import extract_usage

            trace_collector.record_usage(extract_usage(response, model_id))
        message = _message_to_dict(response.choices[0].message)
        tool_calls = message.get("tool_calls") or []
        messages.append({
            "role": "assistant",
            "content": message.get("content", ""),
            "tool_calls": tool_calls,
        })

        if not tool_calls:
            return str(message.get("content") or "")

        iteration_images: List[str] = []
        for tool_call in tool_calls:
            function_payload = tool_call.get("function") or {}
            tool_name = str(function_payload.get("name") or "")
            tool = tool_map.get(tool_name)
            if tool is None:
                raise ValueError(f"Unknown tool requested by model: {tool_name}")

            raw_arguments = function_payload.get("arguments") or "{}"
            tool_arguments = json.loads(raw_arguments) if isinstance(raw_arguments, str) else raw_arguments
            skip_content = _resolve_tool_hitl_approval(
                tool_name=tool_name,
                tool_arguments=tool_arguments if isinstance(tool_arguments, dict) else {},
                context=hitl_approval,
            )
            if skip_content is not None:
                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.get("id", ""),
                    "name": tool_name,
                    "content": skip_content,
                })
                continue
            started_at = time.perf_counter()
            try:
                tool_result = await tool.ainvoke(tool_arguments)
                duration_ms = int((time.perf_counter() - started_at) * 1000)
                tool_content = _build_tool_text_content(tool_result)
                actual_args = _last_mcp_actual_args.get() or (tool_arguments if isinstance(tool_arguments, dict) else {})
                _last_mcp_actual_args.set({})
                if trace_collector is not None:
                    trace_collector.record_tool_call(
                        tool_name=tool_name,
                        args=actual_args,
                        output_summary=tool_content[:500],
                        status="completed",
                        duration_ms=duration_ms,
                    )
            except Exception as exc:
                duration_ms = int((time.perf_counter() - started_at) * 1000)
                actual_args_err = _last_mcp_actual_args.get() or (tool_arguments if isinstance(tool_arguments, dict) else {})
                _last_mcp_actual_args.set({})
                if trace_collector is not None:
                    trace_collector.record_tool_call(
                        tool_name=tool_name,
                        args=actual_args_err,
                        output_summary=None,
                        status="failed",
                        duration_ms=duration_ms,
                        error=str(exc),
                    )
                raise
            if on_progress is not None:
                on_progress(f"[tool-result] {tool_name}\n")
            messages.append({
                "role": "tool",
                "tool_call_id": tool_call.get("id", ""),
                "name": tool_name,
                "content": tool_content,
            })
            parsed = _parse_tool_result(tool_result)
            iteration_images.extend(_extract_images_from_result(parsed))

        if iteration_images:
            capped = iteration_images[:MAX_IMAGES_PER_ITERATION]
            if len(iteration_images) > MAX_IMAGES_PER_ITERATION:
                logger.warning("Images capped per iteration", total=len(iteration_images), kept=MAX_IMAGES_PER_ITERATION)
            vision_blocks: List[dict[str, Any]] = [
                {"type": "text", "text": f"Images from tool results ({len(capped)} image(s)):"}
            ]
            for b64 in capped:
                vision_blocks.append({"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}})
            messages.append({"role": "user", "content": vision_blocks})
            logger.info("Vision images injected", image_count=len(capped))

        messages = _cap_images_in_messages(messages)

    raise RuntimeError("Max tool iterations reached without a final response")


def _resolve_tool_hitl_approval(
    tool_name: str,
    tool_arguments: dict[str, Any],
    context: ToolHitlApprovalContext | None,
) -> str | None:
    if context is None:
        return None
    if context.hitl_policy.get("mode") != "auto" or _policy_disabled(context.hitl_policy, "approvalEnabled"):
        return None
    blocker = _matching_tool_blocker(tool_name, tool_arguments, context.hitl_blockers)
    if blocker is None:
        return None
    payload = _build_interrupt_payload(
        "approval_request",
        str(blocker.get("message") or f"Tool '{tool_name}' needs approval before it runs."),
        node_id=context.node_id,
        label=context.label or context.node_id,
        node_description=f"Tool call: {tool_name}",
        round_number=context.iteration + 1,
        resumable_actions=["approve", "reject", "skip"],
        reason_code=str(blocker.get("reasonCode") or blocker.get("reason_code") or blocker.get("kind") or "tool_approval_required"),
        risk_level=str(blocker.get("riskLevel") or blocker.get("risk_level") or "critical"),
        feedback_scope_default="step_only",
        blocker_rule_id=str(blocker.get("id") or "") or None,
        blocker_kind=str(blocker.get("kind") or "tool_action"),
    )
    if context.writer is not None:
        context.writer({"type": "NodeSuspended", "node_id": context.node_id, "iteration": context.iteration, "payload": payload})
    response = interrupt(payload)
    action = normalize_interrupt_action(response, "approval_request")
    if action == "approve":
        return None
    if action == "skip":
        return json.dumps({"status": "skipped_by_human", "tool": tool_name})
    message = extract_interrupt_message(response) or f"Tool '{tool_name}' rejected by human"
    raise PermissionError(message)


def _policy_disabled(hitl_policy: dict[str, Any], key: str) -> bool:
    legacy_key = "approvalsEnabled" if key == "approvalEnabled" else key
    value = hitl_policy.get(key, hitl_policy.get(legacy_key))
    return value is False


def _matching_tool_blocker(
    tool_name: str,
    tool_arguments: dict[str, Any],
    hitl_blockers: list[dict[str, Any]],
) -> dict[str, Any] | None:
    tool_text = " ".join([tool_name, json.dumps(tool_arguments, default=str)]).lower()
    for blocker in hitl_blockers:
        if blocker.get("enabled") is False:
            continue
        if str(blocker.get("createdBy") or blocker.get("created_by") or "") != "user":
            continue
        if str(blocker.get("kind") or "") not in {"destructive_action", "external_send", "workspace_write"}:
            continue
        if _matches_any(tool_text, blocker.get("appliesToConnectorActions")):
            return blocker
        matcher_config = blocker.get("matcherConfig") or blocker.get("matcher_config")
        if isinstance(matcher_config, dict) and _matches_any(tool_text, matcher_config.get("verbs")):
            return blocker
    return None


def _matches_any(text: str, patterns: Any) -> bool:
    if not isinstance(patterns, list):
        return False
    return any(str(pattern or "").strip().lower() in text for pattern in patterns if str(pattern or "").strip())


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


def _messages_to_trace_prompt(messages: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    for message in messages:
        role = str(message.get("role") or "unknown")
        content = _content_to_text(message.get("content"))
        if content:
            parts.append(f"[{role}] {content}")
        tool_calls = message.get("tool_calls") or []
        if tool_calls:
            parts.append(f"[{role}.tool_calls] {json.dumps(tool_calls, default=str)}")
    return "\n\n".join(parts)
