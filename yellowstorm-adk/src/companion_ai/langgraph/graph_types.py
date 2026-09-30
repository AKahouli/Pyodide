"""Shared types for the LangGraph orchestrator (breaks the graph<->hitl cycle).

The engine is a fixed executor LOOP, not a per-plan topology: the plan lives in
state as an ordered list of step dicts, and readiness (deps satisfied) is
recomputed every tick. A step can therefore insert new work at runtime (a
delegate/create_task) by editing the plan list — no graph reshape, which is what
made the old topology build unable to slot a step between two others.
"""
from __future__ import annotations

from typing import Annotated, Awaitable, Callable, Dict, List, Optional, TypedDict

# project(step_id, status, result=None) -> awaitable. None = don't project.
ProjectFn = Callable[..., Awaitable[None]]


def merge_results(a: Optional[dict], b: Optional[dict]) -> dict:
    return {**(a or {}), **(b or {})}


def merge_plan(a: Optional[list], b: Optional[list]) -> list:
    """Plan reducer: b entries update-or-append into a, keyed by step id, so
    concurrent workers (Send fan-out) editing different steps never clobber, and
    a partial dict (e.g. {id, depends_on}) merges onto the existing step. New ids
    append after the existing order (keeps ordinal-ish ordering stable)."""
    a = a or []
    if not b:
        return list(a)
    by_id = {s["id"]: dict(s) for s in a}
    order = [s["id"] for s in a]
    for s in b:
        sid = s["id"]
        if sid in by_id:
            by_id[sid] = {**by_id[sid], **s}
        else:
            by_id[sid] = dict(s)
            order.append(sid)
    return [by_id[i] for i in order]


class OrchState(TypedDict):
    # The plan itself: ordered list of step dicts (Step.model_dump(mode="json")).
    # Editable at runtime via merge_plan — this is how a step inserts follow-up
    # work between existing steps instead of reshaping a compiled graph.
    plan: Annotated[List[dict], merge_plan]
    # step_id -> result text. Every worker writes its own key; merged so parallel
    # branches don't clobber.
    results: Annotated[Dict[str, str], merge_results]
    # step_id -> the reply that arrived for an await_reply step. State-driven wait:
    # an await step is NOT ready until its reply lands here (written by
    # DeliverMailReply, then the graph is re-driven). No interrupt() -> the graph
    # never halts, so parallel waits don't block each other.
    replies: Annotated[Dict[str, str], merge_results]
