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
        {'provider': args.model, 'reasoning_effort': 'low'}, temperature=None,
        max_completion_tokens=1024), args.api)
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
            assert body['store'] is False
            assert 'previous_response_id' not in body and 'conversation' not in body
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
    sessions = InMemorySessionService()
    run_id = uuid4().hex
    await sessions.create_session(app_name='native_responses_smoke', user_id='smoke', session_id=run_id)
    runner = Runner(agent=agent, app_name='native_responses_smoke', session_service=sessions)
    marker = 'fixture_' + run_id[:12]
    text_counts = []
    try:
        for prompt in (f'Call lookup_marker with value {marker}. Then reply with its marker.',
                       'Without calling any tool, repeat the marker from our previous turn.'):
            token = start_conversation_latency_trace(run_id, uuid4().hex, None)
            try:
                text, partials = '', 0
                async for event in runner.run_async(user_id='smoke', session_id=run_id,
                    new_message=types.Content(role='user', parts=[types.Part(text=prompt)]),
                    run_config=RunConfig(streaming_mode=StreamingMode.SSE, max_llm_calls=5)):
                    for part in getattr(event.content, 'parts', None) or []:
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
            assert any(item.get('type') == 'function_call_output'
                       for body in sent for item in body['input'])
        else:
            assert any(message.get('role') == 'tool'
                       for body in sent for message in body['messages'])
        assert all(count > 0 for count in text_counts), 'No partial text stream observed'
        if settings.ROOT_WORK_LLM_CAPACITY_ENABLED:
            assert len(owned) == len(sent) and all(status == 'free' for status in owned.values()), 'Owned capacity did not release'
        print(json.dumps({'outcome': 'PASS', 'model': args.model, 'api': args.api, 'provider_requests': len(sent),
                          'local_tool_calls': len(calls), 'partial_text_events_per_turn': text_counts,
                          'application_history': 'PASS', 'instrumentation': 'PASS',
                          'capacity_enabled': settings.ROOT_WORK_LLM_CAPACITY_ENABLED,
                          'owned_capacity_released': len(owned)}))
    finally:
        if native:
            await model.client.close()
        if settings.ROOT_WORK_LLM_CAPACITY_ENABLED:
            from src.root_runtime.model_capacity import capacity_pool
            await capacity_pool().engine.dispose()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--env-file', required=True)
    parser.add_argument('--model', default='gpt-5.4-mini')
    parser.add_argument('--api', choices=['responses', 'chat_completions'], default='responses')
    parser.add_argument('--list-models', action='store_true')
    parser.add_argument('--capacity', action='store_true')
    try:
        asyncio.run(main(parser.parse_args()))
    except Exception as error:
        # Gateway exceptions can contain credentials/URLs/provider payloads.
        print(json.dumps({'outcome': 'FAIL', 'error_type': type(error).__name__,
                          'status_code': getattr(error, 'status_code', None)}))
        sys.exit(1)
