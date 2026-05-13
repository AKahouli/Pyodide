"""Tool factory - creates tools for playbook flow execution.

Ported and simplified from langgraph_engine/playbook_tool_factory.py.
"""

from typing import Any, Dict, List, Optional, Tuple

from src.flow_engine.mcp import call_mcp_tool


async def create_tools_for_node(
    node_config: Dict[str, Any],
    workspace_context: Optional[list] = None,
    input_files: Optional[List[str]] = None,
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """Create tools for a flow engine node.

    Returns (tool_definitions, tool_context) where tool_definitions
    are dicts with name, description, and callable coroutine.
    """
    tools: List[Dict[str, Any]] = []
    tool_context: Dict[str, Any] = {}

    connector_bindings = node_config.get("connector_bindings") or []
    for binding in connector_bindings:
        connector_name = binding.get("connector_name", "connector")
        transport_type = binding.get("mcp_transport_type", "streamable_http")
        server_url = binding.get("mcp_server_url", "")
        server_config = binding.get("mcp_server_config", {}) or {}
        actions = binding.get("actions", [])
        for action in actions:
            action_key = action if isinstance(action, str) else action.get("action_key", "")
            if not action_key:
                continue
            tool_name = f"{connector_name}_{action_key}"

            async def _call_tool(params: Dict[str, Any], _key=action_key, _transport=transport_type,
                                _url=server_url, _config=server_config) -> Any:
                return await call_mcp_tool(_transport, _url, _config, _key, params)

            tools.append({
                "name": tool_name,
                "description": f"Call {action_key} on {connector_name}",
                "coroutine": _call_tool,
            })

    return tools, tool_context
