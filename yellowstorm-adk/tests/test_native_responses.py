"""Native SDK boundary regressions; no network or shared database required."""
import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from google.adk.models.lite_llm import LiteLlm
from google.adk.models.llm_request import LlmRequest
from google.genai import types
from openai import AsyncOpenAI

from src.root_runtime.model_capacity import CapacityClient
from src.smart_rag.infrastructure.factories.llm_factory import LLMFactory
from src.smart_rag.infrastructure.monitoring.instrumented_lite_llm import InstrumentedResponsesLlm


def request(text='Hello'):
    return LlmRequest(contents=[types.Content(role='user', parts=[types.Part(text=text)])])


def response(output=None):
    return {'id': 'resp_test', 'object': 'response', 'created_at': 1, 'status': 'completed',
            'model': 'gpt-4.1', 'output': output or [{'type': 'message', 'id': 'msg_test',
                'role': 'assistant', 'status': 'completed',
                'content': [{'type': 'output_text', 'text': 'Hello', 'annotations': []}]}],
            'usage': {'input_tokens': 3, 'output_tokens': 2, 'total_tokens': 5,
                      'input_tokens_details': {'cached_tokens': 1},
                      'output_tokens_details': {'reasoning_tokens': 1}}}


def model_with_transport(handler, **kwargs):
    client = AsyncOpenAI(api_key='test', base_url='https://gateway.invalid/v1',
                         http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    return InstrumentedResponsesLlm(model='gpt-4.1', client=client, **kwargs)


def test_factory_preserves_gateway_alias_and_parameters_and_other_providers():
    old = LiteLlm(model='azure/gpt-5.4-mini', max_completion_tokens=321,
                  temperature=1, reasoning_effort='high', parallel_tool_calls=True,
                  timeout=90, num_retries=1, user='fixture')
    native = LLMFactory.for_conversation(old, 'responses')
    assert isinstance(native, InstrumentedResponsesLlm)
    assert native.model == old.model and native.store is False
    assert native.reasoning == {'effort': 'high'}
    assert native.extra_request_args == {'max_output_tokens': 321, 'temperature': 1, 'user': 'fixture'}
    assert native.parallel_tool_calls is True and native.client.timeout == 90
    other = LiteLlm(model='ollama/llama3')
    assert LLMFactory.for_conversation(other) is other
    assert LLMFactory.for_conversation(native) is native


@pytest.mark.asyncio
async def test_explicit_api_selection_defaults_to_completions_and_supports_custom_alias():
    for name in ('gpt-5.4-mini', 'azure/gpt-test', 'custom-gateway-alias', 'ollama/llama3'):
        old = LiteLlm(model=name)
        assert LLMFactory.for_conversation(old) is old
        assert LLMFactory.for_conversation(old, 'chat_completions') is old
        native = LLMFactory.for_conversation(old, 'responses')
        assert isinstance(native, InstrumentedResponsesLlm)
        assert native.model == name
        await native.client.close()
    with pytest.raises(ValueError, match='Unsupported conversation API'):
        LLMFactory.for_conversation(old, 'automatic')


@pytest.mark.asyncio
async def test_native_request_replays_full_history_without_provider_state():
    seen = []
    def handler(req):
        seen.append(json.loads(req.content))
        assert req.url.path == '/v1/responses'
        return httpx.Response(200, json=response())
    model = model_with_transport(handler, store=True, parallel_tool_calls=True,
                                extra_request_args={'previous_response_id': 'forbidden', 'conversation': 'forbidden'})
    incoming = request()
    incoming.previous_interaction_id = 'resp_previous'
    incoming.contents.insert(0, types.Content(role='model', parts=[types.Part(text='Previous answer')]))
    results = [item async for item in model.generate_content_async(incoming)]
    assert seen[0]['store'] is False
    assert 'previous_response_id' not in seen[0] and 'conversation' not in seen[0]
    assert 'parallel_tool_calls' not in seen[0]
    assert len(seen[0]['input']) == 2 and incoming.previous_interaction_id == 'resp_previous'
    assert results[-1].content.parts[0].text == 'Hello'
    assert results[-1].usage_metadata.cached_content_token_count == 1
    assert results[-1].usage_metadata.thoughts_token_count == 1
    await model.client.close()


@pytest.mark.asyncio
async def test_streamed_tool_call_releases_capacity_before_final_call_and_tracks_latency(monkeypatch):
    pool = SimpleNamespace(acquire=AsyncMock(return_value='permit'), transition=AsyncMock())
    monkeypatch.setattr('src.root_runtime.model_capacity.capacity_pool', lambda: pool)
    monkeypatch.setattr('src.config.settings.get_settings', lambda: SimpleNamespace(ROOT_WORK_LLM_CAPACITY_ENABLED=True))
    final = response([{'type': 'function_call', 'id': 'fc_test', 'call_id': 'call_test',
                       'name': 'lookup', 'arguments': '{"value":7}', 'status': 'completed'}])
    events = [
        {'type': 'response.created', 'response': {**final, 'status': 'in_progress', 'output': []}},
        {'type': 'response.output_item.added', 'output_index': 0, 'item': {**final['output'][0], 'arguments': ''}},
        {'type': 'response.function_call_arguments.delta', 'item_id': 'fc_test', 'output_index': 0, 'delta': '{"value":7}'},
        {'type': 'response.output_item.done', 'output_index': 0, 'item': final['output'][0]},
        {'type': 'response.completed', 'response': final},
    ]
    def handler(req):
        return httpx.Response(200, headers={'content-type': 'text/event-stream'},
            text=''.join(f'event: {event["type"]}\ndata: {json.dumps(event)}\n\n' for event in events))
    # Markers are synchronous; verify the actual trace with its public context API.
    from src.smart_rag.infrastructure.monitoring.conversation_latency import (
        start_conversation_latency_trace, get_current_conversation_latency_trace, reset_conversation_latency_trace)
    token = start_conversation_latency_trace('fixture', 'message', None)
    model = model_with_transport(handler)
    try:
        results = []
        async for item in model.generate_content_async(request(), stream=True):
            results.append(item)
            if item.content and not item.partial and any(p.function_call for p in item.content.parts):
                assert pool.transition.await_args.args == ('permit', 'free')
        assert any(p.function_call and p.function_call.id == 'call_test'
                   for item in results if item.content for p in item.content.parts)
        assert get_current_conversation_latency_trace().llm_request_start_perf_ns is not None
        assert get_current_conversation_latency_trace().llm_first_delta_perf_ns is not None
        assert model.client.max_retries == 2  # Gated copy disables SDK retries.
    finally:
        reset_conversation_latency_trace(token)
        await model.client.close()


@pytest.mark.asyncio
async def test_native_capacity_disables_sdk_retries_for_rejected_request(monkeypatch):
    pool = SimpleNamespace(acquire=AsyncMock(return_value='permit'), transition=AsyncMock())
    monkeypatch.setattr('src.root_runtime.model_capacity.capacity_pool', lambda: pool)
    monkeypatch.setattr('src.config.settings.get_settings', lambda: SimpleNamespace(ROOT_WORK_LLM_CAPACITY_ENABLED=True))
    count = 0
    def handler(req):
        nonlocal count
        count += 1
        return httpx.Response(429, json={'error': {'message': 'fixture', 'type': 'rate_limit'}})
    model = model_with_transport(handler)
    from openai import RateLimitError
    try:
        with pytest.raises(RateLimitError):
            _ = [item async for item in model.generate_content_async(request())]
        assert count == 1
        assert pool.transition.await_args.args == ('permit', 'free')
    finally:
        await model.client.close()


@pytest.mark.asyncio
@pytest.mark.parametrize('enabled', [False, True])
async def test_early_generator_close_closes_sdk_stream_and_retains_uncertain_capacity(monkeypatch, enabled):
    pool = SimpleNamespace(acquire=AsyncMock(return_value='permit'), transition=AsyncMock())
    monkeypatch.setattr('src.root_runtime.model_capacity.capacity_pool', lambda: pool)
    monkeypatch.setattr('src.config.settings.get_settings', lambda: SimpleNamespace(ROOT_WORK_LLM_CAPACITY_ENABLED=enabled))
    closed = asyncio.Event()
    class Body(httpx.AsyncByteStream):
        async def __aiter__(self):
            yield b'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","item_id":"msg_test","output_index":0,"content_index":0,"delta":"partial"}\n\n'
            await asyncio.Event().wait()
        async def aclose(self):
            closed.set()
    model = model_with_transport(lambda req: httpx.Response(200,
        headers={'content-type': 'text/event-stream'}, stream=Body()))
    generator = model.generate_content_async(request(), stream=True)
    try:
        first = await asyncio.wait_for(anext(generator), timeout=2)
        assert first.partial and first.content.parts[0].text == 'partial'
        await generator.aclose()
        assert closed.is_set()
        if enabled:
            assert pool.transition.await_args.args == ('permit', 'outcome_unknown')
        else:
            pool.acquire.assert_not_awaited()
    finally:
        await generator.aclose()
        await model.client.close()


@pytest.mark.asyncio
async def test_parallel_tool_history_and_final_tools_are_preserved():
    model = model_with_transport(lambda req: httpx.Response(200, json=response()), parallel_tool_calls=True)
    incoming = request()
    incoming.config.tools = [types.Tool(function_declarations=[types.FunctionDeclaration(
        name='lookup', parameters_json_schema={'type': 'object', 'properties': {'value': {'type': 'integer'}}})])]
    incoming.contents.extend([
        types.Content(role='model', parts=[types.Part(function_call=types.FunctionCall(
            id=call, name='lookup', args={'value': value})) for call, value in [('call_a', 1), ('call_b', 2)]]),
        types.Content(role='user', parts=[types.Part(function_response=types.FunctionResponse(
            id=call, name='lookup', response={'result': value})) for call, value in [('call_a', 1), ('call_b', 2)]]),
    ])
    kwargs = model._get_response_create_kwargs(incoming, stream=True)
    assert kwargs['parallel_tool_calls'] is True
    assert kwargs['tools'][0]['name'] == 'lookup'
    assert [item['call_id'] for item in kwargs['input'] if item['type'] == 'function_call_output'] == ['call_a', 'call_b']
    await model.client.close()


@pytest.mark.asyncio
async def test_native_capacity_rejection_loss_cancellation_and_early_close():
    pool = SimpleNamespace(acquire=AsyncMock(return_value='permit'), transition=AsyncMock())
    class Rejected(Exception):
        status_code = 429
    resource = SimpleNamespace(create=AsyncMock(side_effect=Rejected()))
    gate = CapacityClient(resource, pool)
    with pytest.raises(Rejected):
        await gate.create(stream=False)
    assert pool.transition.await_args.args == ('permit', 'free')
    resource.create.side_effect = TimeoutError()
    with pytest.raises(TimeoutError):
        await gate.create(stream=False)
    assert pool.transition.await_args.args == ('permit', 'outcome_unknown')
    async def chunks():
        yield SimpleNamespace(type='response.output_text.delta')
    resource.create.side_effect = None
    resource.create.return_value = chunks()
    stream = await gate.create(stream=True)
    assert (await anext(stream)).type == 'response.output_text.delta'
    await stream.aclose()
    assert pool.transition.await_args.args == ('permit', 'outcome_unknown')
    entered = asyncio.Event()
    async def pending(**kwargs):
        entered.set()
        await asyncio.Event().wait()
    resource.create.side_effect = pending
    task = asyncio.create_task(gate.create(stream=False))
    await entered.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert pool.transition.await_args.args == ('permit', 'outcome_unknown')


@pytest.mark.asyncio
@pytest.mark.parametrize('tool', [False, True])
@pytest.mark.parametrize('enabled', [False, True])
async def test_clean_truncated_sse_never_completes_or_releases_capacity(monkeypatch, enabled, tool):
    pool = SimpleNamespace(acquire=AsyncMock(return_value='permit'), transition=AsyncMock())
    monkeypatch.setattr('src.root_runtime.model_capacity.capacity_pool', lambda: pool)
    monkeypatch.setattr('src.config.settings.get_settings', lambda: SimpleNamespace(ROOT_WORK_LLM_CAPACITY_ENABLED=enabled))
    if tool:
        events = [{'type': 'response.output_item.added', 'output_index': 0, 'item': {
            'type': 'function_call', 'id': 'fc_test', 'call_id': 'call_test', 'name': 'lookup', 'arguments': ''}},
            {'type': 'response.function_call_arguments.delta', 'output_index': 0, 'item_id': 'fc_test', 'delta': '{"value":7}'}]
    else:
        events = [{'type': 'response.output_text.delta', 'item_id': 'msg_test', 'output_index': 0,
                   'content_index': 0, 'delta': 'truncated'}]
    model = model_with_transport(lambda req: httpx.Response(200, headers={'content-type': 'text/event-stream'},
        text=''.join(f'event: {event["type"]}\ndata: {json.dumps(event)}\n\n' for event in events)))
    received = []
    try:
        with pytest.raises(ConnectionError, match='terminal event'):
            async for item in model.generate_content_async(request(), stream=True):
                received.append(item)
        assert all(item.partial for item in received)
        if enabled:
            assert pool.transition.await_args.args == ('permit', 'outcome_unknown')
    finally:
        await model.client.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("native", [False, True])
@pytest.mark.parametrize("streaming", [False, True])
async def test_capacity_timing_separates_admission_from_first_sdk_event(monkeypatch, native, streaming):
    from src.smart_rag.infrastructure.monitoring import conversation_latency as latency
    from src.smart_rag.infrastructure.monitoring import latency_diagnostics
    clock = [0]
    monkeypatch.setattr(latency.time, "perf_counter_ns", lambda: clock[0] * 1_000_000)
    logs = []
    monkeypatch.setattr(latency_diagnostics, "_emit", lambda *args: logs.append(args))
    trace = latency.ConversationLatencyTrace("request", "assistant", None)
    trace.mark_llm_request_start()
    token = latency.current_conversation_latency_trace.set(trace)
    async def acquire():
        clock[0] += 10
        return "permit"
    transitions = []
    async def transition(permit, status):
        transitions.append((permit, status))
        if status == "running":
            clock[0] += 20
    async def chunks():
        clock[0] += 50
        yield SimpleNamespace(type="response.created")
        clock[0] += 10
        yield SimpleNamespace(type="response.completed")
    async def create(**kwargs):
        clock[0] += 20
        if streaming:
            return chunks()
        clock[0] += 50
        return "response"
    pool = SimpleNamespace(acquire=acquire, transition=transition)
    gate = CapacityClient(SimpleNamespace(create=create, acompletion=create), pool)
    call = gate.create if native else gate.acompletion
    try:
        response = await call(stream=streaming)
        if streaming:
            assert "first_chunk" not in trace.provider_timing
            assert len([event async for event in response]) == 2
        clock[0] = 150
        trace.mark_llm_first_delta()
        assert trace.build_provider_timing_breakdown() == {
            "capacity_acquire_ms": 10.0,
            "capacity_running_transition_ms": 20.0,
            "upstream_first_chunk_ms": 70.0,
            "upstream_to_adk_response_ms": 120.0,
            "sdk_first_chunk_to_adk_response_ms": 50.0,
            "adapter_to_capacity_ms": 0.0,
        }
        assert logs[0][0] == "conversation_latency_diag.provider_timing"
        assert logs[0][2]["upstream_first_chunk_ms"] == 70.0
        first = dict(trace.provider_timing)
        response = await call(stream=streaming)
        if streaming:
            assert len([event async for event in response]) == 2
        trace.mark_llm_first_delta()
        assert trace.provider_timing == first
        assert len(logs) == 1
        assert transitions == [("permit", "running"), ("permit", "free")] * 2
    finally:
        latency.current_conversation_latency_trace.reset(token)


def test_provider_timing_omits_missing_and_invalid_intervals():
    from src.smart_rag.infrastructure.monitoring.conversation_latency import ConversationLatencyTrace
    trace = ConversationLatencyTrace("r", "a", None)
    assert trace.build_provider_timing_breakdown() == {}
    trace.provider_timing = {"acquire_start": 20_000_000, "acquire_end": 10_000_000,
                             "dispatch": 20_000_000, "first_chunk": 70_000_000_000}
    assert trace.build_provider_timing_breakdown() == {"capacity_running_transition_ms": 10.0}
