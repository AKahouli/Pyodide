"""Shared types + state reducers for the LangGraph orchestrator.

The engine is a scheduler-driven Functional-API entrypoint, not a StateGraph: the
plan lives in the entrypoint's persisted state as an ordered list of step dicts,
and readiness (deps satisfied + any state-driven wait cleared) is recomputed each
loop pass. A step can insert new work at runtime by returning new steps, which the
loop merges into the plan (via merge_plan) — no graph reshape. OrchState documents
that state shape; merge_plan/merge_results are how the entrypoint folds each
input (a new reply/answer/plan edit) onto the checkpointed `previous`.
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
    # step_id -> the user's answer for an ask step. Same state-driven mechanism as
    # replies: an ask step is NOT ready until its answer lands here (written by
    # resume). No interrupt() -> parallel asks don't block each other either.
    answers: Annotated[Dict[str, str], merge_results]
