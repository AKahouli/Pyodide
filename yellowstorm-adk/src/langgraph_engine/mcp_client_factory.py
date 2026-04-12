"""Factory for calling MCP tools from server configuration."""

import logging
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)


async def call_mcp_tool(
    transport_type: str,
    server_url: str,
    server_config: Optional[Dict[str, Any]],
    action_key: str,
    params: Dict[str, Any],
) -> str:
    """Call an MCP tool and return the text result.

    Creates a one-shot connection, calls the tool, and closes.

    Args:
        transport_type: 'streamable_http', 'sse', or 'stdio'.
        server_url: URL or command.
        server_config: Extra config (args, env, headers, etc.).
        action_key: The tool name to call.
        params: Parameters to pass to the tool.

    Returns:
        Text result from the tool, or an error string.
    """
    try:
        from mcp import ClientSession

        if transport_type == "stdio":
            from mcp.client.stdio import stdio_client

            args = (server_config or {}).get("commandArgs", [])
            if isinstance(args, str):
                args = [args]
            env = (server_config or {}).get("env", {})

            async with stdio_client(command=server_url, args=args, env=env) as streams:
                read_stream, write_stream = streams
                async with ClientSession(read_stream, write_stream) as session:
                    await session.initialize()
                    result = await session.call_tool(action_key, arguments=params)
        elif transport_type == "sse":
            from mcp.client.sse import sse_client

            async with sse_client(url=server_url) as streams:
                read_stream, write_stream = streams
                async with ClientSession(read_stream, write_stream) as session:
                    await session.initialize()
                    result = await session.call_tool(action_key, arguments=params)
        elif transport_type == "streamable_http":
            from mcp.client.streamable_http import streamablehttp_client

            async with streamablehttp_client(url=server_url) as streams:
                read_stream, write_stream = streams
                async with ClientSession(read_stream, write_stream) as session:
                    await session.initialize()
                    result = await session.call_tool(action_key, arguments=params)
        else:
            raise ValueError(
                f"Unsupported MCP transport type: {transport_type}. "
                "Expected 'streamable_http', 'sse', or 'stdio'."
            )

        if hasattr(result, "isError") and result.isError:
            content_parts = getattr(result, "content", []) or []
            error_texts = [p.text for p in content_parts if hasattr(p, "text")]
            return f"Connector action '{action_key}' failed: {'; '.join(error_texts) or 'Unknown error'}"

        content_parts = getattr(result, "content", []) or []
        texts = []
        for part in content_parts:
            if hasattr(part, "text"):
                texts.append(part.text)
            elif isinstance(part, dict):
                texts.append(part.get("text", str(part)))
            else:
                texts.append(str(part))
        return "\n".join(texts) if texts else str(result)
    except Exception as e:
        logger.error("MCP tool call failed", action=action_key, error=str(e))
        return f"Connector action '{action_key}' failed: {str(e)}"
