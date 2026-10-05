import asyncio
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import text

from src.root_runtime.model_capacity import CapacityClient, ModelCapacity
from tests.wp07.test_background_sessions import guarded_native


@pytest.mark.asyncio
async def test_separate_process_replicas_share_slots_and_join_cleanly(capacity, tmp_path):
    helper = tmp_path / 'capacity_replica.py'
    helper.write_text('''import asyncio, os, sys
from sqlalchemy.ext.asyncio import create_async_engine
from src.root_runtime.model_capacity import ModelCapacity
async def main():
    engine = create_async_engine(os.environ['VECTOR_QUALIFICATION_SQL'])
    pool = ModelCapacity(engine)
    permits = []
    try:
        for _ in range(15):
            permits.append(await pool.acquire())
        print('READY', flush=True)
        await asyncio.to_thread(sys.stdin.readline)
    finally:
        for permit in permits:
            await pool.transition(permit, 'free')
        await engine.dispose()
    print('CLEAN', flush=True)
asyncio.run(main())
''', encoding='utf-8')
    environment = {**os.environ, 'VECTOR_QUALIFICATION_SQL': capacity.engine.url.render_as_string(hide_password=False),
        'PYTHONPATH': str(Path(__file__).resolve().parents[2])}
    children = []
    try:
        for _ in range(2):
            children.append(await asyncio.create_subprocess_exec(sys.executable, str(helper), env=environment,
                stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE))
        async with asyncio.timeout(30):
            for child in children:
                assert (await child.stdout.readline()).strip() == b'READY'
        with pytest.raises(TimeoutError):
            await capacity.acquire(timeout=0.15)
        for child in children:
            child.stdin.write(b'release\n')
            await child.stdin.drain()
        async with asyncio.timeout(30):
            for child in children:
                assert (await child.stdout.readline()).strip() == b'CLEAN'
                assert await child.wait() == 0
        async with capacity.engine.connect() as connection:
            assert (await connection.execute(text("SELECT count(*) FROM conversation.root_model_slots WHERE status <> 'free'"))).scalar_one() == 0
    finally:
        for child in children:
            if child.returncode is None:
                child.kill()
                await child.wait()


@pytest.fixture
async def capacity(guarded_native):
    service, _session, _grant, engine = guarded_native
    migration = Path(__file__).parents[3] / 'YellowStorm/back/drizzle/0045_root_model_capacity.sql'
    from dotenv import dotenv_values
    config = dotenv_values(migration.parents[1] / '.env')
    async with engine.begin() as connection:
        database = (await connection.execute(text('SELECT current_database()'))).scalar_one()
        assert database == config['POSTGRES_TEST_DB'] and database != config['POSTGRES_DB']
        for statement in migration.read_text().split(';'):
            if statement.strip():
                await connection.execute(text(statement))
        await connection.execute(text("UPDATE conversation.root_model_slots SET status='free',owner=NULL"))
    yield ModelCapacity(engine)
    async with engine.begin() as connection:
        await connection.execute(text("UPDATE conversation.root_model_slots SET status='free',owner=NULL"))


@pytest.mark.asyncio
async def test_two_replicas_share_exactly_30_slots_and_stale_release_cannot_free_successor(capacity):
    replicas = [capacity, ModelCapacity(capacity.engine)]
    permits = await asyncio.gather(*(replicas[i % 2].acquire() for i in range(30)))
    assert len({permit.slot for permit in permits}) == 30
    with pytest.raises(TimeoutError):
        await replicas[1].acquire(timeout=0.15)
    await capacity.transition(permits[0], 'free')
    successor = await replicas[1].acquire()
    assert successor.slot == permits[0].slot and successor.fence > permits[0].fence
    with pytest.raises(PermissionError):
        await capacity.transition(permits[0], 'free')
    await capacity.transition(successor, 'free')
    for permit in permits[1:]:
        await capacity.transition(permit, 'free')


@pytest.mark.asyncio
async def test_repeated_mixed_bursts_do_not_leak_slots_or_provider_tasks(capacity):
    active, peak = 0, 0
    async def provider(**_kwargs):
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        try:
            await asyncio.sleep(0.02)
            return {'confirmed': True}
        finally:
            active -= 1
    clients = [CapacityClient(SimpleNamespace(acompletion=provider), ModelCapacity(capacity.engine)) for _ in range(2)]
    for _ in range(10):
        results = await asyncio.gather(*(clients[index % 2].acompletion(stream=False) for index in range(50)))
        assert all(result == {'confirmed': True} for result in results)
        assert active == 0 and peak <= 30
        async with capacity.engine.connect() as connection:
            assert (await connection.execute(text("SELECT count(*) FROM conversation.root_model_slots WHERE status <> 'free'"))).scalar_one() == 0


@pytest.mark.asyncio
async def test_stream_keeps_usage_tail_occupied_and_releases_before_parent_dispatches_child(capacity):
    held = await asyncio.gather(*(capacity.acquire() for _ in range(29)))
    async def chunks():
        yield {'tool_call': 'child'}
        yield {'usage': 5}
    provider = SimpleNamespace(acompletion=AsyncMock(return_value=chunks()))
    client = CapacityClient(provider, capacity)
    stream = await client.acompletion(stream=True)
    assert await anext(stream) == {'tool_call': 'child'}
    with pytest.raises(TimeoutError):
        await capacity.acquire(timeout=0.1)
    assert await anext(stream) == {'usage': 5}
    with pytest.raises(StopAsyncIteration):
        await anext(stream)
    # This is when ADK can yield its aggregate tool-call response and invoke
    # the child; no parent model permit survives provider EOF.
    child = await capacity.acquire(timeout=0.5)
    await capacity.transition(child, 'free')
    for permit in held:
        await capacity.transition(permit, 'free')


@pytest.mark.asyncio
async def test_transport_loss_or_early_close_retains_unknown_occupancy_without_automatic_retry(capacity):
    client = CapacityClient(SimpleNamespace(acompletion=AsyncMock(side_effect=TimeoutError('transport'))), capacity)
    with pytest.raises(TimeoutError):
        await client.acompletion(stream=False, num_retries=9)
    assert client.client.acompletion.call_args.kwargs['num_retries'] == 0
    async def chunks():
        yield 'partial'
    stream = await CapacityClient(SimpleNamespace(acompletion=AsyncMock(return_value=chunks())), capacity).acompletion(stream=True)
    await anext(stream)
    await stream.aclose()
    async with capacity.engine.connect() as connection:
        unknown = (await connection.execute(text("SELECT count(*) FROM conversation.root_model_slots WHERE status='outcome_unknown'"))).scalar_one()
    assert unknown == 2


@pytest.mark.asyncio
async def test_provider_rejection_releases_capacity_and_database_outage_never_enters_provider(capacity):
    class Rejected(Exception):
        status_code = 429
    rejected = SimpleNamespace(acompletion=AsyncMock(side_effect=Rejected()))
    with pytest.raises(Rejected):
        await CapacityClient(rejected, capacity).acompletion(stream=False)
    broken = ModelCapacity(SimpleNamespace(begin=lambda: (_ for _ in ()).throw(ConnectionError('database'))))
    provider = SimpleNamespace(acompletion=AsyncMock())
    with pytest.raises(ConnectionError):
        await CapacityClient(provider, broken).acompletion(stream=False)
    provider.acompletion.assert_not_awaited()
    async with capacity.engine.connect() as connection:
        free = (await connection.execute(text("SELECT count(*) FROM conversation.root_model_slots WHERE status='free'"))).scalar_one()
    assert free == 30


@pytest.mark.asyncio
async def test_real_instrumented_adk_model_uses_provider_gate_and_releases_before_response_yield(capacity, monkeypatch):
    from google.adk.models.lite_llm import LiteLLMClient
    from google.adk.models.llm_request import LlmRequest
    from google.genai import types
    from litellm import ModelResponse
    from src.smart_rag.infrastructure.monitoring.instrumented_lite_llm import InstrumentedLiteLlm
    monkeypatch.setattr('src.config.settings.get_settings', lambda: SimpleNamespace(ROOT_WORK_LLM_CAPACITY_ENABLED=True))
    class Provider(LiteLLMClient):
        async def acompletion(self, **kwargs):
            assert kwargs['num_retries'] == 0
            return ModelResponse(choices=[{'message': {'role': 'assistant', 'content': 'Actual SDK response'}, 'finish_reason': 'stop'}])
    model = InstrumentedLiteLlm(model='openai/gpt-4o', llm_client=Provider())
    assert isinstance(model.llm_client, CapacityClient)
    model.llm_client.pool = capacity
    request = LlmRequest(contents=[types.Content(role='user', parts=[types.Part(text='Fixture')])])
    response = model.generate_content_async(request, stream=False)
    result = await anext(response)
    assert result.content.parts[0].text == 'Actual SDK response'
    async with capacity.engine.connect() as connection:
        assert (await connection.execute(text("SELECT count(*) FROM conversation.root_model_slots WHERE status='free'"))).scalar_one() == 30
    await response.aclose()


@pytest.mark.asyncio
async def test_real_sdk_tool_call_yield_has_released_parent_slot_under_saturation(capacity, monkeypatch):
    from google.adk.models.lite_llm import LiteLLMClient
    from google.adk.models.llm_request import LlmRequest
    from google.genai import types
    from litellm import ModelResponseStream
    from src.smart_rag.infrastructure.monitoring.instrumented_lite_llm import InstrumentedLiteLlm
    monkeypatch.setattr('src.config.settings.get_settings', lambda: SimpleNamespace(ROOT_WORK_LLM_CAPACITY_ENABLED=True))
    held = await asyncio.gather(*(capacity.acquire() for _ in range(29)))
    async def chunks():
        yield ModelResponseStream(choices=[{'delta': {'role': 'assistant', 'tool_calls': [{
            'index': 0, 'id': 'call', 'type': 'function', 'function': {'name': 'child', 'arguments': '{}'}}]}, 'finish_reason': None}])
        yield ModelResponseStream(choices=[{'delta': {}, 'finish_reason': 'tool_calls'}],
            usage={'prompt_tokens': 1, 'completion_tokens': 2, 'total_tokens': 3})
    class Provider(LiteLLMClient):
        async def acompletion(self, **kwargs):
            return chunks()
    model = InstrumentedLiteLlm(model='openai/gpt-4o', llm_client=Provider())
    model.llm_client.pool = capacity
    request = LlmRequest(contents=[types.Content(role='user', parts=[types.Part(text='Delegate')])])
    observed = False
    async for response in model.generate_content_async(request, stream=True):
        if not response.partial and response.content and any(part.function_call for part in response.content.parts):
            child = await capacity.acquire(timeout=3)
            await capacity.transition(child, 'free')
            observed = True
    assert observed
    for permit in held:
        await capacity.transition(permit, 'free')


@pytest.mark.asyncio
async def test_cancelled_dispatched_provider_keeps_unknown_slot_and_waiter_cancellation_takes_none(capacity):
    entered = asyncio.Event()
    async def provider(**kwargs):
        entered.set()
        await asyncio.Event().wait()
    call = asyncio.create_task(CapacityClient(SimpleNamespace(acompletion=provider), capacity).acompletion(stream=False))
    await entered.wait()
    call.cancel()
    with pytest.raises(asyncio.CancelledError):
        await call
    async with capacity.engine.connect() as connection:
        unknown = (await connection.execute(text("SELECT count(*) FROM conversation.root_model_slots WHERE status='outcome_unknown'"))).scalar_one()
    assert unknown == 1
    held = await asyncio.gather(*(capacity.acquire() for _ in range(29)))
    waiting = asyncio.create_task(capacity.acquire())
    await asyncio.sleep(0)
    waiting.cancel()
    with pytest.raises(asyncio.CancelledError):
        await waiting
    for permit in held:
        await capacity.transition(permit, 'free')
