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


def seed_private_history(source_session, history):
    """Carry only verified private context into an isolated successor turn.

    The caller selects a completed ancestor under the same app and user. Its
    complete visible transcript must match the supplied local seed exactly;
    edits, truncation and intermediate text conservatively start a fresh chain.
    Tool and reasoning items remain private and keep their original ordering.
    """
    if not source_session:
        return {}
    saved = source_session.state.get(STATE_KEY)
    if not saved or not saved.get('response_id'):
        return {}
    visible = []
    for event in source_session.events or []:
        if getattr(event, 'partial', False) or not event.content:
            continue
        text = ''.join(part.text or '' for part in event.content.parts or []
                       if not part.thought and not part.function_call
                       and not part.function_response).strip()
        receipt = saved.get('user_message') or {}
        if event.content.role == 'user' and text == receipt.get('rendered'):
            text = receipt['original'].strip()
        if text:
            visible.append(('user' if event.content.role == 'user' else 'assistant', text))
    entries = [(role, text.strip()) for role, text in history if text.strip()]
    if not entries or visible != entries:
        return {}
    # Use the pinned adapter's exact input shape. The signature is still checked
    # by prepare() against the successor's actual model, instructions and tools.
    seeded = copy.deepcopy(saved)
    seeded['projection'] = seed_projection(entries, 'assistant')
    seeded['seed_history'] = entries
    return {STATE_KEY: seeded}


def seed_projection(entries, agent_name):
    from google.adk.events import Event
    from google.adk.flows.llm_flows.contents import _get_contents
    from google.adk.integrations.openai import OpenAIResponsesLlm
    from google.adk.models.llm_request import LlmRequest
    from google.genai import types
    events = [Event(author='user' if role == 'user' else 'assistant',
                    content=types.Content(role='user' if role == 'user' else 'model',
                                          parts=[types.Part(text=text)])) for role, text in entries]
    # ADK presents seed events authored by "assistant" as another agent's
    # context when the current agent has a different name. Match that exact
    # pinned conversion instead of assuming model-role messages survive it.
    contents = _get_contents(None, events, agent_name=agent_name)
    return projection(OpenAIResponsesLlm(model='seed_projection')
                      ._get_response_input(LlmRequest(contents=contents)))


def prepare(model, request, kwargs):
    current = kwargs['input']
    saved = getattr(request, '_responses_history', None) or {}
    instructions = kwargs.get('instructions')
    timestamp = getattr(request, '_responses_timestamp', None)
    if timestamp and isinstance(instructions, str):
        instructions = instructions.replace(timestamp, '{time}')
    signature = hashlib.sha256(canonical({
        'model': kwargs['model'], 'endpoint': str(model.client.base_url),
        'scope': getattr(request, '_responses_scope', ''),
        'instructions': instructions, 'tools': kwargs.get('tools'),
        'instruction_template': getattr(request, '_responses_instruction_template', None),
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
    return {'signature': signature, 'projection': projected, 'items': items,
            'provider_chained': bool(kwargs.get('previous_response_id')),
            'user_message': getattr(request, '_responses_user_message', None)}


def select_reasoning(items, policy):
    # Auto is deliberately deterministic: retain the complete current tool loop.
    last_user = max((index for index, item in enumerate(items)
                     if item.get('type') == 'message' and item.get('role') == 'user'), default=0)
    return [item for index, item in enumerate(items)
            if item.get('type') != 'reasoning' or policy == 'all'
            or (policy in ('auto', 'last') and index > last_user)]


def install_history_callbacks(agent, conversation_api, scope, user_message=None):
    """Append to existing callbacks, preserving image injection and instrumentation."""
    async def before(callback_context, llm_request):
        if conversation_api != 'responses':
            if callback_context.state.get(STATE_KEY):
                await persist_private(callback_context, {})
            return None
        saved = copy.deepcopy(callback_context.state.get(STATE_KEY, {}))
        seeded = saved.pop('seed_history', None)
        if seeded:
            saved['projection'] = seed_projection(seeded, callback_context.agent_name)
        object.__setattr__(llm_request, '_responses_history', saved)
        object.__setattr__(llm_request, '_responses_scope', scope)
        # Only this known runtime timestamp substitution is volatile. Every
        # other instruction change still invalidates the configuration guard.
        template = getattr(agent, 'instruction', None)
        if isinstance(template, str) and '{time}' in template:
            object.__setattr__(llm_request, '_responses_instruction_template', template)
            object.__setattr__(llm_request, '_responses_timestamp', str(callback_context.state.get('time') or ''))
        if user_message is not None:
            rendered, original = user_message
            object.__setattr__(llm_request, '_responses_user_message',
                               {'rendered': rendered.strip(), 'original': original.strip()})
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
