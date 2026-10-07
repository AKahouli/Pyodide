"""Explicit real-provider qualification; synthetic data, isolated SQL slots only.

Run from yellowstorm-adk with conda meta. Not collected by pytest.
"""
import argparse
import asyncio
import json
import logging
import statistics
import sys
import time
from pathlib import Path
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from dotenv import dotenv_values
from google.adk.agents import LlmAgent
from google.adk.agents.run_config import RunConfig, StreamingMode
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types
from sqlalchemy import text
from sqlalchemy.engine import URL
from sqlalchemy.ext.asyncio import create_async_engine

from src.root_runtime.model_capacity import CapacityClient, ModelCapacity
from src.smart_rag.infrastructure.factories.llm_factory import LLMFactory


async def qualify(args):
    config = dotenv_values(Path(__file__).resolve().parents[3] / 'YellowStorm/back/.env')
    database = config.get('POSTGRES_TEST_DB')
    if not database or database == config.get('POSTGRES_DB'):
        raise RuntimeError('Explicit isolated database required')
    engine = create_async_engine(URL.create('postgresql+asyncpg', username=config.get('POSTGRES_USER'),
        password=config.get('POSTGRES_PASSWORD'), host=config.get('POSTGRES_HOST'),
        port=int(config.get('POSTGRES_PORT', '5432')), database=database), pool_size=5, max_overflow=5)
    report = {'model': args.model, 'database': database, 'stages': [],
        'scope': 'Synthetic real ADK Runner/provider load; not live backend/connector qualification'}
    try:
        async with engine.connect() as connection:
            if (await connection.execute(text('SELECT current_database()'))).scalar_one() != database:
                raise RuntimeError('Database identity mismatch')
            slots = (await connection.execute(text("SELECT count(*),count(*) FILTER(WHERE status <> 'free') FROM conversation.root_model_slots"))).one()
            if tuple(slots) != (30, 0):
                raise RuntimeError('Thirty initially free isolated slots required; no automatic reset')
        replicas = [ModelCapacity(engine), ModelCapacity(engine)]
        for enabled in (False, True):
            for count in args.stages:
                if count > 30 and not enabled:
                    continue
                samples, peak, stop = [], 0, asyncio.Event()

                async def monitor():
                    nonlocal peak
                    while not stop.is_set():
                        async with engine.connect() as connection:
                            occupied = (await connection.execute(text("SELECT count(*) FROM conversation.root_model_slots WHERE status <> 'free'"))).scalar_one()
                        peak = max(peak, occupied)
                        await asyncio.sleep(0.05)

                async def run(index):
                    started, first, marker = time.perf_counter(), None, f'QUALIFY{uuid4().hex[:12]}'
                    model = LLMFactory.create_no_tool_calls_llm(args.model, temperature=None,
                        max_completion_tokens=128, num_retries=0)
                    client = model.llm_client
                    if isinstance(client, CapacityClient):
                        client = client.client
                    object.__setattr__(model, 'llm_client', CapacityClient(client, replicas[index % 2]) if enabled else client)
                    agent = LlmAgent(name='qualification', model=model,
                        instruction='Return the user marker exactly, without punctuation or explanation.')
                    sessions = InMemorySessionService()
                    session = await sessions.create_session(app_name='qualification', user_id=marker)
                    runner = Runner(agent=agent, app_name='qualification', session_service=sessions)
                    output, error = '', None
                    try:
                        async with asyncio.timeout(120):
                            async for event in runner.run_async(user_id=marker, session_id=session.id,
                                new_message=types.Content(role='user', parts=[types.Part(text=marker)]),
                                run_config=RunConfig(streaming_mode=StreamingMode.SSE)):
                                if event.content:
                                    value = ''.join(part.text or '' for part in event.content.parts or [])
                                    if value and first is None:
                                        first = time.perf_counter() - started
                                    if not event.partial:
                                        output = value or output
                    except Exception as exception:
                        error = type(exception).__name__
                    samples.append({'ok': marker in output and error is None,
                        'marker_present': marker in output, 'response_characters': len(output),
                        'seconds': round(time.perf_counter() - started, 3),
                        'first_text_seconds': round(first, 3) if first is not None else None, 'error': error})

                watcher = asyncio.create_task(monitor())
                started = time.perf_counter()
                tasks = [asyncio.create_task(run(index)) for index in range(count)]
                try:
                    await asyncio.gather(*tasks)
                finally:
                    for task in tasks:
                        if not task.done():
                            task.cancel()
                    await asyncio.gather(*tasks, return_exceptions=True)
                    stop.set()
                    await watcher
                async with engine.connect() as connection:
                    residual = (await connection.execute(text("SELECT count(*) FROM conversation.root_model_slots WHERE status <> 'free'"))).scalar_one()
                stage = {'capacity_enabled': enabled, 'users': count, 'success': sum(s['ok'] for s in samples),
                    'elapsed_seconds': round(time.perf_counter() - started, 3), 'peak_slots': peak,
                    'residual_slots': residual, 'median_seconds': statistics.median(s['seconds'] for s in samples),
                    'samples': samples}
                report['stages'].append(stage)
                args.output.parent.mkdir(parents=True, exist_ok=True)
                args.output.write_text(json.dumps(report, indent=2), encoding='utf-8')
                print(json.dumps({key: value for key, value in stage.items() if key != 'samples'}), flush=True)
                if residual or stage['success'] != count or peak > 30:
                    raise RuntimeError('Qualification failed; inspect safe report, uncertain slots retained')
    finally:
        await engine.dispose()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', required=True)
    parser.add_argument('--stages', nargs='+', type=int, default=[1, 10, 20, 30, 50])
    parser.add_argument('--output', type=Path, required=True)
    arguments = parser.parse_args()
    if any(count < 1 or count > 50 for count in arguments.stages):
        parser.error('Each stage requires between 1 and 50 users')
    logging.disable(logging.CRITICAL)
    asyncio.run(qualify(arguments))
