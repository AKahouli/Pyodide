"""Connectors -> LangChain tools for the executor nodes.

Reuses the app's own `create_connector_tools` (the same per-action one-shot MCP
function tools the ADK path uses, service._tools_for) and wraps each into a
LangChain StructuredTool so it can be bound to a chat model. This keeps ONE
connector implementation across both engines — we only re-wrap the callables.

NOTE: exercised against the live backend only; the offline tests cover the tool
LOOP (graph.make_worker) with fake tools, not real MCP I/O.
"""
from __future__ import annotations

import inspect
from typing import List, Optional


def _is_injected(name: str, annotation) -> bool:
    """A framework-injected param that is NOT a model-facing argument: ADK's
    ToolContext/Context. LangChain can't JSON-schema it (it's not JSON-serializable),
    and the model must never see it. ADK strips these on its side; we do the same."""
    if name in ("tool_context", "context", "callback_context", "readonly_context"):
        return True
    return "Context" in str(annotation)


def _strip_injected(call):
    """Return (wrapper, is_async): the callable with injected context params
    removed from its signature (so LangChain schematizes only real args) and
    dropped from kwargs at call time (the connector's own param defaults to None)."""
    try:
        sig = inspect.signature(call)
    except (ValueError, TypeError):
        return call, inspect.iscoroutinefunction(call)
    drop = {n for n, p in sig.parameters.items() if _is_injected(n, p.annotation)}
    if not drop:
        return call, inspect.iscoroutinefunction(call)
    kept = [p for n, p in sig.parameters.items() if n not in drop]
    is_async = inspect.iscoroutinefunction(call)

    # Pass the injected params as None rather than dropping them: the connector
    # func declares tool_context (ADK adds it, often required), and its own guards
    # handle None (auth is in the MCP config headers, not the context). Only the
    # ADK-state extras — image buffering, citation source registration — are then
    # skipped, which is acceptable; they degrade, they don't break.
    if is_async:
        async def wrapper(**kwargs):
            for d in drop:
                kwargs[d] = None
            return await call(**kwargs)
    else:
        def wrapper(**kwargs):
            for d in drop:
                kwargs[d] = None
            return call(**kwargs)

    wrapper.__name__ = getattr(call, "__name__", "tool")
    try:
        wrapper.__signature__ = sig.replace(parameters=kept)
    except (ValueError, TypeError):
        pass
    wrapper.__annotations__ = {n: a for n, a in getattr(call, "__annotations__", {}).items()
                               if n not in drop}
    return wrapper, is_async


def _structured_tool(call, name, desc):
    from langchain_core.tools import StructuredTool
    clean, is_async = _strip_injected(call)
    if is_async:
        return StructuredTool.from_function(coroutine=clean, name=name, description=desc)
    return StructuredTool.from_function(func=clean, name=name, description=desc)


def _to_lc_tool(fn):
    """Wrap a connector function tool (ADK FunctionTool or a plain callable) into
    a LangChain tool. The connector tools expose their callable as `.func`."""
    call = getattr(fn, "func", None) or fn
    name = getattr(fn, "name", None) or getattr(call, "__name__", "tool")
    desc = getattr(fn, "description", None) or (inspect.getdoc(call) or name)
    return _structured_tool(call, name, desc)


def connectors_to_lc_tools(connectors: Optional[List[dict]], session_id: str) -> List:
    """Materialize connectors into LangChain tools. Empty list if none."""
    if not connectors:
        return []
    from src.smart_rag.tools.utilities.connector_tools import (
        create_connector_tools, ConnectorToolContext)
    raw = create_connector_tools(connectors, ConnectorToolContext(session_id=session_id))
    return [_to_lc_tool(t) for t in raw]


def _lc_from_callable(call, orig):
    name = getattr(orig, "name", None) or getattr(call, "__name__", "tool")
    desc = getattr(orig, "description", None) or (inspect.getdoc(call) or name)
    return _structured_tool(call, name, desc)


def _stamp_email_call(call, token_provider, on_sent):
    """Wrap a send_email callable so the outbound mail carries its routing token
    and the wait records who may reply. Mirrors nodes.stamp_send_email_tool, minus
    the ADK gate wrapper (gate is a separate LG node). Deterministic: the executor
    LLM never sees the token."""
    from .. import mail_token
    from ..nodes import _recipients

    async def stamped(**kwargs):
        token = await token_provider()
        if token:
            if kwargs.get("subject"):
                kwargs["subject"] = mail_token.stamp_subject(kwargs["subject"], token)
            if kwargs.get("body"):
                kwargs["body"] = mail_token.stamp_body(kwargs["body"], token)
        result = await call(**kwargs)          # only now does a replyable mail exist
        if token and on_sent is not None:
            await on_sent(token, _recipients(kwargs))
        return result

    stamped.__name__ = getattr(call, "__name__", "send_email")
    try:
        stamped.__signature__ = inspect.signature(call)
    except (ValueError, TypeError):
        pass
    stamped.__annotations__ = getattr(call, "__annotations__", {})
    return stamped


def _record_teams_call(call, token_provider, on_sent):
    """Wrap a send_teams_message callable: nothing is stamped (Teams correlates by
    chat id), but the wait is bound to the chat the send returned. Mirrors
    nodes.record_send_teams_tool."""
    from ..nodes import _teams_chat_id

    async def recorded(**kwargs):
        result = await call(**kwargs)
        token = await token_provider()
        if token and on_sent is not None:
            await on_sent(token, _teams_chat_id(result))
        return result

    recorded.__name__ = getattr(call, "__name__", "send_teams_message")
    try:
        recorded.__signature__ = inspect.signature(call)
    except (ValueError, TypeError):
        pass
    recorded.__annotations__ = getattr(call, "__annotations__", {})
    return recorded


def make_stamping_tools_for(connectors: Optional[List[dict]], session_id: str,
                            user_id: str, plan, read_model):
    """A tools_for(step) provider that stamps the routing token into the send tool
    of any step a PLANNED await_reply depends on — the plan edge send->await IS the
    link (nodes._mail_stamping). Steps with no awaiting sibling get plain tools
    (nothing waits on them, so no token needed). LG has no runtime create_task, so
    the ADK eager/placeholder path is not needed here.
    """
    if not connectors:
        return lambda _step: []
    from src.smart_rag.tools.utilities.connector_tools import (
        create_connector_tools, ConnectorToolContext)
    from ..nodes import is_send_email_tool, is_send_teams_tool
    raw = create_connector_tools(connectors, ConnectorToolContext(session_id=session_id))
    rm = read_model

    await_step_for = {}
    for s in plan.steps:
        if s.kind == "await_reply":
            for dep in s.depends_on:
                await_step_for.setdefault(dep, s.id)  # first wins: one token per send

    def tools_for(step):
        await_id = await_step_for.get(step.id)
        if not await_id:
            return [_to_lc_tool(t) for t in raw]

        async def token_provider(_aid=await_id):
            return await rm.mail_token_for(session_id, _aid)

        async def on_sent_mail(token, recipients):
            if recipients:
                await rm.set_mail_wait_expected_from(token, ",".join(recipients))

        async def on_sent_teams(token, chat_id):
            await rm.bind_teams_wait_target(token, chat_id)

        out = []
        for t in raw:
            if is_send_email_tool(t):
                out.append(_lc_from_callable(
                    _stamp_email_call(t.func, token_provider, on_sent_mail), t))
            elif is_send_teams_tool(t):
                out.append(_lc_from_callable(
                    _record_teams_call(t.func, token_provider, on_sent_teams), t))
            else:
                out.append(_to_lc_tool(t))
        return out

    return tools_for
