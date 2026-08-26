import copy
from typing import Any, Optional

from google.adk.tools.base_tool import BaseTool
from google.adk.tools.mcp_tool.mcp_toolset import MCPToolset
from google.genai import types

from src.logger.logging import get_logger


logger = get_logger("api.smart_rag.purpose_aware_mcp")

DISPLAY_PURPOSE_KEY = "display_purpose"
LEGACY_DISPLAY_PURPOSE_KEY = "_display_purpose"
DISPLAY_PURPOSE_DESCRIPTION = (
    "Always provide a short user-facing reason for this tool call. Describe the goal, not the "
    "arguments. Do not include code, commands, paths, URLs, identifiers, "
    "credentials, or hidden reasoning."
)


def _raw_mcp_tool(tool: BaseTool) -> Any:
    return getattr(tool, "raw_mcp_tool", None) or getattr(tool, "_mcp_tool", None)


def _server_defines_display_purpose(tool: BaseTool) -> bool:
    raw_tool = _raw_mcp_tool(tool)
    schema = getattr(raw_tool, "inputSchema", None)
    properties = schema.get("properties") if isinstance(schema, dict) else None
    return isinstance(properties, dict) and any(
        key in properties for key in (DISPLAY_PURPOSE_KEY, LEGACY_DISPLAY_PURPOSE_KEY)
    )


class PurposeAwareMcpTool(BaseTool):
    """Adds display metadata to an MCP declaration without changing execution."""

    def __init__(self, wrapped_tool: BaseTool):
        super().__init__(
            name=wrapped_tool.name,
            description=wrapped_tool.description,
            is_long_running=getattr(wrapped_tool, "is_long_running", False),
        )
        self._wrapped_tool = wrapped_tool
        # Existing callbacks use this protected ADK attribute to identify the
        # microsandbox connection that owns a materialized MCP tool.
        self._mcp_session_manager = getattr(wrapped_tool, "_mcp_session_manager", None)

    @property
    def raw_mcp_tool(self) -> Any:
        return _raw_mcp_tool(self._wrapped_tool)

    def _get_declaration(self) -> types.FunctionDeclaration:
        declaration = self._wrapped_tool._get_declaration().model_copy(deep=True)
        if declaration.parameters_json_schema is not None:
            schema = copy.deepcopy(declaration.parameters_json_schema)
            properties = dict(schema.get("properties") or {})
            properties[DISPLAY_PURPOSE_KEY] = {
                "type": "string",
                "description": DISPLAY_PURPOSE_DESCRIPTION,
            }
            schema["properties"] = properties
            required = list(schema.get("required") or [])
            if DISPLAY_PURPOSE_KEY not in required:
                required.append(DISPLAY_PURPOSE_KEY)
            schema["required"] = required
            declaration.parameters_json_schema = schema
        elif declaration.parameters is not None:
            parameters = declaration.parameters.model_copy(deep=True)
            properties = dict(parameters.properties or {})
            properties[DISPLAY_PURPOSE_KEY] = types.Schema(
                type=types.Type.STRING,
                description=DISPLAY_PURPOSE_DESCRIPTION,
            )
            parameters.properties = properties
            required = list(parameters.required or [])
            if DISPLAY_PURPOSE_KEY not in required:
                required.append(DISPLAY_PURPOSE_KEY)
            parameters.required = required
            declaration.parameters = parameters
        return declaration

    async def run_async(self, *, args: dict[str, Any], tool_context: Any) -> Any:
        forwarded_args = dict(args)
        forwarded_args.pop(DISPLAY_PURPOSE_KEY, None)
        forwarded_args.pop(LEGACY_DISPLAY_PURPOSE_KEY, None)
        return await self._wrapped_tool.run_async(
            args=forwarded_args,
            tool_context=tool_context,
        )


class PurposeAwareMcpToolset(MCPToolset):
    """Decorates every materialized MCP tool at YellowStorm's ADK boundary."""

    async def get_tools(
        self,
        readonly_context: Optional[Any] = None,
    ) -> list[BaseTool]:
        tools = await super().get_tools(readonly_context)
        decorated: list[BaseTool] = []
        for tool in tools:
            if _raw_mcp_tool(tool) is None:
                decorated.append(tool)
                continue
            if _server_defines_display_purpose(tool):
                logger.warning(
                    "MCP tool already defines reserved display-purpose field; tool left unchanged: %s",
                    tool.name,
                )
                decorated.append(tool)
                continue
            decorated.append(PurposeAwareMcpTool(tool))
        return decorated
