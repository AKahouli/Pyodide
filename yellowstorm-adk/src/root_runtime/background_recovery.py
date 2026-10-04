"""Pinned native-history reconciliation; model text alone is never completion."""
from dataclasses import dataclass
import re

from src.root_runtime.invocation import INPUT_FUNCTIONS


@dataclass(frozen=True)
class BackgroundRecovery:
    status: str
    text: str | None = None
    pending: tuple[tuple[str, str], ...] = ()


def classify_native_history(session, invocation_id, initial_event_id, agent_name):
    events = list(session.events) if session is not None else []
    if not invocation_id:
        return BackgroundRecovery('never_started' if not events and not initial_event_id else 'outcome_unknown')
    history = [event for event in events if event.invocation_id == invocation_id]
    if not initial_event_id or not any(event.id == initial_event_id and event.author == 'user' for event in history):
        return BackgroundRecovery('outcome_unknown')
    pending = {}
    outstanding = {}
    ended = False
    output = None
    native_error = False
    for event in history:
        parts = getattr(event.content, 'parts', None) or []
        for part in parts:
            call = part.function_call
            if call and call.id:
                outstanding[call.id] = call.name
                if call.name in INPUT_FUNCTIONS:
                    pending[call.id] = call.name
            response = part.function_response
            if response and response.id:
                outstanding.pop(response.id, None)
                pending.pop(response.id, None)
        key = getattr(event.node_info, 'path', '') or event.author
        # ADK 2.11 checkpoints include the invocation occurrence suffix;
        # nested paths must never complete the top-level worker.
        if event.author != agent_name or not (key == agent_name or re.fullmatch(re.escape(agent_name) + r'@[1-9][0-9]*', key)):
            continue
        native_error = native_error or bool(event.error_code or event.error_message)
        if event.actions.end_of_agent:
            ended = True
        elif event.actions.agent_state is not None or event.content:
            ended = False
        if event.content and event.content.role == 'model' and not event.partial:
            text = ''.join(part.text for part in parts if part.text and not part.thought)
            if text and not any(part.function_call or part.function_response for part in parts):
                output = text
    if pending:
        return BackgroundRecovery('waiting', pending=tuple(pending.items()))
    if native_error:
        return BackgroundRecovery('failed')
    if ended and not outstanding and output is not None:
        return BackgroundRecovery('completed', text=output)
    return BackgroundRecovery('resume')
