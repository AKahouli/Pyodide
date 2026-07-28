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


def normalize_web_preview_tool_response(response: dict[str, Any]) -> dict[str, Any] | None:
    if response.get("schemaVersion") != 1 or response.get("status") != "ready":
        return None
    content = response.get("content")
    if not isinstance(content, str) or not content.strip():
        return None
    if len(content.encode("utf-8")) > 1_000_000:
        return None
    return {"content": content}


@dataclass(frozen=True)
class UiToolComponentDefinition:
    component_type: str
    normalize_response: Callable[[dict[str, Any]], dict[str, Any] | None]


UI_TOOL_COMPONENT_REGISTRY = {
    "render_chart": UiToolComponentDefinition("chart", normalize_chart_tool_response),
    "present_choices": UiToolComponentDefinition("choice", normalize_choice_tool_response),
    "generate_web_preview": UiToolComponentDefinition(
        "web_preview", normalize_web_preview_tool_response
    ),
}
