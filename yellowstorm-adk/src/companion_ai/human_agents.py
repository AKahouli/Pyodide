"""Human-agent directory — backed by the human-agents-mcp server (pgvector
search over the platform's Postgres `agents` table), reached via a raw MCP
client session per call.

search_human_agents() backs two tools: `find_human_agents` (discovery — given
to the planner and to any persona-assigned step, see service.py) and the
resolution step inside `delegate_to_human_agent` (service.py:_delegate_tool_for).

The name-then-role-semantic-fallback policy (and the relevance floor) now
lives server-side in human-agents-mcp — see its search_human_agents tool.

Uses a raw MCP ClientSession rather than ADK's MCPToolset: this function is
called directly by internal Python code (_delegate_tool_for, _make_plan), not
only as an LLM-facing tool, so it needs to be callable outside an agent's
tool-call loop.

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


def make_find_human_agents_tool():
    """Discovery tool: given to the planner (to learn who exists before
    writing a plan) and to persona-assigned steps (to find who to delegate
    to) — see service.py's PLANNER_INSTRUCTION and _build_workflow."""
    from src.smart_rag.tools.search.tools import SearchToolADK

    async def find_human_agents(name: str = "", role: str = "") -> list:
        logger.info("[worky] find_human_agents called name=%r role=%r", name, role)
        agents = await search_human_agents(name=name or None, role=role or None)
        logger.info("[worky] find_human_agents → %d match(es): %s",
                    len(agents), [a.get("name") for a in agents])
        return agents

    schema = {"function": {
        "name": "find_human_agents",
        "description": (
            "Look up available human agents by name and/or role. Use this to "
            "find who a step/question should be assigned or delegated to — "
            "there is no fixed roster, always check here first."),
        "parameters": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "filter by (partial) name, or \"\" for any"},
                "role": {"type": "string", "description": "filter by role, or \"\" for any"},
            },
            "required": [],
            "additionalProperties": False,
        },
    }}
    return SearchToolADK(find_human_agents, schema)
