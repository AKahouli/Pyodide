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
    auth_headers: Optional[Dict[str, str]] = None,
    auth_env: Optional[Dict[str, str]] = None,
) -> str:
    """Call an MCP tool and return the text result.

    Creates a one-shot connection, calls the tool, and closes.

    Args:
        transport_type: 'streamable_http', 'sse', or 'stdio'.
        server_url: URL or command.
        server_config: Extra config (args, env, headers, etc.).
        action_key: The tool name to call.
        params: Parameters to pass to the tool.
        auth_headers: HTTP headers to inject (for sse/streamable_http).
        auth_env: Environment variables to inject (for stdio).

    Returns:
        Text result from the tool, or an error string.
    """
    merged_headers = _build_headers(server_config, auth_headers)
    merged_env = _build_env(server_config, auth_env)

    try:
        if transport_type == "stdio":
            from mcp.client.stdio import stdio_client, StdioServerParameters

            args = (server_config or {}).get("commandArgs", [])
            if isinstance(args, str):
                args = [args]

            server_params = StdioServerParameters(
                command=server_url,
                args=args,
                env=merged_env,
            )

            async with stdio_client(server_params) as streams:
                read_stream, write_stream = streams
                from mcp import ClientSession

                async with ClientSession(read_stream, write_stream) as session:
                    await session.initialize()
                    result = await session.call_tool(action_key, arguments=params)

        elif transport_type == "sse":
            from mcp.client.sse import sse_client

            async with sse_client(url=server_url, headers=merged_headers) as streams:
                read_stream, write_stream = streams
                from mcp import ClientSession

                async with ClientSession(read_stream, write_stream) as session:
                    await session.initialize()
                    result = await session.call_tool(action_key, arguments=params)

        elif transport_type == "streamable_http":
            from mcp.client.streamable_http import streamable_http_client
            import httpx

            if merged_headers:
                http_client = httpx.AsyncClient(headers=merged_headers)
                async with streamable_http_client(
                    url=server_url, http_client=http_client
                ) as streams:
                    read_stream, write_stream, _ = streams
                    from mcp import ClientSession

                    async with ClientSession(read_stream, write_stream) as session:
                        await session.initialize()
                        result = await session.call_tool(action_key, arguments=params)
            else:
                async with streamable_http_client(url=server_url) as streams:
                    read_stream, write_stream, _ = streams
                    from mcp import ClientSession

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
        logger.error("MCP tool call failed: action=%s error=%s", action_key, str(e))
        return f"Connector action '{action_key}' failed: {str(e)}"


def _build_headers(
    server_config: Optional[Dict[str, Any]],
    auth_headers: Optional[Dict[str, str]],
) -> Optional[Dict[str, str]]:
    config_headers = (server_config or {}).get("headers", {})
    if not config_headers and not auth_headers:
        return None
    merged = {}
    if config_headers:
        merged.update(config_headers)
    if auth_headers:
        merged.update(auth_headers)
    return merged


def _build_env(
    server_config: Optional[Dict[str, Any]],
    auth_env: Optional[Dict[str, str]],
) -> Optional[Dict[str, str]]:
    config_env = (server_config or {}).get("env", {})
    if not config_env and not auth_env:
        return None
    merged = {}
    if config_env:
        merged.update(config_env)
    if auth_env:
        merged.update(auth_env)
    return merged
