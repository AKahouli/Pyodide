from functools import wraps
from typing import Any, Iterable

from src.smart_rag.tools.utilities.calculator import calculator
from src.smart_rag.tools.utilities.connector_tools import create_save_file_to_workspace
from src.smart_rag.tools.utilities.present_choices import present_choices
from src.smart_rag.tools.utilities.render_chart import render_chart
from src.guardrails.tool_registry import tool_policy


NATIVE_TOOL_REGISTRY: dict[str, Any] = {
    "calculator": calculator,
    "render_chart": render_chart,
    "present_choices": present_choices,
}

RUNTIME_NATIVE_TOOL_FACTORIES = {
    "save_file_to_workspace": create_save_file_to_workspace,
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
        tool = get_native_tool(name, runtime_context) if enabled and isinstance(name, str) else None
        if tool is not None and name not in resolved_names:
            resolved.append(_configured_native_tool(tool, description.strip() if isinstance(description, str) else None))
            resolved_names.add(name)
    return resolved
