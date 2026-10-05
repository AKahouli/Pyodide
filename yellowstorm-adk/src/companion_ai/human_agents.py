"""Human-agent directory — backed by the human-agents-mcp server (pgvector
search over the platform's Postgres `agents` table), reached via a raw MCP
client session per call.

This is the CODE-side path to that directory. The LLM looks people up through
the `human-agents_search_human_agents` connector tool; this module is for
internal Python that must resolve a name/role OUTSIDE an agent's tool-call loop:
- the planner projecting an `assignee` onto a step before any LLM runs, and
- `delegate_to_human_agent` resolving who to contact (service.py:_delegate_tool_for).
Both hit the SAME human-agents-mcp server; this just uses a raw MCP ClientSession
instead of the agent's connector wrapper.

The name-then-role-semantic-fallback policy (and the relevance floor) lives
server-side in human-agents-mcp — see its search_human_agents tool.

ponytail: a fresh MCP session per call, no pooling — add one only if this
endpoint turns out to be called often enough per turn to matter.
"""
from __future__ import annotations

import json
import logging
from typing import List, Optional

from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

from src.config.settings import get_settings

logger = logging.getLogger(__name__)


async def search_human_agents(*, name: Optional[str] = None, role: Optional[str] = None) -> List[dict]:
    """Calls human-agents-mcp's search_human_agents tool.

    Returns a list of agent dicts ("id", "name", "role") or [] on any
    failure — a lookup miss should never break a turn, it just means the
    step falls back to the ordinary anonymous executor.
    """
    settings = get_settings()
    url = settings.HUMAN_AGENTS_MCP_URL
    if not url:
        logger.warning("search_human_agents: HUMAN_AGENTS_MCP_URL not configured")
        return []
    try:
        async with streamablehttp_client(url) as (read, write, _):
            async with ClientSession(read, write) as session:
                await session.initialize()
                result = await session.call_tool(
                    "search_human_agents",
                    arguments={"name": name or "", "role": role or ""},
                )
                if result.isError:
                    raise Exception(result.content[0].text if result.content else "unknown error")
                # fastmcp represents an empty-list tool result as zero
                # content blocks, and collapses a single-item list into a
                # bare object instead of a one-element array.
                if not result.content:
                    return []
                parsed = json.loads(result.content[0].text)
                return [parsed] if isinstance(parsed, dict) else parsed
    except Exception as e:
        logger.warning("search_human_agents failed name=%r role=%r: %s", name, role, e)
        return []
