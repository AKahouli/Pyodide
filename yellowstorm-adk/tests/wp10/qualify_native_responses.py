"""Opt-in gateway smoke: selected API streaming, tools, history and capacity.

Run from yellowstorm-adk with --env-file pointing to a private runtime .env.
Only synthetic inputs are sent; no application conversations are read or changed.
"""
import argparse
import asyncio
import json
import sys
from pathlib import Path
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))


async def main(args):
    from dotenv import load_dotenv
    load_dotenv(args.env_file)
    from src.config.settings import get_settings
    from openai import AsyncOpenAI
    settings = get_settings()
    async with AsyncOpenAI(base_url=settings.LITELLM_API_BASE_URL,
                           api_key=settings.LITELLM_API_SECRET_KEY,
                           timeout=45, max_retries=0) as discovery:
        names = [model.id for model in (await discovery.models.list()).data]
    if args.list_models:
        print(json.dumps({'models': names, 'capacity_enabled': settings.ROOT_WORK_LLM_CAPACITY_ENABLED,
                          'capacity_database_configured': bool(settings.ROOT_WORK_DATABASE_URL)}))
        return
    assert args.model in names, 'Requested model is absent from gateway catalog'
    if args.switch_model:
        assert args.switch_model in names, 'Switch model is absent from gateway catalog'
        assert args.switch_model != args.model, 'Switch qualification requires two distinct gateway models'
        await qualify_switches(args, settings)
        return

    from google.adk import Agent, Runner
    from google.adk.agents.run_config import RunConfig, StreamingMode
    from google.adk.sessions import InMemorySessionService
    from google.genai import types
    from src.smart_rag.infrastructure.factories.llm_factory import LLMFactory
    from src.smart_rag.infrastructure.monitoring.conversation_latency import (
        start_conversation_latency_trace, get_current_conversation_latency_trace,
        reset_conversation_latency_trace,
    )
    from src.root_runtime.model_capacity import CapacityClient

    if args.capacity:
        assert settings.ROOT_WORK_DATABASE_URL, 'Capacity database is not configured'
        settings.ROOT_WORK_LLM_CAPACITY_ENABLED = True
    model = LLMFactory.for_conversation(LLMFactory.create_parallel_tool_calls_llm(
        {'provider': args.model, 'reasoning_effort': args.effort}, temperature=None,
        max_completion_tokens=2048), args.api,
        responses_history_mode=args.history, reasoning_history=args.replay, reasoning_summary=args.summary)
    native = args.api == 'responses'
    assert model.__class__.__name__ == ('InstrumentedResponsesLlm' if native else 'InstrumentedLiteLlm')
    if args.capacity:
        assert isinstance(model._openai_client.responses if native else model.llm_client, CapacityClient)
    owned = {}
    if settings.ROOT_WORK_LLM_CAPACITY_ENABLED:
        from src.root_runtime.model_capacity import capacity_pool
        pool = capacity_pool()
        acquire, transition = pool.acquire, pool.transition
        async def acquire_owned(*args, **kwargs):
            permit = await acquire(*args, **kwargs)
            owned[permit] = 'reserved'
            return permit
        async def transition_owned(permit, status):
            await transition(permit, status)
            owned[permit] = status
        pool.acquire, pool.transition = acquire_owned, transition_owned

    sent = []
    async def inspect_request(req):
        if req.url.path.endswith('/responses'):
            body = json.loads(req.content)
            assert body['store'] is (args.history == 'provider')
            assert 'conversation' not in body
            assert body['stream'] is True
            sent.append(body)
    if native:
        model.client._client.event_hooks['request'].append(inspect_request)
    else:
        # Inspect the actual LiteLLM completion boundary, preserving capacity ownership.
        resource = model.llm_client
        original_completion = resource.acompletion
        async def inspect_completion(**kwargs):
            assert kwargs['stream'] is True
            sent.append(kwargs)
            return await original_completion(**kwargs)
        resource.acompletion = inspect_completion
    calls = []
    def lookup_marker(value: str) -> dict:
        """Return a synthetic marker for this smoke test."""
        calls.append(value)
        return {'marker': value}
    agent = Agent(name='native_responses_smoke', model=model, tools=[lookup_marker],
                  instruction='Follow the user instructions exactly. Use lookup_marker when requested.')
    from src.smart_rag.infrastructure.monitoring.responses_history import install_history_callbacks, STATE_KEY
    install_history_callbacks(agent, args.api, 'smoke')
    sessions = InMemorySessionService()
    run_id = uuid4().hex
    await sessions.create_session(app_name='native_responses_smoke', user_id='smoke', session_id=run_id)
    runner = Runner(agent=agent, app_name='native_responses_smoke', session_service=sessions)
    marker = 'fixture_' + run_id[:12]
    text_counts = []
    summary_events = 0
    # Marker echo/tool plumbing alone may require no reasoning and legitimately
    # return no summary. Require actual reasoning work for summary qualification.
    summary_task = ('First solve this scheduling puzzle: A precedes C, B follows D, '
        'C immediately precedes E, and D is neither first nor last. Find all valid '
        'orders of A B C D E and check completeness. Then ' if args.require_summary or args.require_replay else '')
    try:
        for prompt in (summary_task + f'Call lookup_marker with value {marker}. Then reply with its marker.',
                       'Without calling any tool, repeat the marker from our previous turn.'):
            token = start_conversation_latency_trace(run_id, uuid4().hex, None)
            try:
                text, partials = '', 0
                async for event in runner.run_async(user_id='smoke', session_id=run_id,
                    new_message=types.Content(role='user', parts=[types.Part(text=prompt)]),
                    run_config=RunConfig(streaming_mode=StreamingMode.SSE, max_llm_calls=5)):
                    for part in getattr(event.content, 'parts', None) or []:
                        assert not part.thought_signature, 'Opaque replay state leaked into public event'
                        summary_events += int(bool(part.text and part.thought))
                        if part.text and not part.thought:
                            text += part.text
                            partials += int(bool(event.partial))
                assert marker in text, 'Marker missing from answer'
                trace = get_current_conversation_latency_trace()
                assert trace.llm_request_start_perf_ns is not None and trace.llm_first_delta_perf_ns is not None
                text_counts.append(partials)
            finally:
                reset_conversation_latency_trace(token)
        assert calls == [marker], 'Expected exactly one local tool execution'
        assert len(sent) >= 3
        if native:
            state = (await sessions.get_session(app_name='native_responses_smoke', user_id='smoke', session_id=run_id)).state.get(STATE_KEY, {})
            print(json.dumps({'diagnostics': {'request_reasoning': [body.get('reasoning') for body in sent],
                'chained': [bool(body.get('previous_response_id')) for body in sent],
                'replayed_reasoning_items': [sum(item.get('type') == 'reasoning' for item in body['input']) for body in sent],
                'retained_reasoning_items': sum(item.get('type') == 'reasoning' for item in state.get('items', [])),
                'retained_encrypted_reasoning_items': sum(item.get('type') == 'reasoning' and bool(item.get('encrypted_content'))
                    for item in state.get('items', [])),
                'native_summary_events': summary_events}}))
            assert any(item.get('type') == 'function_call_output'
                       for body in sent for item in body['input'])
            if args.history == 'provider':
                assert all(body.get('previous_response_id') for body in sent[1:]), 'Provider chain was not continued'
                assert len(sent[-1]['input']) == 1, 'Historical input duplicated in provider chain'
            else:
                assert all('previous_response_id' not in body for body in sent)
                if args.replay == 'none':
                    assert not any(item.get('type') == 'reasoning'
                        for body in sent for item in body['input']), 'Replay Off sent reasoning items'
                if args.replay != 'none' and args.require_replay:
                    assert any(item.get('type') == 'reasoning' and item.get('encrypted_content')
                               for body in sent[1:] for item in body['input']), 'Encrypted reasoning was not replayed'
                    if args.replay in ('last', 'auto'):
                        assert not any(item.get('type') == 'reasoning' for item in sent[-1]['input']), 'Current-turn replay crossed a user boundary'
                    elif args.replay == 'all':
                        assert any(item.get('type') == 'reasoning' and item.get('encrypted_content')
                            for item in sent[-1]['input']), 'All-history replay lost prior-turn reasoning'
            if args.require_summary:
                assert summary_events > 0, 'No native summary was observed'
        else:
            assert any(message.get('role') == 'tool'
                       for body in sent for message in body['messages'])
        assert all(count > 0 for count in text_counts), 'No partial text stream observed'
        if settings.ROOT_WORK_LLM_CAPACITY_ENABLED:
            assert len(owned) == len(sent) and all(status == 'free' for status in owned.values()), 'Owned capacity did not release'
        print(json.dumps({'outcome': 'PASS', 'model': args.model, 'api': args.api, 'provider_requests': len(sent),
                          'local_tool_calls': len(calls), 'partial_text_events_per_turn': text_counts,
                          'history_mode': args.history if native else 'application',
                          'reasoning_replay': args.replay if native else 'not_applicable',
                          'encrypted_replay_observed': any(item.get('type') == 'reasoning' and item.get('encrypted_content')
                              for body in sent for item in body.get('input', [])) if native else None,
                          'native_summary_events': summary_events, 'instrumentation': 'PASS',
                          'capacity_enabled': settings.ROOT_WORK_LLM_CAPACITY_ENABLED,
                          'owned_capacity_released': len(owned)}))
    finally:
        if native:
            await model.client.close()
        if settings.ROOT_WORK_LLM_CAPACITY_ENABLED:
            from src.root_runtime.model_capacity import capacity_pool
            await capacity_pool().engine.dispose()


async def qualify_switches(args, settings):
    """Exercise real API/model/history transitions in one unchanged ADK session."""
    from google.adk import Agent, Runner
    from google.adk.agents.run_config import RunConfig, StreamingMode
    from google.adk.sessions import InMemorySessionService
    from google.genai import types
    from src.smart_rag.infrastructure.factories.llm_factory import LLMFactory
    from src.smart_rag.infrastructure.monitoring.responses_history import install_history_callbacks, STATE_KEY
    from src.smart_rag.infrastructure.monitoring.conversation_latency import (
        start_conversation_latency_trace, get_current_conversation_latency_trace, reset_conversation_latency_trace,
    )
    from src.root_runtime.model_capacity import CapacityClient

    if args.capacity:
        assert settings.ROOT_WORK_DATABASE_URL, 'Capacity database is not configured'
        settings.ROOT_WORK_LLM_CAPACITY_ENABLED = True
    owned = {}
    pool = None
    if settings.ROOT_WORK_LLM_CAPACITY_ENABLED:
        from src.root_runtime.model_capacity import capacity_pool
        pool = capacity_pool()
        acquire, transition = pool.acquire, pool.transition
        async def acquire_owned(*pos, **kw):
            permit = await acquire(*pos, **kw)
            owned[permit] = 'reserved'
            return permit
        async def transition_owned(permit, status):
            await transition(permit, status)
            owned[permit] = status
        pool.acquire, pool.transition = acquire_owned, transition_owned

    calls, sent, reports, expected_calls = [], [], [], []
    models = []
    def lookup_marker(value: str) -> dict:
        """Return the synthetic marker requested by this qualification."""
        calls.append(value)
        return {'marker': value}
    session_id = 'switch_' + uuid4().hex
    initial_marker = 'fixture_' + session_id[-12:]
    sessions = InMemorySessionService()
    await sessions.create_session(app_name='switch_smoke', user_id='smoke', session_id=session_id)
    segments = [
        (args.model, 'responses', 'application', 'all'),
        (args.model, 'responses', 'provider', 'auto'),
        (args.switch_model, 'responses', 'provider', 'auto'),
        (args.switch_model, 'chat_completions', 'application', 'auto'),
        (args.model, 'responses', 'provider', 'auto'),
    ]
    instruction = 'Follow the user exactly. Call lookup_marker only when requested. Retain user markers across turns.'
    try:
        for index, (name, api, history, replay) in enumerate(segments):
            model = LLMFactory.for_conversation(LLMFactory.create_parallel_tool_calls_llm(
                {'provider': name, 'reasoning_effort': args.effort}, temperature=None,
                max_completion_tokens=4096), api, responses_history_mode=history,
                reasoning_history=replay, reasoning_summary=args.summary)
            models.append((api, model))
            native = api == 'responses'
            requests = []
            if settings.ROOT_WORK_LLM_CAPACITY_ENABLED:
                assert isinstance(model._openai_client.responses if native else model.llm_client, CapacityClient)
            if native:
                async def inspect_request(req, recorded=requests, mode=history):
                    if req.url.path.endswith('/responses'):
                        body = json.loads(req.content)
                        assert body['stream'] is True and body['store'] is (mode == 'provider')
                        assert 'conversation' not in body
                        recorded.append(body)
                        sent.append(body)
                model.client._client.event_hooks['request'].append(inspect_request)
            else:
                resource = model.llm_client
                original_completion = resource.acompletion
                async def inspect_completion(_original=original_completion, _recorded=requests, **kw):
                    assert kw['stream'] is True
                    assert not any(key in kw for key in ('previous_response_id', 'conversation', 'reasoning_history'))
                    _recorded.append(kw)
                    sent.append(kw)
                    return await _original(**kw)
                resource.acompletion = inspect_completion
            agent = Agent(name='switch_agent', model=model, tools=[lookup_marker], instruction=instruction)
            install_history_callbacks(agent, api, 'switch_agent')
            runner = Runner(agent=agent, app_name='switch_smoke', session_service=sessions)
            current_marker = 'tool_' + uuid4().hex[:12]
            expected_calls.append(current_marker)
            reasoning_task = ('First solve this scheduling puzzle: A precedes C, B follows D, '
                'C immediately precedes E, and D is neither first nor last. Find all valid '
                'orders of A B C D E and check completeness. Then ' if index == 0 else '')
            prompts = [reasoning_task + f'Call lookup_marker with value {current_marker}. Reply with its marker. '
                       + (f'The original session marker is {initial_marker}. Remember it.' if index == 0 else ''),
                       'Without tools, repeat the original session marker and the latest tool marker.']
            partial_counts = []
            for prompt in prompts:
                token = start_conversation_latency_trace(session_id, uuid4().hex, None)
                try:
                    text, partials = '', 0
                    async for event in runner.run_async(user_id='smoke', session_id=session_id,
                        new_message=types.Content(role='user', parts=[types.Part(text=prompt)]),
                        run_config=RunConfig(streaming_mode=StreamingMode.SSE, max_llm_calls=5)):
                        public = event.model_dump(mode='json')
                        assert 'encrypted_content' not in json.dumps(public), 'Opaque replay state leaked into public event'
                        for part in getattr(event.content, 'parts', None) or []:
                            assert not part.thought_signature, 'Encrypted thought signature leaked'
                            if part.text and not part.thought:
                                text += part.text
                                partials += int(bool(event.partial))
                    assert current_marker in text, 'Latest tool output missing after API/model switch'
                    if prompt == prompts[1]:
                        assert initial_marker in text, 'Original session context lost after switch'
                    assert partials > 0, 'No partial answer stream'
                    partial_counts.append(partials)
                    trace = get_current_conversation_latency_trace()
                    assert trace.llm_request_start_perf_ns is not None and trace.llm_first_delta_perf_ns is not None
                finally:
                    reset_conversation_latency_trace(token)
            state = (await sessions.get_session(app_name='switch_smoke', user_id='smoke', session_id=session_id)).state.get(STATE_KEY, {})
            assert len(requests) >= 3, 'Tool loop did not make expected provider requests'
            if native:
                print(json.dumps({'segment_diagnostics': index,
                    'retained_reasoning_items': sum(item.get('type') == 'reasoning' for item in state.get('items', [])),
                    'retained_encrypted_reasoning_items': sum(item.get('type') == 'reasoning' and bool(item.get('encrypted_content'))
                        for item in state.get('items', [])),
                    'replayed_encrypted_reasoning_items': [sum(item.get('type') == 'reasoning' and bool(item.get('encrypted_content'))
                        for item in body['input']) for body in requests],
                    'chained_requests': [bool(body.get('previous_response_id')) for body in requests]}), flush=True)
                assert not requests[0].get('previous_response_id'), 'Stale provider chain crossed model/API/history boundary'
                assert any(item.get('type') == 'function_call_output' for body in requests for item in body['input'])
                if history == 'provider':
                    assert all(body.get('previous_response_id') for body in requests[1:]), 'New provider chain failed to continue'
                    assert len(requests[-1]['input']) == 1, 'Provider chain duplicated old transcript'
                else:
                    assert all(not body.get('previous_response_id') for body in requests)
                    assert any(item.get('type') == 'reasoning' and item.get('encrypted_content')
                        for body in requests[1:] for item in body['input']), 'Application reasoning replay missing'
            else:
                assert not state, 'Chat Completions retained stale Responses lineage'
                assert any(message.get('role') == 'tool' for body in requests for message in body['messages'])
            reports.append({'model': name, 'api': api, 'history': history, 'requests': len(requests),
                            'chain_reset': True, 'partial_events': partial_counts})
            print(json.dumps({'segment_outcome': 'PASS', 'index': index, **reports[-1]}), flush=True)
        assert calls == expected_calls, 'Unexpected synthetic tool execution arguments or count'
        if pool:
            assert len(owned) == len(sent) and all(value == 'free' for value in owned.values()), 'Owned capacity did not release'
        print(json.dumps({'outcome': 'PASS', 'scenario': 'model_api_history_switches', 'turns': len(segments) * 2,
            'segments': reports, 'local_tool_calls': len(calls), 'provider_requests': len(sent),
            'public_replay_isolation': 'PASS', 'instrumentation': 'PASS', 'owned_capacity_released': len(owned)}))
    finally:
        for api, model in models:
            if api == 'responses':
                await model.client.close()
        if pool:
            pool.acquire, pool.transition = acquire, transition
            await pool.engine.dispose()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--env-file', required=True)
    parser.add_argument('--model', default='gpt-5.4-mini')
    parser.add_argument('--switch-model', help='Qualify model/API/history transitions using this second gateway model')
    parser.add_argument('--api', choices=['responses', 'chat_completions'], default='responses')
    parser.add_argument('--list-models', action='store_true')
    parser.add_argument('--capacity', action='store_true')
    parser.add_argument('--history', choices=['application', 'provider'], default='application')
    parser.add_argument('--replay', choices=['none', 'last', 'all', 'auto'], default='auto')
    parser.add_argument('--summary', choices=['off', 'auto', 'concise', 'detailed'], default='off')
    parser.add_argument('--effort', default='low')
    parser.add_argument('--require-summary', action='store_true', help='Fail if the provider returns no optional summary')
    parser.add_argument('--require-replay', action='store_true', help='Use a reasoning workload and require encrypted application replay')
    try:
        asyncio.run(main(parser.parse_args()))
    except Exception as error:
        # Gateway exceptions can contain credentials/URLs/provider payloads.
        print(json.dumps({'outcome': 'FAIL', 'error_type': type(error).__name__,
                          'check': str(error) if isinstance(error, AssertionError) else None,
                          'status_code': getattr(error, 'status_code', None)}))
        sys.exit(1)
