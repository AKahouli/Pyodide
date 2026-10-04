"""Worker tool authority comes from local construction, never tool names/metadata."""
from __future__ import annotations

import inspect
import weakref

from google.adk.agents import LlmAgent
from google.adk.tools import FunctionTool

from src.guardrails.adapters.google_adk import prepend_callback

_approved: dict[int, tuple[weakref.ReferenceType, str]] = {}


def register_tool_execution_kind(tool, kind: str):
    """Called only by trusted native factories and backend binding construction."""
    key = id(tool)
    _approved[key] = (weakref.ref(tool, lambda _ref: _approved.pop(key, None)), kind)
    return tool


def is_leaf_tool(tool) -> bool:
    approval = _approved.get(id(tool))
    if approval is not None and approval[0]() is tool:
        return approval[1] == "leaf"
    # FunctionTool.func is executable local provenance. Remote declarations,
    # annotations and even a copied calculator name cannot satisfy this check.
    if isinstance(tool, FunctionTool):
        func = inspect.unwrap(tool.func)
        approval = _approved.get(id(func))
        if approval is not None and approval[0]() is func:
            return approval[1] == "leaf"
        from src.smart_rag.tools import calculator, render_chart, present_choices
        from src.smart_rag.tools.search.toolkit import SearchToolkit
        if any(func is native for native in (calculator, render_chart, present_choices)):
            return True
        owner = getattr(func, "__self__", None)
        methods = ("perform_standard_search", "perform_filtered_search",
                   "perform_document_search", "preform_all_brain_search",
                   "perform_in_memory_extraction", "perform_web_search", "perform_csrd_search")
        return isinstance(owner, SearchToolkit) and any(
            getattr(func, "__func__", None) is getattr(SearchToolkit, method) for method in methods
        )
    return False


def install_leaf_tool_gate(agent) -> None:
    if not isinstance(agent, LlmAgent) or getattr(agent, "sub_agents", None):
        raise ValueError("Leaf workers require an LlmAgent without routable sub-agents")

    async def before_tool(tool, args, tool_context):
        if not is_leaf_tool(tool):
            return {"error": "This worker cannot execute orchestration or unclassified tools."}
        return None

    if getattr(agent, "_root_leaf_gate_installed", False):
        return
    agent.before_tool_callback = prepend_callback(agent.before_tool_callback, before_tool)
    agent.disallow_transfer_to_parent = True
    agent.disallow_transfer_to_peers = True
    agent._root_leaf_gate_installed = True
