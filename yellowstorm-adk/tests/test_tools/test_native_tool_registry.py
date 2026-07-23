import inspect

from google.adk.tools import FunctionTool

from src.smart_rag.tools.native_tool_registry import (
    FACTORY_MANAGED_NATIVE_TOOLS,
    get_native_tool,
    resolve_native_tools,
)


def test_resolve_native_tool_uses_configured_description_without_mutating_registry():
    original = get_native_tool("present_choices")
    assert original is not None

    configured = resolve_native_tools([
        {"name": "present_choices", "description": "Ask the user to select the next action."}
    ])[0]

    assert configured.__doc__ == "Ask the user to select the next action."
    assert inspect.signature(configured) == inspect.signature(original)
    assert original.__doc__ == "Present structured choices with actionable submitText values and optional free-text otherOption."


def test_resolve_native_tool_skips_disabled_configuration():
    assert resolve_native_tools([{"name": "present_choices", "enabled": False}]) == []


def test_resolve_native_tool_accepts_string_configuration():
    assert resolve_native_tools(["present_choices"])[0] is get_native_tool("present_choices")


def test_render_chart_is_resolved_only_when_enabled_in_configuration():
    assert resolve_native_tools([]) == []
    assert resolve_native_tools([{"name": "render_chart", "enabled": False}]) == []
    assert resolve_native_tools([{"name": "render_chart"}])[0] is get_native_tool("render_chart")


def test_generate_web_preview_is_factory_managed():
    assert "generate_web_preview" in FACTORY_MANAGED_NATIVE_TOOLS
    assert get_native_tool("generate_web_preview") is None


def test_save_file_to_workspace_requires_assignment_and_runtime_credentials():
    runtime_context = {
        "platform_api_url": "https://platform.example.com",
        "platform_api_token": "internal-secret",
        "user_id": "user-1",
    }

    assert resolve_native_tools([], runtime_context=runtime_context) == []
    assert resolve_native_tools([{"name": "save_file_to_workspace", "enabled": False}], runtime_context=runtime_context) == []
    assert resolve_native_tools([{"name": "save_file_to_workspace"}]) == []

    tools = resolve_native_tools(
        ["save_file_to_workspace", "save_file_to_workspace"],
        runtime_context=runtime_context,
    )
    assert len(tools) == 1
    signature = inspect.signature(tools[0])
    assert tools[0].__name__ == "save_file_to_workspace"
    assert "platform_api_url" not in signature.parameters
    assert "platform_api_token" not in signature.parameters
    assert set(signature.parameters) == {
        "download_url",
        "workspace_id",
        "filename",
        "mime_type",
        "auth_headers",
        "source_meta",
        "tool_context",
    }
    schema = FunctionTool(tools[0])._get_declaration().parameters_json_schema
    assert set(schema["properties"]) == {
        "download_url",
        "workspace_id",
        "filename",
        "mime_type",
        "auth_headers",
        "source_meta",
    }
