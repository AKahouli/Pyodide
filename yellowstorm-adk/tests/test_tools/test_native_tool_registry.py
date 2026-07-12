import inspect

from src.smart_rag.tools.native_tool_registry import get_native_tool, resolve_native_tools


def test_resolve_native_tool_uses_configured_description_without_mutating_registry():
    original = get_native_tool("present_choices")
    assert original is not None

    configured = resolve_native_tools([
        {"name": "present_choices", "description": "Ask the user to select the next action."}
    ])[0]

    assert configured.__doc__ == "Ask the user to select the next action."
    assert inspect.signature(configured) == inspect.signature(original)
    assert original.__doc__ == "Present a structured choice component."


def test_resolve_native_tool_skips_disabled_configuration():
    assert resolve_native_tools([{"name": "present_choices", "enabled": False}]) == []


def test_resolve_native_tool_accepts_string_configuration():
    assert resolve_native_tools(["present_choices"])[0] is get_native_tool("present_choices")


def test_render_chart_is_resolved_only_when_enabled_in_configuration():
    assert resolve_native_tools([]) == []
    assert resolve_native_tools([{"name": "render_chart", "enabled": False}]) == []
    assert resolve_native_tools([{"name": "render_chart"}])[0] is get_native_tool("render_chart")
