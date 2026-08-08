import json
from typing import Any

import litellm
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage
from langgraph.runtime import Runtime

from src.flow_engine.agent_runtime.context import StepRuntimeContext
from src.flow_engine.agent_runtime.state import StepAgentState
from src.flow_engine.agent_runtime.tracing import messages_to_trace_prompt, notify_trace
from src.flow_engine.observability.usage_extractor import extract_usage
from src.guardrails.models import GuardrailContext
from src.guardrails.runtime import GuardrailRuntime
from src.guardrails.config import resolve_effective_guardrails
from src.smart_rag.infrastructure.model_parameters import normalize_temperature_for_model


def _message_payload(message: BaseMessage) -> dict[str, Any]:
    if isinstance(message, SystemMessage):
        return {"role": "system", "content": message.content}
    if isinstance(message, HumanMessage):
        return {"role": "user", "content": message.content}
    if isinstance(message, ToolMessage):
        return {"role": "tool", "content": message.content, "tool_call_id": message.tool_call_id, "name": message.name}
    payload: dict[str, Any] = {"role": "assistant", "content": message.content}
    if isinstance(message, AIMessage) and message.tool_calls:
        payload["tool_calls"] = [{"id": call["id"], "type": "function", "function": {"name": call["name"], "arguments": json.dumps(call.get("args") or {})}} for call in message.tool_calls]
    return payload


def _tool_calls(raw: Any) -> list[dict[str, Any]]:
    calls = (raw.get("tool_calls") if isinstance(raw, dict) else getattr(raw, "tool_calls", None)) or []
    result = []
    for call in calls:
        payload = call.model_dump() if hasattr(call, "model_dump") else call if isinstance(call, dict) else {}
        function = payload.get("function") or {}
        arguments = function.get("arguments") or "{}"
        try:
            args = json.loads(arguments) if isinstance(arguments, str) else arguments
        except Exception:
            args = {}
        result.append({"id": str(payload.get("id") or ""), "name": str(function.get("name") or ""), "args": args, "type": "tool_call"})
    return result


def _text_only_messages(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized = []
    for message in messages:
        copied = dict(message)
        content = copied.get("content")
        if isinstance(content, list):
            copied["content"] = [
                {"type": "text", "text": str(block.get("text") or "")}
                for block in content
                if isinstance(block, dict) and block.get("text") is not None
            ]
        normalized.append(copied)
    return normalized


def _requires_text_only(exc: Exception) -> bool:
    message = str(exc).lower()
    return "messages.content.type" in message and "allowed values" in message and "text" in message


def _ordered_tool_results(messages: list[BaseMessage]) -> list[BaseMessage]:
    last_ai = max((index for index, message in enumerate(messages) if isinstance(message, AIMessage)), default=-1)
    if last_ai < 0:
        return messages
    tail = messages[last_ai + 1:]
    if not any(isinstance(message, ToolMessage) for message in tail):
        return messages
    return [*messages[:last_ai + 1], *[message for message in tail if isinstance(message, ToolMessage)], *[message for message in tail if not isinstance(message, ToolMessage)]]


def _limit_images(messages: list[dict[str, Any]], limit: int = 50) -> list[dict[str, Any]]:
    remaining = limit
    result = []
    for message in messages:
        copied = dict(message)
        content = copied.get("content")
        if isinstance(content, list):
            blocks = []
            for block in content:
                is_image = isinstance(block, dict) and block.get("type") in {"image_url", "input_image"}
                if is_image:
                    if remaining <= 0:
                        continue
                    remaining -= 1
                blocks.append(block)
            copied["content"] = blocks
        result.append(copied)
    return result


def build_model_node(tools: list[Any]):
    guardrails = GuardrailRuntime()
    definitions = [{"type": "function", "function": {"name": tool.name, "description": getattr(tool, "description", "") or "", "parameters": tool.args_schema.model_json_schema() if getattr(tool, "args_schema", None) is not None else {"type": "object", "properties": {}}}} for tool in tools]

    async def model_node(state: StepAgentState, runtime: Runtime[StepRuntimeContext]) -> dict[str, Any]:
        context = runtime.context
        messages = list(state.get("messages") or [])
        next_iteration = int(state.get("tool_iterations") or 0) + (1 if messages and isinstance(messages[-1], ToolMessage) else 0)
        if next_iteration >= context.max_tool_iterations:
            return {"messages": [AIMessage(content="Max tool iterations reached without a final response")], "tool_iterations": next_iteration}

        pending = []
        for message in reversed(messages):
            if isinstance(message, (HumanMessage, ToolMessage)):
                pending.append(str(message.content))
                if isinstance(message, HumanMessage):
                    break
            elif pending:
                break
        input_text = "\n\n".join(reversed(pending))
        if input_text:
            reviewed = await guardrails.review_model_input(input_text, GuardrailContext(
                phase="model_input", runtime_surface=context.runtime_surface, source="tool_result" if messages and isinstance(messages[-1], ToolMessage) else "task_input",
                user_id=context.user_id, agent_id=context.agent_id, agent_name=context.agent_name,
                flow_id=context.flow_id, execution_id=context.execution_id, node_id=context.node_id,
                iteration=context.iteration, original_user_request=context.original_user_request,
                task_instruction=context.task_instruction,
            ), context.agent_config)
            if reviewed.blocked:
                return {"messages": [AIMessage(content=reviewed.text)], "guardrail_blocked": True, "guardrail_reason": reviewed.reason, "tool_iterations": next_iteration}
            if reviewed.sanitized and messages:
                messages[-1] = HumanMessage(content=reviewed.text)

        messages = _ordered_tool_results(messages)
        request_messages = _limit_images([_message_payload(message) for message in messages])
        if context.trace_collector is not None:
            context.trace_collector.record_prompt(f"model_iteration_{next_iteration}", context.model_id, messages_to_trace_prompt(messages))
            notify_trace(context)
        kwargs: dict[str, Any] = {
            "model": context.model_id, "messages": request_messages,
            "temperature": normalize_temperature_for_model(context.model_id, 0 if tools else 0.7),
            "max_tokens": 32000,
        }
        if definitions:
            kwargs.update({"tools": definitions, "tool_choice": "auto", "parallel_tool_calls": False})
        output_guard_enabled = resolve_effective_guardrails(context.agent_config).prompt_injection.output_enabled
        if not tools and not output_guard_enabled:
            response = await litellm.acompletion(**kwargs, stream=True)
            content = ""
            async for chunk in response:
                token = str(getattr(chunk.choices[0].delta, "content", "") or "")
                if token:
                    content += token
                    if context.on_progress is not None:
                        context.on_progress(token)
            calls: list[dict[str, Any]] = []
            if context.trace_collector is not None:
                context.trace_collector.record_usage(extract_usage(response, context.model_id))
                context.trace_collector.record_prompt_output(content)
                notify_trace(context)
            return {"messages": [AIMessage(content=content)], "tool_iterations": next_iteration}

        try:
            response = await litellm.acompletion(**kwargs)
        except Exception as exc:
            if not _requires_text_only(exc):
                raise
            response = await litellm.acompletion(**{**kwargs, "messages": _text_only_messages(request_messages)})
        if context.trace_collector is not None:
            context.trace_collector.record_usage(extract_usage(response, context.model_id))
        raw = response.choices[0].message
        content = str((raw.get("content") if isinstance(raw, dict) else getattr(raw, "content", "")) or "")
        calls = _tool_calls(raw)
        if content and not calls:
            reviewed_output = await guardrails.review_model_output(content, GuardrailContext(
                phase="model_output", runtime_surface=context.runtime_surface,
                user_id=context.user_id, agent_id=context.agent_id, agent_name=context.agent_name,
                flow_id=context.flow_id, execution_id=context.execution_id, node_id=context.node_id,
                iteration=context.iteration,
            ), context.agent_config)
            content = reviewed_output.text
            if context.on_progress is not None:
                context.on_progress(content)
        if context.trace_collector is not None:
            context.trace_collector.record_prompt_output(content)
            notify_trace(context)
        return {"messages": [AIMessage(content=content, tool_calls=calls)], "tool_iterations": next_iteration}

    return model_node
