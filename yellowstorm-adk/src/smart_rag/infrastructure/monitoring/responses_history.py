"""Private Responses context in the existing ADK session, never message metadata.

The pinned ADK adapter deliberately drops reasoning on input. Keep the original
ordered provider items alongside their ADK projection; reuse them only while the
application transcript is an exact prefix. Edits/compaction/model switches rebase.
"""
from __future__ import annotations

import copy
import hashlib
import json

STATE_KEY = 'conversation_responses_history'


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), default=str)


def projection(items):
    """Compare semantic fields, ignoring provider IDs/status and JSON spacing."""
    result = []
    for original in items:
        item = copy.deepcopy(original)
        for key in ('id', 'status', 'phase'):
            item.pop(key, None)
        if item.get('type') == 'function_call':
            try:
                item['arguments'] = json.loads(item['arguments'])
            except (ValueError, TypeError, KeyError):
                pass
        result.append(canonical(item))
    return result


def prepare(model, request, kwargs):
    current = kwargs['input']
    saved = getattr(request, '_responses_history', None) or {}
    signature = hashlib.sha256(canonical({
        'model': kwargs['model'], 'endpoint': str(model.client.base_url),
        'scope': getattr(request, '_responses_scope', ''),
        'instructions': kwargs.get('instructions'), 'tools': kwargs.get('tools'),
        'reasoning': kwargs.get('reasoning'), 'history': model.history_mode,
        'replay': model.reasoning_history,
    }).encode()).hexdigest()
    projected = projection(current)
    prior = saved.get('projection', [])
    compatible = bool(saved and saved.get('signature') == signature
                      and projected[:len(prior)] == prior)
    delta = current[len(prior):] if compatible else current
    items = copy.deepcopy(saved['items']) + delta if compatible else copy.deepcopy(current)
    items = select_reasoning(items, model.reasoning_history)
    kwargs['store'] = model.history_mode == 'provider'
    kwargs.pop('previous_response_id', None)
    kwargs.pop('conversation', None)
    if model.history_mode == 'provider' and compatible and saved.get('response_id'):
        kwargs['previous_response_id'] = saved['response_id']
        kwargs['input'] = delta
    else:
        kwargs['input'] = select_reasoning(items, model.reasoning_history)
    return {'signature': signature, 'projection': projected, 'items': items}


def select_reasoning(items, policy):
    # Auto is deliberately deterministic: retain the complete current tool loop.
    last_user = max((index for index, item in enumerate(items)
                     if item.get('type') == 'message' and item.get('role') == 'user'), default=0)
    return [item for index, item in enumerate(items)
            if item.get('type') != 'reasoning' or policy == 'all'
            or (policy in ('auto', 'last') and index > last_user)]


def install_history_callbacks(agent, conversation_api, scope):
    """Append to existing callbacks, preserving image injection and instrumentation."""
    async def before(callback_context, llm_request):
        if conversation_api != 'responses':
            if callback_context.state.get(STATE_KEY):
                await persist_private(callback_context, {})
            return None
        object.__setattr__(llm_request, '_responses_history', copy.deepcopy(callback_context.state.get(STATE_KEY, {})))
        object.__setattr__(llm_request, '_responses_scope', scope)
        return None

    async def after(callback_context, llm_response):
        pending = getattr(llm_response, '_responses_commit', None)
        if pending is not None:
            await persist_private(callback_context, pending)
        return None

    for name, callback in (('before_model_callback', before), ('after_model_callback', after)):
        existing = getattr(agent, name, None)
        setattr(agent, name, [*(existing if isinstance(existing, list) else [existing] if existing else []), callback])


async def persist_private(callback_context, value):
    # A regular callback state delta is copied into the yielded answer Event.
    # Append a separate internal state event, never yielded to stream consumers.
    # This uses the existing session service and its revision/fencing contract.
    from google.adk.events import Event, EventActions
    context = callback_context._invocation_context
    await context.session_service.append_event(context.session, Event(
        invocation_id=context.invocation_id, author=context.agent.name,
        branch=getattr(context, 'branch', None),
        actions=EventActions(state_delta={STATE_KEY: value}),
    ))
