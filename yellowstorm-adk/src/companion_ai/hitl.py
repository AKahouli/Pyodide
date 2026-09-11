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
from google.adk.flows.llm_flows.functions import REQUEST_CONFIRMATION_FUNCTION_CALL_NAME
from google.adk.tools.tool_confirmation import ToolConfirmation
from google.genai import types


ASK = "ask"     # answerable by the person in the chat
MAIL = "mail"   # answerable only by an incoming email reply
CONFIRM = "confirm"  # a tool call the chat user must approve before it runs


def ask_user_interrupt_id(node_path: str) -> str:
    return f"{ASK}:{node_path}"


def mail_reply_interrupt_id(node_path: str) -> str:
    return f"{MAIL}:{node_path}"


def is_ask(interrupt_id: str) -> bool:
    """True if a person typing in the chat may answer this interrupt.

    The prefix is what keeps the kinds of wait apart. A session can hold several
    at once (a question for the owner, a step waiting on an email reply, a send
    awaiting approval), so a chat message must never be routed to a `mail:`
    interrupt — it would answer a step whose reply hasn't arrived and let the
    plan run on fabricated input. A `confirm::` interrupt IS chat-answerable
    (the owner clicks approve/decline), so it counts as an ask here — but its
    resume part differs (see confirmation_resume_part)."""
    return interrupt_id.startswith(f"{ASK}:") or is_confirm(interrupt_id)


# A confirmation interrupt id is stored as "confirm::<adk_fc_id>": the suffix is
# the exact random id ADK minted for the adk_request_confirmation call, which
# resume MUST feed back verbatim (ADK resolves the pending tool by that id
# against the durable session events). We tag the kind on the front so resume
# and projection can tell it apart from ask:/mail:, and strip it before ADK.
def confirm_interrupt_id(fc_id: str) -> str:
    return f"{CONFIRM}::{fc_id}"


def is_confirm(interrupt_id: str) -> bool:
    return interrupt_id.startswith(f"{CONFIRM}::")


def confirm_fc_id(interrupt_id: str) -> str:
    """The raw ADK confirmation function-call id inside a `confirm::` id."""
    return interrupt_id[len(CONFIRM) + 2:]


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


def confirmation_interrupts(event: Event) -> List[tuple[str, dict]]:
    """Tool-confirmation interrupts on an event, as [(stored_id, preview), ...].

    A tool marked require_confirmation raises a separate `adk_request_confirmation`
    long-running function call (see google.adk functions.generate_request_confirmation_event)
    that `get_request_input_interrupt_ids` (hence `interrupt_ids`) does NOT report —
    it matches only `adk_request_input`. This surfaces the confirmation kind so the
    turn parks on it too. `preview` carries the gated call for the UI: the tool name
    and its args (for send_email: to/subject/body; for send_teams: the message)."""
    out: List[tuple[str, dict]] = []
    for fc in (event.get_function_calls() or []):
        if fc.name != REQUEST_CONFIRMATION_FUNCTION_CALL_NAME or not fc.id:
            continue
        original = (fc.args or {}).get("originalFunctionCall") or {}
        out.append((confirm_interrupt_id(fc.id),
                    {"tool": original.get("name"), "args": original.get("args") or {}}))
    return out


def confirmation_resume_part(fc_id: str, *, confirmed: bool, payload=None):
    """Build the Part that answers an adk_request_confirmation with the owner's
    verdict. `fc_id` is the raw ADK id (strip a stored id with confirm_fc_id).
    `payload` carries the owner's edits (edit-on-card): ADK exposes it on the
    tool as tool_context.tool_confirmation.payload, which the connector tool
    merges into the send args before dispatch.

    ADK's native confirmation processor re-invokes the ORIGINAL gated tool by id
    from the durable events — confirmed → it runs in place; not confirmed → the
    model gets "This tool call is rejected." This survives resume_turn's rebuild
    because the step sees its scoped history (include_contents='default') and its
    node_input is None, so the verdict stays the last user turn."""
    return types.Part(function_response=types.FunctionResponse(
        id=fc_id,
        name=REQUEST_CONFIRMATION_FUNCTION_CALL_NAME,
        response=ToolConfirmation(
            confirmed=confirmed, payload=payload).model_dump(by_alias=True, exclude_none=True),
    ))
