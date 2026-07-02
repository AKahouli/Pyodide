import { ConfigService } from '@nestjs/config';
import { WorkyRuntimeClient } from './worky-runtime.client';

const ORIGINAL_FETCH = global.fetch;

function makeClient(timeoutMs = 120000): WorkyRuntimeClient {
  const config = {
    get: (key: string) => {
      if (key === 'worky.runtimeBaseUrl') return 'http://runtime:8011';
      if (key === 'worky.runtimeTimeoutMs') return timeoutMs;
      return undefined;
    },
  } as unknown as ConfigService;
  return new WorkyRuntimeClient(config);
}

function sseResponse(frames: Array<{ event?: string; data: unknown }>, status = 200): Response {
  const body = frames
    .map((f) => {
      const evt = f.event ? `event: ${f.event}\n` : '';
      const data = `data: ${JSON.stringify(f.data)}\n`;
      return `${evt}${data}\n`;
    })
    .join('');
  return new Response(body, { status, headers: { 'content-type': 'text/event-stream' } });
}

function restoreFetch(): void {
  global.fetch = ORIGINAL_FETCH;
}

afterEach(() => {
  restoreFetch();
});

describe('WorkyRuntimeClient (execution surface)', () => {
  it('start() hits /start and parses SSE frames', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      sseResponse([
        { event: 'execution.bootstrap', data: { type: 'execution.bootstrap', emitted_at: 1, payload: { stream_id: 's1' } } },
        { event: 'worker.spawned', data: { type: 'worker.spawned', emitted_at: 2, payload: { task_id: 't1' } } },
        { event: 'execution.done', data: { type: 'execution.done', emitted_at: 3, payload: { stream_id: 's1' } } },
      ]),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = makeClient();
    const result = await client.start('s1', { ready_task_ids: ['t1', 't2'], worker_model_id: 'm1' });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://runtime:8011/runtime/streams/s1/start',
      expect.objectContaining({ method: 'POST' }),
    );
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      ready_task_ids: ['t1', 't2'],
      worker_model_id: 'm1',
    });
    expect(result.ok).toBe(true);
    expect(result.frames.map((f) => f.type)).toEqual(['execution.bootstrap', 'worker.spawned', 'execution.done']);
    expect(result.frames[1]?.payload).toEqual({ task_id: 't1' });
  });

  it('resume() hits /resume with trigger', async () => {
    const fetchMock = jest.fn().mockResolvedValue(sseResponse([]));
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = makeClient();
    await client.resume('s2', { trigger: 'owner_resume' });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://runtime:8011/runtime/streams/s2/resume',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string)).toEqual({
      trigger: 'owner_resume',
    });
  });

  it('stop() hits /stop', async () => {
    const fetchMock = jest.fn().mockResolvedValue(sseResponse([]));
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = makeClient();
    await client.stop('s3');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://runtime:8011/runtime/streams/s3/stop',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('cancelTask() hits the runtime mounted cancel route', async () => {
    const fetchMock = jest.fn().mockResolvedValue(sseResponse([]));
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = makeClient();
    await client.cancelTask('t9');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://runtime:8011/runtime/streams/tasks/t9/cancel',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('returns ok=false on a 5xx without throwing', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(new Response('boom', { status: 503 })) as unknown as typeof fetch;
    const client = makeClient();
    const result = await client.start('s4', { ready_task_ids: [] });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(503);
    expect(result.error).toContain('503');
    expect(result.frames).toEqual([]);
  });

  it('returns ok=false on a network error without throwing', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;
    const client = makeClient();
    const result = await client.resume('s5', {});
    expect(result.ok).toBe(false);
    expect(result.error).toContain('ECONNREFUSED');
    expect(result.frames).toEqual([]);
  });

  it('returns ok=false on timeout without throwing', async () => {
    global.fetch = jest
      .fn()
      .mockImplementation((_url, init) => {
        return new Promise((_resolve, reject) => {
          (init as RequestInit).signal?.addEventListener('abort', () => {
            const err = new Error('aborted');
            (err as Error & { name: string }).name = 'AbortError';
            reject(err);
          });
        });
      }) as unknown as typeof fetch;
    const client = makeClient(50);
    const result = await client.start('s6', { ready_task_ids: [] });
    expect(result.ok).toBe(false);
    expect(result.frames).toEqual([]);
  });

  it('tolerates a malformed frame (returns ok=true with a raw frame)', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        new Response('event: weird\ndata: not-json\n\n', { status: 200 }),
      ) as unknown as typeof fetch;
    const client = makeClient();
    const result = await client.start('s7', { ready_task_ids: [] });
    expect(result.ok).toBe(true);
    expect(result.frames).toHaveLength(1);
    expect(result.frames[0]?.type).toBe('weird');
    expect(result.frames[0]?.payload).toEqual({ raw: 'not-json' });
  });

  it('ping() still works (regression for boot-time health probe)', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(new Response('{"ok":true}', { status: 200 })) as unknown as typeof fetch;
    const client = makeClient();
    const result = await client.ping();
    expect(result.ok).toBe(true);
  });
});
