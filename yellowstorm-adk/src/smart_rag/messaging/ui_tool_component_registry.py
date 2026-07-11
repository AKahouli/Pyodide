from dataclasses import dataclass
from typing import Any, Callable


def normalize_chart_tool_response(response: dict[str, Any]) -> dict[str, Any] | None:
    if response.get("error"):
        return None
    return response if response.get("chartData") is not None else None


def normalize_choice_tool_response(response: dict[str, Any]) -> dict[str, Any] | None:
    if response.get("error") or response.get("schemaVersion") != 1 or response.get("status") != "ready":
        return None
    return response if isinstance(response.get("options"), list) else None


@dataclass(frozen=True)
class UiToolComponentDefinition:
    component_type: str
    normalize_response: Callable[[dict[str, Any]], dict[str, Any] | None]


UI_TOOL_COMPONENT_REGISTRY = {
    "render_chart": UiToolComponentDefinition("chart", normalize_chart_tool_response),
    "present_choices": UiToolComponentDefinition("choice", normalize_choice_tool_response),
}
