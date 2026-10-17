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
    STATE_KEY, install_history_callbacks, prepare, select_reasoning,
)


def message(role, text):
    return {'type': 'message', 'role': role, 'content': text}


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
@pytest.mark.parametrize('mode,expired', [('application', False), ('provider', False), ('provider', True)])
async def test_runner_persists_private_items_across_reconstructed_adapter_and_tools(mode, expired):
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
    await sessions.create_session(app_name='test', user_id='user', session_id='session')
    calls = []
    def lookup(value: str) -> dict:
        """Look up the fixture."""
        calls.append(value)
        return {'value': value}
    for text in ('Look up fixture', 'Repeat fixture'):
        client = AsyncOpenAI(api_key='test', base_url='https://gateway.invalid/v1',
                             http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))
        model = InstrumentedResponsesLlm(model='gpt-5.4-mini', client=client,
            history_mode=mode, reasoning_history='all' if mode == 'application' else 'auto', summary_mode='auto',
            reasoning={'summary': 'auto'}, include=['reasoning.encrypted_content'])
        agent = Agent(name='agent_one', model=model, tools=[lookup])
        install_history_callbacks(agent, 'responses', 'agent_one')
        runner = Runner(agent=agent, app_name='test', session_service=sessions)
        events = [event async for event in runner.run_async(user_id='user', session_id='session',
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
    session = await sessions.get_session(app_name='test', user_id='user', session_id='session')
    assert 'opaque_secret_3' in json.dumps(session.state[STATE_KEY])
    # The Chat Completions callback clears lineage without changing its request.
    completion_agent = Agent(name='agent_one', model='placeholder')
    install_history_callbacks(completion_agent, 'chat_completions', 'agent_one')
    context = SimpleNamespace(state=session.state, _invocation_context=SimpleNamespace(
        session=session, session_service=sessions, invocation_id='completion', agent=completion_agent))
    await completion_agent.before_model_callback[-1](context, LlmRequest())
    assert session.state[STATE_KEY] == {}


@pytest.mark.asyncio
@pytest.mark.parametrize('summary', ['off', 'auto'])
async def test_native_stream_summary_is_independent_of_private_replay(summary):
    from tests.test_native_responses import response
    reasoning = {'type': 'reasoning', 'id': 'rs_stream', 'summary': [{'type': 'summary_text', 'text': 'Checking facts'}],
                 'encrypted_content': 'opaque_secret_stream'}
    final = response([reasoning, {'type': 'message', 'id': 'msg_stream', 'role': 'assistant', 'status': 'completed',
        'content': [{'type': 'output_text', 'text': 'Answer', 'annotations': []}]}])
    events = [
        {'type': 'response.created', 'response': {**final, 'status': 'in_progress', 'output': []}},
        {'type': 'response.output_item.added', 'output_index': 0, 'item': {**reasoning, 'summary': []}},
        {'type': 'response.reasoning_summary_text.delta', 'item_id': 'rs_stream', 'output_index': 0,
         'summary_index': 0, 'delta': 'Checking facts'},
        {'type': 'response.output_item.done', 'output_index': 0, 'item': reasoning},
        {'type': 'response.output_text.delta', 'item_id': 'msg_stream', 'output_index': 1, 'content_index': 0, 'delta': 'Answer'},
        {'type': 'response.completed', 'response': final},
    ]
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
    commit = next(result._responses_commit for result in results if hasattr(result, '_responses_commit'))
    assert any(item.get('encrypted_content') == 'opaque_secret_stream' for item in commit['items'])
    await client.close()
