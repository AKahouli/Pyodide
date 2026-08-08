import json
from typing import Any, Callable

from google.genai import types

from src.guardrails.models import GuardrailContext
from src.guardrails.runtime import GuardrailRuntime
from src.guardrails.tool_registry import tool_policy
from src.connector_tool_name import build_connector_tool_name


def append_callback(existing: Any, callback: Callable[..., Any]) -> list[Callable[..., Any]]:
    if existing is None:
        return [callback]
    if isinstance(existing, list):
        return [*existing, callback]
    return [existing, callback]


def prepend_callback(existing: Any, callback: Callable[..., Any]) -> list[Callable[..., Any]]:
    if existing is None:
        return [callback]
    if isinstance(existing, list):
        return [callback, *existing]
    return [callback, existing]


def _content_text(content: Any) -> str:
    return "".join(str(getattr(part, "text", "") or "") for part in (getattr(content, "parts", None) or []))


def _last_input_text(llm_request: Any) -> str:
    for content in reversed(getattr(llm_request, "contents", None) or []):
        if getattr(content, "role", "") == "user":
            return _content_text(content)
    return ""


def _replace_last_input_text(llm_request: Any, text: str) -> None:
    for content in reversed(getattr(llm_request, "contents", None) or []):
        if getattr(content, "role", "") != "user":
            continue
        content.parts = [types.Part(text=text)]
        return


def _blocked_response(text: str) -> Any:
    from google.adk.models.llm_response import LlmResponse

    return LlmResponse(content=types.Content(role="model", parts=[types.Part(text=text)]))


def _configured_tool_metadata(config: dict[str, Any], tool_name: str) -> dict[str, Any]:
    params = config.get("agent_params") or {}
    raw = params.get("connector_bindings_json")
    if not isinstance(raw, str):
        return {}
    try:
        bindings = json.loads(raw)
    except (TypeError, ValueError):
        return {}
    for binding in bindings if isinstance(bindings, list) else []:
        if not isinstance(binding, dict):
            continue
        connector_slug = str(binding.get("connector_slug") or binding.get("connector_name") or "")
        for action in binding.get("actions") or []:
            if not isinstance(action, dict):
                continue
            action_key = str(action.get("action_key") or "")
            if build_connector_tool_name(connector_slug, action_key) == tool_name:
                return {
                    "tool_kind": "connector_action",
                    "connector_id": str(binding.get("connector_id") or ""),
                    "connector_name": str(binding.get("connector_name") or ""),
                    "action_key": action_key,
                    "safety": str(action.get("safety") or "unknown").lower(),
                }
    return {}


def apply_guardrail_callbacks(agent_kwargs: dict[str, Any], agent_config: dict[str, Any] | None) -> dict[str, Any]:
    config = agent_config or {}
    runtime = GuardrailRuntime()

    async def before_model(callback_context: Any, llm_request: Any) -> Any:
        text = _last_input_text(llm_request)
        if not text:
            return None
        decision = await runtime.review_model_input(
            text,
            GuardrailContext(
                phase="model_input", runtime_surface="conversation_google_adk",
                channel=str(config.get("channel") or "web"),
                user_id=str(config.get("user_id") or ""),
                agent_id=str(config.get("id") or ""),
                agent_name=str(config.get("name") or ""),
                conversation_id=str(getattr(callback_context, "invocation_id", "") or ""),
                source="conversation_message",
            ),
            config,
        )
        if decision.blocked:
            return _blocked_response(decision.text)
        if decision.sanitized:
            _replace_last_input_text(llm_request, decision.text)
        return None

    async def after_model(callback_context: Any, llm_response: Any) -> Any:
        content = getattr(llm_response, "content", None)
        text = _content_text(content)
        if not text:
            return None
        decision = await runtime.review_model_output(
            text,
            GuardrailContext(
                phase="model_output", runtime_surface="conversation_google_adk",
                channel=str(config.get("channel") or "web"),
                user_id=str(config.get("user_id") or ""),
                agent_id=str(config.get("id") or ""),
                agent_name=str(config.get("name") or ""),
                conversation_id=str(getattr(callback_context, "invocation_id", "") or ""),
            ),
            config,
        )
        if decision.blocked or decision.sanitized:
            return _blocked_response(decision.text)
        return None

    async def before_tool(tool: Any, args: dict[str, Any], tool_context: Any) -> dict[str, Any] | None:
        tool_name = str(getattr(tool, "name", "") or "")
        metadata = tool_policy(tool_name, {**_configured_tool_metadata(config, tool_name), **(getattr(tool, "metadata", None) or {})})
        decision = await runtime.review_tool_action(
            GuardrailContext(
                phase="tool_action", runtime_surface="conversation_google_adk",
                user_id=str(config.get("user_id") or ""),
                agent_id=str(config.get("id") or ""),
                agent_name=str(config.get("name") or ""),
                conversation_id=str(getattr(tool_context, "invocation_id", "") or ""),
                tool_name=tool_name,
                tool_args=args,
                tool_metadata=metadata,
            ),
            config,
        )
        if decision.blocked:
            return {"status": "blocked_by_guardrail", "error": decision.block_message}
        return None

    # Input protection must run after context-injection callbacks. Output protection
    # runs before downstream event handling because ADK executes agent callbacks first.
    agent_kwargs["before_model_callback"] = append_callback(agent_kwargs.get("before_model_callback"), before_model)
    agent_kwargs["after_model_callback"] = prepend_callback(agent_kwargs.get("after_model_callback"), after_model)
    agent_kwargs["before_tool_callback"] = append_callback(agent_kwargs.get("before_tool_callback"), before_tool)
    return agent_kwargs


def apply_guardrails_to_agent(agent: Any, agent_config: dict[str, Any] | None) -> Any:
    if getattr(agent, "_guardrails_callbacks_applied", False):
        return agent
    callbacks = apply_guardrail_callbacks({
        "before_model_callback": getattr(agent, "before_model_callback", None),
        "after_model_callback": getattr(agent, "after_model_callback", None),
        "before_tool_callback": getattr(agent, "before_tool_callback", None),
    }, agent_config)
    for field, value in callbacks.items():
        setattr(agent, field, value)
    object.__setattr__(agent, "_guardrails_callbacks_applied", True)
    for tool in getattr(agent, "tools", None) or []:
        child = getattr(tool, "agent", None) or getattr(tool, "sub_agent", None)
        if child is not None:
            apply_guardrails_to_agent(child, agent_config)
    return agent
