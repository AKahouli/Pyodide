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


ASK = "ask"     # answerable by the person in the chat
MAIL = "mail"   # answerable only by an incoming email reply


def ask_user_interrupt_id(node_path: str) -> str:
    return f"{ASK}:{node_path}"


def mail_reply_interrupt_id(node_path: str) -> str:
    return f"{MAIL}:{node_path}"


def is_ask(interrupt_id: str) -> bool:
    """True if a person typing in the chat may answer this interrupt.

    The prefix is what keeps the two kinds of wait apart. A session can hold both
    at once (a question for the owner, plus a step waiting on an email reply), so
    a chat message must never be routed to a `mail:` interrupt — it would answer
    a step whose reply hasn't arrived and let the plan run on fabricated input."""
    return interrupt_id.startswith(f"{ASK}:")


def _make_blocking_node(name: str, message: str, *, prefix: str,
                        state_key: str | None = None) -> FunctionNode:
    """A node that parks the run until someone supplies `message`'s answer.

    A FunctionNode, deliberately: its interrupt id derives from the node path, so
    it is stable across replays and a resume still matches — an LLM tool-call id
    is random on every rerun and never would."""
    key = state_key or name

    async def block(ctx: Context):
        iid = f"{prefix}:{ctx.node_path}"
        answer = ctx.resume_inputs.get(iid)
        if answer is None:
            return RequestInput(interrupt_id=iid, message=message)
        # Normalize {"value": "..."} -> "..." so downstream steps get the text.
        value = answer.get("value") if isinstance(answer, dict) and "value" in answer else answer
        ctx.state[key] = value
        return {key: value}

    block.__name__ = name
    return FunctionNode(func=block, name=name, rerun_on_resume=True)


def make_ask_user_node(name: str, question: str, *, state_key: str | None = None) -> FunctionNode:
    """A node that blocks asking the user `question`. On resume it writes the
    answer to session state under `state_key` (default: the node name) and
    returns it so downstream steps can use it."""
    return _make_blocking_node(name, question, prefix=ASK, state_key=state_key)


def make_await_reply_node(name: str, expect: str, *, state_key: str | None = None) -> FunctionNode:
    """A node that blocks until an email reply arrives, `expect` describing what
    is awaited. Resumed out of band by the mail webhook, not by the chat; on
    resume the reply body lands in session state under `state_key` (default: the
    node name) so downstream steps read it exactly like an answered question."""
    return _make_blocking_node(name, expect, prefix=MAIL, state_key=state_key)


def interrupt_ids(event: Event) -> List[str]:
    """Request-input interrupt ids on an event (empty if none)."""
    return get_request_input_interrupt_ids(event) or []


def resume_part(interrupt_id: str, answer: Mapping[str, Any]):
    """Build the message Part that resumes a blocked run with the user's answer."""
    return create_request_input_response(interrupt_id, answer)
