from functools import wraps
from typing import Any, Iterable

from src.smart_rag.tools.utilities.calculator import calculator
from src.smart_rag.tools.utilities.present_choices import present_choices
from src.smart_rag.tools.utilities.render_chart import render_chart


NATIVE_TOOL_REGISTRY: dict[str, Any] = {
    "calculator": calculator,
    "render_chart": render_chart,
    "present_choices": present_choices,
}

# These tools are attached by the existing agent factories. The catalogue may
# configure them, but must not add a second declaration to an ADK agent.
FACTORY_MANAGED_NATIVE_TOOLS = frozenset({"calculator", "render_chart"})


def get_native_tool(name: str) -> Any | None:
    return NATIVE_TOOL_REGISTRY.get(name.strip()) if isinstance(name, str) else None


def _configured_native_tool(tool: Any, description: str | None) -> Any:
    if not description:
        return tool

    @wraps(tool)
    async def configured_tool(*args: Any, **kwargs: Any) -> Any:
        return await tool(*args, **kwargs)

    configured_tool.__doc__ = description
    return configured_tool


def resolve_native_tools(tool_configs: Iterable[Any]) -> list[Any]:
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
        tool = get_native_tool(name) if enabled and isinstance(name, str) else None
        if tool is not None and name not in resolved_names:
            resolved.append(_configured_native_tool(tool, description.strip() if isinstance(description, str) else None))
            resolved_names.add(name)
    return resolved
