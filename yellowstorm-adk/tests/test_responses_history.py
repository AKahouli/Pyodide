"""Private history policies and real ADK callback persistence at a fake gateway."""
import copy
import json
from types import SimpleNamespace

import httpx
import pytest
from google.adk import Agent, Runner
from google.adk.models.llm_request import LlmRequest
from google.adk.sessions import InMemorySessionService
from google.genai import types
from openai import AsyncOpenAI

from src.smart_rag.infrastructure.monitoring.instrumented_lite_llm import InstrumentedResponsesLlm
from src.smart_rag.infrastructure.monitoring.responses_history import (
    STATE_KEY, install_history_callbacks, prepare, select_reasoning, seed_private_history,
)


def message(role, text):
    return {'type': 'message', 'role': role, 'content': text}


@pytest.mark.parametrize('changed', [False, 'edited', 'truncated', 'extra_text'])
def test_isolated_turn_seed_validates_visible_history_and_keeps_private_tool_order(changed):
    from google.adk.events import Event
    from google.adk.integrations.openai import OpenAIResponsesLlm
    entries = [('user', 'Question'), ('assistant', 'Answer')]
    events = [Event(author=role, content=types.Content(
        role='user' if role == 'user' else 'model', parts=[types.Part(text=text)]))
        for role, text in entries]
    events.insert(1, Event(author='assistant', content=types.Content(role='model',
        parts=[types.Part(text='Private summary', thought=True)])))
    raw = [message('user', 'Question'), {'type': 'reasoning', 'encrypted_content': 'opaque'},
           {'type': 'function_call', 'call_id': 'one'},
           {'type': 'function_call_output', 'call_id': 'one'}, message('assistant', 'Answer')]
    saved = {'signature': 'verified_later', 'response_id': 'resp_one', 'items': raw,
             'projection': ['original tool-inclusive projection']}
    source = SimpleNamespace(state={STATE_KEY: saved, 'unrelated_secret': 'never_copy'}, events=events)
    if changed == 'edited': entries[-1] = ('assistant', 'Edited')
    if changed == 'truncated': entries = entries[-1:]
    if changed == 'extra_text': events.append(Event(author='assistant', content=types.Content(
        role='model', parts=[types.Part(text='Intermediate text')])) )
    result = seed_private_history(source, entries)
    if changed:
        assert result == {}
    else:
        assert list(result) == [STATE_KEY]
        assert result[STATE_KEY]['items'] == raw
        assert result[STATE_KEY]['signature'] == saved['signature']
        expected = OpenAIResponsesLlm(model='test')._get_response_input(LlmRequest(contents=[
            event.content for event in (events[0], events[-1])]))
        from src.smart_rag.infrastructure.monitoring.responses_history import projection
        assert result[STATE_KEY]['projection'] == projection(expected)
        assert source.state[STATE_KEY]['projection'] == ['original tool-inclusive projection']


def test_seed_missing_or_cleared_lineage_never_resurrects_responses_state():
    assert seed_private_history(None, [('user', 'Question')]) == {}
    assert seed_private_history(SimpleNamespace(state={STATE_KEY: {}}, events=[]), []) == {}


def test_seed_trusted_user_receipt_matches_exact_runtime_wrapper_only():
    from google.adk.events import Event
    source = SimpleNamespace(state={STATE_KEY: {'response_id': 'resp_one', 'items': [],
        'user_message': {'rendered': 'Runtime snapshot + Question', 'original': 'Question'}}}, events=[
        Event(author='user', content=types.Content(role='user', parts=[types.Part(text='Runtime snapshot + Question')])),
        Event(author='agent', content=types.Content(role='model', parts=[types.Part(text='Answer')]))])
    assert STATE_KEY in seed_private_history(source, [('user', 'Question'), ('assistant', 'Answer')])
    source.events[0].content.parts[0].text = 'Changed wrapper + Question'
    assert seed_private_history(source, [('user', 'Question'), ('assistant', 'Answer')]) == {}


@pytest.mark.parametrize('policy_changed', [False, True])
def test_only_trusted_timestamp_substitution_is_volatile(policy_changed):
    model = SimpleNamespace(client=SimpleNamespace(base_url='http://gateway/v1'), history_mode='provider', reasoning_history='auto')
    request = LlmRequest()
    object.__setattr__(request, '_responses_timestamp', '2026-10-17T09:00')
    object.__setattr__(request, '_responses_instruction_template', 'Policy. Current timestamp is {time}.')
    kwargs = {'model': 'model', 'input': [message('user', 'Question')],
              'instructions': 'Policy. Current timestamp is 2026-10-17T09:00.'}
    saved = prepare(model, request, copy.deepcopy(kwargs))
    saved['response_id'] = 'resp_one'
    object.__setattr__(request, '_responses_history', saved)
    object.__setattr__(request, '_responses_timestamp', '2026-10-17T09:01')
    kwargs['instructions'] = ('Changed policy' if policy_changed else 'Policy') + '. Current timestamp is 2026-10-17T09:01.'
    kwargs['input'].append(message('user', 'Next'))
    prepare(model, request, kwargs)
    assert ('previous_response_id' in kwargs) is not policy_changed
    assert '2026-10-17T09:01' in kwargs['instructions']


@pytest.mark.parametrize('policy,expected', [('none', []), ('last', ['rs_new']), ('auto', ['rs_new']), ('all', ['rs_old', 'rs_new'])])
def test_replay_selects_whole_current_turn(policy, expected):
    items = [message('user', 'old'), {'type': 'reasoning', 'id': 'rs_old'},
             message('assistant', 'old answer'), message('user', 'new'),
             {'type': 'reasoning', 'id': 'rs_new'}, {'type': 'function_call', 'call_id': 'call_1'},
             {'type': 'function_call_output', 'call_id': 'call_1'}]
    selected = select_reasoning(items, policy)
    assert [item['id'] for item in selected if item['type'] == 'reasoning'] == expected
    assert selected[-2:] == items[-2:]


@pytest.mark.parametrize('change', ['model', 'scope', 'instructions', 'tools', 'history', 'edit'])
def test_incompatible_context_never_reuses_provider_chain(change):
    model = SimpleNamespace(client=SimpleNamespace(base_url='http://gateway/v1'), history_mode='provider', reasoning_history='auto')
    request = LlmRequest()
    object.__setattr__(request, '_responses_scope', 'agent_one')
    kwargs = {'model': 'model_one', 'input': [message('user', 'hello')], 'instructions': 'one'}
    saved = prepare(model, request, copy.deepcopy(kwargs))
    saved['response_id'] = 'resp_one'
    object.__setattr__(request, '_responses_history', saved)
    if change == 'model': kwargs['model'] = 'model_two'
    if change == 'scope': object.__setattr__(request, '_responses_scope', 'agent_two')
    if change == 'instructions': kwargs['instructions'] = 'two'
    if change == 'tools': kwargs['tools'] = [{'type': 'function', 'name': 'new'}]
    if change == 'history': model.history_mode = 'application'
    if change == 'edit': kwargs['input'] = [message('user', 'edited')]
    prepare(model, request, kwargs)
    assert 'previous_response_id' not in kwargs
    assert kwargs['input']


@pytest.mark.asyncio
@pytest.mark.parametrize('isolated', [False, True])
@pytest.mark.parametrize('mode,expired', [('application', False), ('provider', False), ('provider', True)])
async def test_runner_persists_private_items_across_reconstructed_adapter_and_tools(mode, expired, isolated):
    sent = []
    accepted = []
    rejected = []
    def handler(req):
        body = json.loads(req.content)
        sent.append(body)
        if expired and body.get('previous_response_id') == 'resp_1' and not rejected:
            rejected.append(True)
            return httpx.Response(404, json={'error': {'message': 'Expired synthetic chain',
                'type': 'invalid_request_error', 'code': 'previous_response_not_found'}})
        accepted.append(body)
        index = len(accepted)
        output = [{'type': 'reasoning', 'id': f'rs_{index}', 'summary': [{'type': 'summary_text', 'text': 'Checking facts'}],
                   'encrypted_content': f'opaque_secret_{index}'}]
        if index == 1:
            output.append({'type': 'function_call', 'id': 'fc_one', 'call_id': 'call_one',
                           'name': 'lookup', 'arguments': '{"value":"fixture"}', 'status': 'completed'})
        else:
            output.append({'type': 'message', 'id': f'msg_{index}', 'role': 'assistant', 'status': 'completed',
                           'content': [{'type': 'output_text', 'text': 'fixture', 'annotations': []}]})
        return httpx.Response(200, json={'id': f'resp_{index}', 'object': 'response', 'created_at': 1,
            'status': 'completed', 'model': 'gpt-5.4-mini', 'output': output,
            'usage': {'input_tokens': 10, 'output_tokens': 10, 'total_tokens': 20}})

    sessions = InMemorySessionService()
    session_id = 'session'
    await sessions.create_session(app_name='test', user_id='user', session_id='session')
    calls = []
    def lookup(value: str) -> dict:
        """Look up the fixture."""
        calls.append(value)
        return {'value': value}
    for text in ('Look up fixture', 'Repeat fixture'):
        if isolated and text == 'Repeat fixture':
            from google.adk.events import Event
            source = await sessions.get_session(app_name='test', user_id='user', session_id=session_id)
            history = [('user', 'Look up fixture'), ('assistant', 'fixture')]
            state = seed_private_history(source, history)
            assert STATE_KEY in state
            session_id = 'isolated_successor'
            seeded = await sessions.create_session(app_name='test', user_id='user', session_id=session_id, state=state)
            for role, value in history:
                await sessions.append_event(seeded, Event(author=role, content=types.Content(
                    role='user' if role == 'user' else 'model', parts=[types.Part(text=value)])))
        client = AsyncOpenAI(api_key='test', base_url='https://gateway.invalid/v1',
                             http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))
        model = InstrumentedResponsesLlm(model='gpt-5.4-mini', client=client,
            history_mode=mode, reasoning_history='all' if mode == 'application' else 'auto', summary_mode='auto',
            reasoning={'summary': 'auto'}, include=['reasoning.encrypted_content'])
        agent = Agent(name='agent_one', model=model, tools=[lookup])
        install_history_callbacks(agent, 'responses', 'agent_one')
        runner = Runner(agent=agent, app_name='test', session_service=sessions)
        events = [event async for event in runner.run_async(user_id='user', session_id=session_id,
            new_message=types.Content(role='user', parts=[types.Part(text=text)]))]
        public = json.dumps([event.model_dump(mode='json') for event in events])
        assert 'opaque_secret' not in public
        assert 'Checking facts' in public
        await client.close()
    assert calls == ['fixture']
    assert len(sent) == 3 + int(expired)
    assert sent[0]['store'] is (mode == 'provider')
    assert sent[0]['reasoning']['summary'] == 'auto'
    if mode == 'provider':
        assert sent[1]['previous_response_id'] == 'resp_1'
        assert sent[1]['input'][0]['type'] == 'function_call_output'
        assert sent[-1]['previous_response_id'] == 'resp_2'
        assert len(sent[-1]['input']) == 1
        if expired:
            assert 'previous_response_id' not in sent[2]
            assert any(item['type'] == 'function_call' for item in sent[2]['input'])
    else:
        assert all('previous_response_id' not in body for body in sent)
        assert any(item.get('encrypted_content') == 'opaque_secret_1' for item in sent[1]['input'])
    session = await sessions.get_session(app_name='test', user_id='user', session_id=session_id)
    assert 'opaque_secret_3' in json.dumps(session.state[STATE_KEY])
    assert session.state[STATE_KEY]['requested_reasoning']['summary'] == 'auto'
    # The Chat Completions callback clears lineage without changing its request.
    completion_agent = Agent(name='agent_one', model='placeholder')
    install_history_callbacks(completion_agent, 'chat_completions', 'agent_one')
    context = SimpleNamespace(state=session.state, _invocation_context=SimpleNamespace(
        session=session, session_service=sessions, invocation_id='completion', agent=completion_agent))
    await completion_agent.before_model_callback[-1](context, LlmRequest())
    assert session.state[STATE_KEY] == {}


@pytest.mark.asyncio
@pytest.mark.parametrize('reasoning_type', ['summary', 'content'])
@pytest.mark.parametrize('summary', ['off', 'auto'])
async def test_native_stream_summary_is_independent_of_private_replay(summary, reasoning_type):
    from tests.test_native_responses import response
    reasoning = {'type': 'reasoning', 'id': 'rs_stream', 'summary': [
                    {'type': 'summary_text', 'text': 'Checking facts'},
                    {'type': 'summary_text', 'text': 'Comparing evidence'}],
                 'encrypted_content': 'opaque_secret_stream'}
    if reasoning_type == 'content':
        reasoning['content'] = reasoning.pop('summary')
    final = response([reasoning, {'type': 'message', 'id': 'msg_stream', 'role': 'assistant', 'status': 'completed',
        'content': [{'type': 'output_text', 'text': 'Answer', 'annotations': []}]}])
    events = [
        {'type': 'response.created', 'response': {**final, 'status': 'in_progress', 'output': []}},
        {'type': 'response.output_item.added', 'output_index': 0, 'item': {**reasoning, 'summary': []}},
        {'type': 'response.reasoning_summary_text.delta', 'item_id': 'rs_stream', 'output_index': 0,
         'summary_index': 0, 'delta': 'Checking facts'},
        {'type': 'response.reasoning_summary_text.delta', 'item_id': 'rs_stream', 'output_index': 0,
         'summary_index': 1, 'delta': 'Comparing evidence'},
        {'type': 'response.output_item.done', 'output_index': 0, 'item': reasoning},
        {'type': 'response.output_text.delta', 'item_id': 'msg_stream', 'output_index': 1, 'content_index': 0, 'delta': 'Answer'},
        {'type': 'response.completed', 'response': final},
    ]
    if reasoning_type == 'content':
        for event in events:
            if event['type'] == 'response.reasoning_summary_text.delta':
                event['type'] = 'response.reasoning_text.delta'
    def handler(req):
        return httpx.Response(200, headers={'content-type': 'text/event-stream'},
            text=''.join(f'event: {event["type"]}\ndata: {json.dumps(event)}\n\n' for event in events))
    client = AsyncOpenAI(api_key='test', base_url='https://gateway.invalid/v1',
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    model = InstrumentedResponsesLlm(model='gpt-4.1', client=client, reasoning_history='all', summary_mode=summary)
    request = LlmRequest(contents=[types.Content(role='user', parts=[types.Part(text='Question')])])
    results = [result async for result in model.generate_content_async(request, stream=True)]
    public = json.dumps([result.model_dump(mode='json') for result in results])
    assert 'opaque_secret_stream' not in public
    assert ('Checking facts' in public) is (summary != 'off')
    assert 'Answer' in public
    final_thoughts = [part.text for result in results if result.partial is not True
                     for part in getattr(result.content, 'parts', None) or [] if part.thought]
    assert final_thoughts == (['Checking facts\n\nComparing evidence'] if summary == 'auto' else [])
    streamed_thoughts = [part.text for result in results if result.partial is True
                        for part in getattr(result.content, 'parts', None) or [] if part.thought]
    assert streamed_thoughts == (['Checking facts', 'Comparing evidence'] if summary == 'auto' else [])
    for result in results:
        has_summary = any(part.thought and part.text for part in getattr(result.content, 'parts', None) or [])
        assert (result.custom_metadata or {}).get('activity_kind') == ('reasoning_summary' if has_summary and reasoning_type == 'summary' else None)
    commit = next(result._responses_commit for result in results if hasattr(result, '_responses_commit'))
    assert any(item.get('encrypted_content') == 'opaque_secret_stream' for item in commit['items'])
    await client.close()
