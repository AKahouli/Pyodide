"""Set-and-forget for long-running MCP tools (Option A).

A task-capable MCP tool (e.g. a reminder set for hours) must NOT be called
synchronously — that would block the turn for the whole duration. Instead we
start it as an MCP *task*, which returns a handle immediately, and record the
handle in mcp_tasks so the poller can capture the fired result later. The agent
reports "scheduled" and the turn completes now.

Exposed to executor agents as a `schedule_<connector>_task` tool.
"""
from __future__ import annotations

import logging
from typing import Any, Callable, Dict, Optional

logger = logging.getLogger(__name__)


async def start_task(server_url: str, headers: Optional[dict], tool_name: str,
                     arguments: Dict[str, Any]) -> str:
    """Start an MCP tool as a task; return its task id immediately (no wait)."""
    from mcp import ClientSession
    from mcp.client.streamable_http import streamablehttp_client
    from mcp.client.experimental.task_handlers import ExperimentalTaskHandlers

    params: Dict[str, Any] = {"url": server_url}
    if headers:
        params["headers"] = headers
    async with streamablehttp_client(**params) as (r, w, _):
        async with ClientSession(r, w, experimental_task_handlers=ExperimentalTaskHandlers()) as s:
            await s.initialize()
            created = await s.experimental.call_tool_as_task(tool_name, arguments)
            return created.task.taskId


def make_schedule_tool(connector: Dict[str, Any],
                       on_started: Optional[Callable[[str, str, Dict[str, Any]], Any]] = None):
    """Build a fire-and-forget scheduling tool bound to one connector.

    connector: {connector_name, mcp_server_url, auth_headers}.
    on_started(task_id, tool_name, arguments): optional async hook to persist the
    handle (e.g. enqueue into mcp_tasks with mode='record').
    """
    name = connector.get("connector_name") or "connector"
    url = connector.get("mcp_server_url")
    headers = connector.get("auth_headers") or {}

    async def schedule(action: str, arguments: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Schedule a long-running action on this server and return immediately.

        Use this INSTEAD of calling a long-running action directly (e.g. setting a
        reminder for hours). It starts the task and returns a handle right away;
        the result is delivered later out-of-band.

        Args:
          action: the tool/action name on the server (e.g. "remind").
          arguments: the action's arguments (e.g. {"delay_seconds": 7200, "message": "..."}).
        """
        args = arguments or {}
        task_id = await start_task(url, headers, action, args)
        if on_started is not None:
            try:
                await on_started(task_id, action, args)
            except Exception as e:
                logger.warning("failed to record scheduled task %s: %s", task_id, e)
        return {"status": "scheduled", "task_id": task_id, "connector": name}

    # Unique, valid tool name per connector.
    import re
    schedule.__name__ = "schedule_" + re.sub(r"\W", "_", name) + "_task"
    return schedule
