from functools import wraps
from typing import Any, Iterable

from src.smart_rag.tools.utilities.calculator import calculator
from src.smart_rag.tools.utilities.connector_tools import create_save_file_to_workspace
from src.smart_rag.tools.utilities.owner_validation import create_request_owner_validation_tool
from src.smart_rag.tools.utilities.present_choices import present_choices
from src.smart_rag.tools.utilities.render_chart import render_chart
from src.smart_rag.tools.utilities.run_code import create_run_code_tool
from src.smart_rag.tools.utilities.generate_image import create_generate_image_tool
from src.guardrails.tool_registry import tool_policy
from src.smart_rag.tools.utilities.conversation_assets import ASSET_TOOL_NAMES, create_conversation_asset_tools


NATIVE_TOOL_REGISTRY: dict[str, Any] = {
    "calculator": calculator,
    "render_chart": render_chart,
    "present_choices": present_choices,
}

RUNTIME_NATIVE_TOOL_FACTORIES = {
    "generate_image": create_generate_image_tool,
    "save_file_to_workspace": create_save_file_to_workspace,
    "run_code": create_run_code_tool,
    "request_owner_validation": create_request_owner_validation_tool,
}

# These tools are attached by the existing agent factories. The catalogue may
# configure them, but must not add a second declaration to an ADK agent.
FACTORY_MANAGED_NATIVE_TOOLS = frozenset(
    {"calculator", "render_chart", "generate_web_preview"}
)


def get_native_tool(name: str, runtime_context: dict[str, Any] | None = None) -> Any | None:
    if not isinstance(name, str):
        return None
    normalized_name = name.strip()
    tool = NATIVE_TOOL_REGISTRY.get(normalized_name)
    if tool is not None:
        setattr(tool, "metadata", tool_policy(normalized_name, getattr(tool, "metadata", None)))
        return tool
    if normalized_name in ASSET_TOOL_NAMES:
        tool = next((tool for tool in create_conversation_asset_tools(runtime_context)
                     if tool.__name__ == normalized_name), None)
        if tool is not None:
            setattr(tool, "metadata", tool_policy(normalized_name))
        return tool
    factory = RUNTIME_NATIVE_TOOL_FACTORIES.get(normalized_name)
    tool = factory(runtime_context or {}) if factory else None
    if tool is not None:
        setattr(tool, "metadata", tool_policy(normalized_name, getattr(tool, "metadata", None)))
    return tool


def _configured_native_tool(tool: Any, description: str | None) -> Any:
    if not description:
        return tool

    @wraps(tool)
    async def configured_tool(*args: Any, **kwargs: Any) -> Any:
        return await tool(*args, **kwargs)

    configured_tool.__doc__ = description
    if getattr(tool, "__name__", "") == "generate_image":
        configured_tool.__doc__ += "\n\n" + (tool.__doc__ or "")
    return configured_tool


def resolve_native_tools(
    tool_configs: Iterable[Any],
    runtime_context: dict[str, Any] | None = None,
) -> list[Any]:
    resolved: list[Any] = []
    resolved_names: set[str] = set()
    for config in tool_configs:
        if isinstance(config, str):
            name = config
            enabled = True
            description = None
        elif isinstance(config, dict):
            name = config.get("name")
            enabled = config.get("enabled", True)
            description = config.get("description")
        else:
            name = getattr(config, "name", None)
            enabled = getattr(config, "enabled", True)
            description = getattr(config, "description", None)
        tool_context = runtime_context
        if name == "generate_image":
            model = config.get("model") if isinstance(config, dict) else getattr(config, "custom_params", {}).get("model")
            tool_context = {**(runtime_context or {}), **({"image_generation_model": model} if model else {})}
        tool = get_native_tool(name, tool_context) if enabled and isinstance(name, str) else None
        if tool is not None and name not in resolved_names:
            resolved.append(_configured_native_tool(tool, description.strip() if isinstance(description, str) else None))
            resolved_names.add(name)
    # Conversation assets are a baseline capability, not an admin catalogue opt-in.
    # Missing trusted context leaves non-conversation agents unchanged.
    for tool in create_conversation_asset_tools(runtime_context):
        if tool.__name__ not in resolved_names:
            setattr(tool, "metadata", tool_policy(tool.__name__))
            resolved.append(tool)
    return resolved
