"""Block-and-ask (human-in-the-loop) for the workflow.

Proven against ADK 2.3.0: a node returns a `RequestInput` to interrupt the run
requesting input from the user; the run surfaces the interrupt id; the turn
resumes by re-running with a response Part carrying that id, and the node
(rerun_on_resume) reads the answer from ctx.resume_inputs.

    run     → node returns RequestInput(iid, message) → interrupt(iid)
    (client shows the blocked step; user replies)
    resume  → run_async(new_message=Content(parts=[resume_part(iid, answer)]))
            → node reruns, ctx.resume_inputs[iid] == answer → continues

Durable resume across a disconnect/replica requires a persisted session
(DatabaseSessionService) so a fresh Runner can rehydrate the interrupt.
"""
from __future__ import annotations

from typing import Any, List, Mapping

from google.adk.agents.context import Context
from google.adk.events import Event
from google.adk.events.request_input import RequestInput
from google.adk.workflow import FunctionNode
from google.adk.workflow.utils._workflow_hitl_utils import (
    create_request_input_response,
    get_request_input_interrupt_ids,
)


def ask_user_interrupt_id(node_path: str) -> str:
    return f"ask:{node_path}"


def make_ask_user_node(name: str, question: str, *, state_key: str | None = None) -> FunctionNode:
    """A node that blocks asking the user `question`. On resume it writes the
    answer to session state under `state_key` (default: the node name) and
    returns it so downstream steps can use it."""
    key = state_key or name

    async def ask(ctx: Context):
        iid = ask_user_interrupt_id(ctx.node_path)
        answer = ctx.resume_inputs.get(iid)
        if answer is None:
            return RequestInput(interrupt_id=iid, message=question)
        ctx.state[key] = answer
        return {key: answer}

    ask.__name__ = name
    return FunctionNode(func=ask, name=name, rerun_on_resume=True)


def interrupt_ids(event: Event) -> List[str]:
    """Request-input interrupt ids on an event (empty if none)."""
    return get_request_input_interrupt_ids(event) or []


def resume_part(interrupt_id: str, answer: Mapping[str, Any]):
    """Build the message Part that resumes a blocked run with the user's answer."""
    return create_request_input_response(interrupt_id, answer)
