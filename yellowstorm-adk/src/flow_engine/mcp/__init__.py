"""MCP client factory - creates one-shot MCP connections.

Ported from langgraph_engine/mcp_client_factory.py.
Supports streamable_http, sse, and stdio transports.
"""

import json
import logging
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

logger = logging.getLogger(__name__)


def _display_source_name(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    parsed = urlparse(text)
    if parsed.scheme and parsed.netloc:
        path = parsed.path.rstrip("/")
        if path:
            return path.rsplit("/", 1)[-1].strip() or text
    normalized = text.rstrip("/")
    if "/" in normalized:
        return normalized.rsplit("/", 1)[-1].strip() or text
    return text


def _coerce_json(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return value


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


async def call_mcp_tool(
    transport_type: str,
    server_url: str,
    server_config: Optional[Dict[str, Any]],
    action_key: str,
    params: Dict[str, Any],
    auth_headers: Optional[Dict[str, str]] = None,
    auth_env: Optional[Dict[str, str]] = None,
) -> Any:
    """Call an MCP tool and return its response.

    Creates a one-shot connection, calls the tool, and closes.
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
                command=server_url, args=args, env=merged_env,
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
                async with streamable_http_client(url=server_url, http_client=http_client) as streams:
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
            raise ValueError(f"Unsupported MCP transport: {transport_type}")

        if hasattr(result, "isError") and result.isError:
            content_parts = getattr(result, "content", []) or []
            error_texts = [p.text for p in content_parts if hasattr(p, "text")]
            return f"Connector action '{action_key}' failed: {'; '.join(error_texts) or 'Unknown error'}"

        content_parts = getattr(result, "content", []) or []
        texts = []
        parsed_payload = None
        for part in content_parts:
            if hasattr(part, "text"):
                texts.append(part.text)
                if parsed_payload is None:
                    coerced = _coerce_json(part.text)
                    if isinstance(coerced, (dict, list)):
                        parsed_payload = coerced
            elif isinstance(part, dict):
                texts.append(part.get("text", str(part)))
            else:
                texts.append(str(part))

        response_text = "\n".join(texts) if texts else str(result)
        if parsed_payload is not None:
            return {"text": response_text, "result": parsed_payload}
        return response_text

    except Exception as e:
        logger.error("MCP tool call failed: action=%s error=%s", action_key, str(e))
        return f"Connector action '{action_key}' failed: {str(e)}"
