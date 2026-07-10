"""Materialize per-user connectors (MCP servers) into ADK tools for executors.

Each connector on a RunRequest is a remote MCP server with a URL, ready-to-use
auth headers (resolved upstream), and a set of enabled actions. We turn each into
an McpToolset the executor agents can call; auth is carried through as HTTP
headers captured at request time.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List

logger = logging.getLogger(__name__)


def connector_to_toolset(connector: Dict[str, Any]):
    """Build one McpToolset from a connector dict, or None if unsupported.

    connector keys: connector_name, mcp_transport_type, mcp_server_url,
    auth_headers (dict), actions (list of {action_key}).
    """
    from google.adk.tools.mcp_tool import (
        McpToolset,
        SseConnectionParams,
        StreamableHTTPConnectionParams,
    )

    transport = (connector.get("mcp_transport_type") or "").lower()
    url = connector.get("mcp_server_url")
    headers = connector.get("auth_headers") or {}
    if not url:
        return None

    if "streamable" in transport or transport in ("http", "streamable_http", "streamable-http"):
        params = StreamableHTTPConnectionParams(url=url, headers=headers)
    elif transport == "sse":
        params = SseConnectionParams(url=url, headers=headers)
    else:
        # stdio connectors need command/args, not a URL — not supported here.
        logger.info("skipping connector %s: unsupported transport %r",
                    connector.get("connector_name"), transport)
        return None

    actions = [a.get("action_key") for a in (connector.get("actions") or []) if a.get("action_key")]
    return McpToolset(
        connection_params=params,
        tool_filter=actions or None,             # limit to enabled actions
        tool_name_prefix=connector.get("connector_name") or None,
    )


def connectors_to_toolsets(connectors: List[Dict[str, Any]]) -> List:
    """Materialize a list of connector dicts into ADK toolsets (skips unsupported)."""
    out = []
    for c in connectors or []:
        try:
            ts = connector_to_toolset(c)
            if ts is not None:
                out.append(ts)
        except Exception as e:
            logger.warning("failed to build toolset for connector %s: %s",
                           c.get("connector_name"), e)
    return out
