from typing import Any, Iterable

from src.smart_rag.tools.utilities.calculator import calculator
from src.smart_rag.tools.utilities.present_choices import present_choices
from src.smart_rag.tools.utilities.render_chart import render_chart


NATIVE_TOOL_REGISTRY: dict[str, Any] = {
    "calculator": calculator,
    "render_chart": render_chart,
    "present_choices": present_choices,
}


def get_native_tool(name: str) -> Any | None:
    return NATIVE_TOOL_REGISTRY.get(name.strip()) if isinstance(name, str) else None


def resolve_native_tools(tool_configs: Iterable[dict[str, Any] | str]) -> list[Any]:
    resolved: list[Any] = []
    for config in tool_configs:
        name = config if isinstance(config, str) else config.get("name") if isinstance(config, dict) else None
        enabled = not isinstance(config, dict) or config.get("enabled", True)
        tool = get_native_tool(name) if enabled and isinstance(name, str) else None
        if tool is not None:
            resolved.append(tool)
    return resolved

