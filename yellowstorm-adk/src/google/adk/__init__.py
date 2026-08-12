"""Minimal local stub for google.adk used in tests.

This keeps test collection working when the real Google ADK SDK is not installed.
Only the symbols imported by the codebase/test fixtures are provided.
"""

from __future__ import annotations

import sys
import types
from dataclasses import dataclass


def _ensure_module(name: str) -> types.ModuleType:
    module = sys.modules.get(name)
    if module is None:
        module = types.ModuleType(name)
        sys.modules[name] = module
    return module


class _Stub:
    def __init__(self, *args, **kwargs):
        self.args = args
        self.kwargs = kwargs

    def __call__(self, *args, **kwargs):
        return self.__class__(*args, **kwargs)


class Agent(_Stub):
    pass


class Runner(_Stub):
    pass


@dataclass
class Session:
    id: str = ""


class DatabaseSessionService(_Stub):
    pass


class ToolContext(_Stub):
    pass


class BaseTool(_Stub):
    pass


class FunctionTool(BaseTool):
    pass


class CallbackContext(_Stub):
    pass


class InvocationContext(_Stub):
    pass


class Event(_Stub):
    pass


class BasePlugin(_Stub):
    pass


class LlmRequest(_Stub):
    pass


class LlmResponse(_Stub):
    pass


class LiteLlm(_Stub):
    pass


class MCPToolset(_Stub):
    pass


class SseServerParams(_Stub):
    pass


class StreamableHTTPConnectionParams(_Stub):
    pass


def _register_submodules() -> None:
    agents_mod = _ensure_module("google.adk.agents")
    agents_mod.Agent = Agent
    agents_mod.InvocationContext = InvocationContext

    agents_cb_mod = _ensure_module("google.adk.agents.callback_context")
    agents_cb_mod.CallbackContext = CallbackContext

    runners_mod = _ensure_module("google.adk.runners")
    runners_mod.Runner = Runner

    sessions_mod = _ensure_module("google.adk.sessions")
    sessions_mod.DatabaseSessionService = DatabaseSessionService
    sessions_mod.Session = Session
    sessions_db_mod = _ensure_module("google.adk.sessions.database_session_service")
    sessions_db_mod.Base = object

    models_mod = _ensure_module("google.adk.models")
    models_mod.LlmRequest = LlmRequest
    models_mod.LlmResponse = LlmResponse
    lite_llm_mod = _ensure_module("google.adk.models.lite_llm")
    lite_llm_mod.LiteLlm = LiteLlm

    tools_mod = _ensure_module("google.adk.tools")
    tools_mod.BaseTool = BaseTool
    tools_mod.FunctionTool = FunctionTool
    tools_mod.ToolContext = ToolContext
    tools_mod.MCPToolset = MCPToolset
    setattr(sys.modules[__name__], "tools", tools_mod)

    tools_base_mod = _ensure_module("google.adk.tools.base_tool")
    tools_base_mod.BaseTool = BaseTool

    tools_tc_mod = _ensure_module("google.adk.tools.tool_context")
    tools_tc_mod.ToolContext = ToolContext

    mcp_pkg = _ensure_module("google.adk.tools.mcp_tool")
    mcp_pkg.MCPToolset = MCPToolset
    mcp_toolset_mod = _ensure_module("google.adk.tools.mcp_tool.mcp_toolset")
    mcp_toolset_mod.MCPToolset = MCPToolset
    mcp_toolset_mod.SseServerParams = SseServerParams
    mcp_toolset_mod.StreamableHTTPConnectionParams = StreamableHTTPConnectionParams
    mcp_pkg.mcp_toolset = mcp_toolset_mod
    tools_mod.mcp_tool = mcp_pkg

    events_mod = _ensure_module("google.adk.events")
    events_mod.Event = Event

    plugins_mod = _ensure_module("google.adk.plugins.base_plugin")
    plugins_mod.BasePlugin = BasePlugin


_register_submodules()
