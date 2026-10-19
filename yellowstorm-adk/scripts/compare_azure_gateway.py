"""Read-only Responses comparison; request JSON and credentials never enter reports.

Use --request with a private, application-managed Responses request snapshot.
Azure key is read from AZURE_OPENAI_API_KEY or stdin (never a CLI argument).
Both routes receive the same body; no application settings or sessions are written.
"""
import argparse
import asyncio
import copy
import hashlib
import getpass
import json
import logging
import os
from pathlib import Path
import statistics
import sys
import time

import httpx
from openai import AsyncAzureOpenAI, AsyncOpenAI, DefaultAsyncHttpxClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from dotenv import load_dotenv
from src.config.settings import get_settings


async def main(args):
    load_dotenv(Path(__file__).resolve().parents[1] / '.env')
    logging.disable(logging.CRITICAL)  # SDK debug output can contain request bodies.
    settings = get_settings()
    body = json.loads(Path(args.request).read_text(encoding='utf-8-sig'))
    if body.get('previous_response_id') or body.get('conversation') or body.get('store'):
        raise ValueError('Comparison requires stateless, application-managed history')
    assert body['model'] == 'gpt-6-luna' and body.get('tools') and body.get('input')
    body['stream'] = True
    digest = hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()
    key = os.environ.get('AZURE_OPENAI_API_KEY')
    if not key:
        print('Awaiting Azure key on stdin; input is not logged.', flush=True)
        key = getpass.getpass('Azure key: ') if sys.stdin.isatty() else sys.stdin.readline().strip()
    if not key:
        raise ValueError('Azure credential missing')
    rows = []
    current = {}

    async def request_hook(request):
        current['dispatch'] = time.perf_counter()
        async def trace(name, info):
            if name in ('connection.connect_tcp.started', 'connection.connect_tcp.complete',
                        'connection.start_tls.started', 'connection.start_tls.complete'):
                current[name] = time.perf_counter()
        request.extensions['trace'] = trace

    async def response_hook(response):
        current['headers'] = time.perf_counter()
        current['http2'] = response.http_version == 'HTTP/2'
        for name in ('x-litellm-overhead-duration-ms', 'x-litellm-response-duration-ms'):
            try:
                current[name] = float(response.headers[name])
            except (KeyError, ValueError):
                pass

    def make(route):
        transport = DefaultAsyncHttpxClient(http2=True, limits=httpx.Limits(
            max_connections=10, max_keepalive_connections=5, keepalive_expiry=30),
            event_hooks={'request': [request_hook], 'response': [response_hook]})
        common = dict(http_client=transport, max_retries=0, timeout=90)
        if route == 'azure':
            return AsyncAzureOpenAI(azure_endpoint=args.azure_endpoint,
                api_version=args.api_version, api_key=key, **common)
        return AsyncOpenAI(base_url=settings.LITELLM_API_BASE_URL,
            api_key=settings.LITELLM_API_SECRET_KEY, **common)

    clients = {route: make(route) for route in ('azure', 'gateway')}
    try:
        for index in range(args.pairs):
            # Alternate the leading route to reduce ordering/cache bias.
            for route in (('azure', 'gateway') if index % 2 == 0 else ('gateway', 'azure')):
                current.clear()
                start = time.perf_counter()
                milestones = {}
                row = {'route': route, 'pair': index, 'phase': 'cold' if index == 0 else 'warm',
                       'request_sha256': digest}
                try:
                    stream = await clients[route].responses.create(**copy.deepcopy(body))
                    completed = None
                    async with stream:
                        async for event in stream:
                            now = time.perf_counter()
                            milestones.setdefault('first_event', now)
                            kind = event.type
                            if kind == 'response.reasoning_summary_text.delta' and event.delta:
                                milestones.setdefault('first_summary', now)
                            if kind == 'response.output_text.delta' and event.delta:
                                milestones.setdefault('first_text', now)
                            if kind == 'response.output_item.added' and event.item.type == 'function_call':
                                row['tool_calls'] = row.get('tool_calls', 0) + 1
                            if kind == 'response.completed':
                                completed = event.response
                            if kind in ('response.failed', 'response.incomplete', 'error'):
                                raise RuntimeError(kind)
                    assert completed is not None and 'first_text' in milestones
                    usage = completed.usage
                    row.update(status='PASS', response_model=completed.model,
                        input_tokens=usage.input_tokens, output_tokens=usage.output_tokens,
                        cached_tokens=getattr(usage.input_tokens_details, 'cached_tokens', None),
                        reasoning_tokens=getattr(usage.output_tokens_details, 'reasoning_tokens', None))
                except Exception as error:
                    # Never print provider bodies/URLs or exception messages.
                    row.update(status='FAIL', error_type=type(error).__name__,
                               http_status=getattr(error, 'status_code', None),
                               error_code=getattr(error, 'code', None))
                row['total_ms'] = round((time.perf_counter() - start) * 1000, 1)
                for name, moment in milestones.items():
                    row[name + '_ms'] = round((moment - start) * 1000, 1)
                for name in ('headers',):
                    if name in current:
                        row[name + '_ms'] = round((current[name] - start) * 1000, 1)
                for name, a, b in (
                    ('tcp_ms', 'connection.connect_tcp.started', 'connection.connect_tcp.complete'),
                    ('tls_ms', 'connection.start_tls.started', 'connection.start_tls.complete')):
                    row[name] = round((current[b] - current[a]) * 1000, 1) if b in current else None
                row['connection_reused'] = index > 0 and row['tcp_ms'] is None and row['tls_ms'] is None
                row['phase'] = 'warm' if row['connection_reused'] else ('cold' if index == 0 else 'reconnected')
                row.update({k: current[k] for k in ('http2', 'x-litellm-overhead-duration-ms',
                            'x-litellm-response-duration-ms') if k in current})
                rows.append(row)
                print(json.dumps(row), flush=True)
                # A rejected request is not a timing sample; stop after the pair.
            if any(r['status'] == 'FAIL' for r in rows):
                break
    finally:
        for client in clients.values():
            await client.close()
    summary = {'request_sha256': digest, 'reasoning': body.get('reasoning'),
               'tool_count': len(body['tools']), 'history_items': len(body['input']), 'routes': {}}
    for route in clients:
        selected = [r for r in rows if r['route'] == route and r['phase'] == 'warm' and r['status'] == 'PASS']
        summary['routes'][route] = {'warm_samples': len(selected), **{
            name: round(statistics.median(r[name] for r in selected if name in r), 1)
            for name in ('headers_ms', 'first_event_ms', 'first_text_ms', 'total_ms')
            if any(name in r for r in selected)}}
    report = {'summary': summary, 'samples': rows}
    Path(args.output).write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(summary), flush=True)
    return 1 if any(r['status'] == 'FAIL' for r in rows) else 0


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--request', required=True)
    parser.add_argument('--azure-endpoint', required=True)
    parser.add_argument('--api-version', default='2025-04-01-preview')
    parser.add_argument('--pairs', type=int, default=6)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    if not 2 <= args.pairs <= 10:
        parser.error('--pairs must be between 2 and 10')
    sys.exit(asyncio.run(main(args)))
