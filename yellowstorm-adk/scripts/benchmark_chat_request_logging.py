"""Bounded logging-only benchmark; run from yellowstorm-adk with PYTHONPATH=.

conda run -n meta python scripts/benchmark_chat_request_logging.py --output result.json
Excludes imports, model inference, network, logger sinks and request conversion for execution.
"""
import argparse
import asyncio
import gc
import json
import math
import platform
import time
import tracemalloc
from pathlib import Path

from src.grpc_generated import chatbot_pb2 as pb
from src.grpc_server.chatbot_servicer import (
    ChatbotServicer, _grpc_in_log_message, _message_to_dict,
)


def request_for(single, count):
    agent = pb.Agent(id='synthetic-agent', name='Synthetic', agent_type='manager')
    kwargs = dict(
        query='Synthetic logging benchmark ' * 128,
        attached_files=[pb.AttachedFile(type='document', document=pb.DocumentData(
            document_id=f'document-{i}', filepath=f'workspace/document-{i}.pdf',
            filename=f'synthetic-{i}.pdf', source='x' * 1024,
        )) for i in range(count)],
        attachment_context=pb.AttachmentContext(text='Synthetic bounded text. ' * (512 * count)),
        correction_replay_context=pb.CorrectionReplayContext(
            original_answer='Synthetic prior answer ' * 256, attempt_number=1,
            findings=[pb.CorrectionReplayFinding(claim='Synthetic finding', status='unsupported')],
        ),
    )
    return (pb.RunSingleAgentRequest(agent=agent, **kwargs) if single
            else pb.RunAgentTeamRequest(agents=[agent], **kwargs))


def log_shape(request, direct):
    if direct:
        payload = ChatbotServicer._serialize_run_agent_team_request(request)
    else:
        payload = _message_to_dict(request)
        replay = payload.get('correction_replay_context')
        if isinstance(replay, dict):
            payload['correction_replay_context'] = dict(
                present=True, attempt_number=replay.get('attempt_number', 0),
                finding_count=len(replay.get('findings', [])),
            )
    return _grpc_in_log_message('benchmark', payload)


async def measure(request, direct, iterations):
    samples = []
    async def producer():
        for _ in range(iterations):
            start = time.perf_counter_ns()
            log_shape(request, direct)
            samples.append((time.perf_counter_ns() - start) / 1e6)
            await asyncio.sleep(0)
    gc.collect()
    cpu_start = time.process_time_ns()
    wall_start = time.perf_counter_ns()
    await asyncio.gather(*(producer() for _ in range(30)))
    cpu_ms = (time.process_time_ns() - cpu_start) / 1e6
    wall_ms = (time.perf_counter_ns() - wall_start) / 1e6
    gc.collect()
    tracemalloc.start()
    await asyncio.gather(*(producer() for _ in range(30)))
    _, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    timed = sorted(samples[:30 * iterations])
    percentile = lambda fraction: timed[max(0, math.ceil(len(timed) * fraction) - 1)]
    return dict(operations=len(timed), p50_ms=percentile(.5), p95_ms=percentile(.95),
                cpu_ms=cpu_ms, wall_ms=wall_ms, peak_python_allocated_bytes=peak)


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--iterations', type=int, default=20)
    args = parser.parse_args()
    if not 1 <= args.iterations <= 100:
        parser.error('--iterations must be between 1 and 100')
    results = []
    for single in (True, False):
        for count in (1, 10, 100):
            request = request_for(single, count)
            assert log_shape(request, False) == log_shape(request, True)
            for direct in (False, True):
                for _ in range(5):
                    log_shape(request, direct)
                results.append(dict(rpc='single' if single else 'team', attachments=count,
                    protobuf_bytes=request.ByteSize(), mode='direct' if direct else 'baseline',
                    **await measure(request, direct, args.iterations)))
    report = dict(python=platform.python_version(), platform=platform.platform(),
        task_producers=30, iterations_per_producer=args.iterations,
        cpu_note='process_time is quantized on Windows; 0 means below timer resolution, not zero CPU work',
        scope='logging only; asyncio tasks share one event loop; allocations are tracemalloc Python peak, not RSS; imports, model, network and logger sink excluded',
        results=results)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    asyncio.run(main())
