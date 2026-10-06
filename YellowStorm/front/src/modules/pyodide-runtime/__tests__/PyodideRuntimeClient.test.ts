import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkerRequest, WorkerResponse } from '../protocol';

type Handler = (...args: unknown[]) => void;

class FakeSocket {
  private readonly handlers = new Map<string, Handler[]>();
  readonly emit = vi.fn();
  readonly disconnect = vi.fn();
  readonly removeAllListeners = vi.fn();

  on(event: string, handler: Handler): this {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
    return this;
  }

  trigger(event: string, payload?: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) handler(payload);
  }
}

class FakeWorker {
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
  readonly postMessage = vi.fn<(message: WorkerRequest) => void>();
  readonly terminate = vi.fn();
}

const fakeSocket = new FakeSocket();
let fakeWorker: FakeWorker;

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => fakeSocket),
}));

import { PyodideRuntimeClient } from '../PyodideRuntimeClient';

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function makeClient(onReplaced?: () => void): PyodideRuntimeClient {
  fakeWorker = new FakeWorker();
  return new PyodideRuntimeClient({
    getToken: () => 'jwt-token',
    indexUrl: 'https://cdn.example/full/',
    onReplaced,
    createWorker: () => fakeWorker as unknown as Worker,
  });
}

describe('PyodideRuntimeClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers the runtime on connect and heartbeats', async () => {
    vi.useFakeTimers();
    try {
      const client = makeClient();
      client.connect();
      fakeSocket.trigger('connect');

      expect(fakeSocket.emit).toHaveBeenCalledWith('runtime.register', expect.objectContaining({ status: 'booting' }));
      vi.advanceTimersByTime(10_000);
      expect(fakeSocket.emit).toHaveBeenCalledWith('runtime.heartbeat', expect.any(Object));
      client.disconnect();
    } finally {
      vi.useRealTimers();
    }
  });

  it('executes a request in the worker and reports the result', async () => {
    const client = makeClient();
    client.connect();
    fakeSocket.trigger('connect');

    fakeSocket.trigger('execution.request', { executionId: 'exec-1', code: '1 + 1', input: null, timeoutMs: 5000 });
    expect(fakeWorker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'execute', executionId: 'exec-1' }));

    fakeWorker.onmessage?.({
      data: {
        type: 'result',
        executionId: 'exec-1',
        result: { ok: true, result: 2, stdout: '', stderr: '', execution: { runtime: 'pyodide', durationMs: 1, coldStart: false, loadedPackages: [] } },
      },
    } as unknown as MessageEvent<WorkerResponse>);
    await flush();

    expect(fakeSocket.emit).toHaveBeenCalledWith('execution.completed', expect.objectContaining({ executionId: 'exec-1' }));
  });

  it('does not report a result after a backend cancel', async () => {
    const client = makeClient();
    client.connect();
    fakeSocket.trigger('connect');

    fakeSocket.trigger('execution.request', { executionId: 'exec-1', code: '1', input: null, timeoutMs: 5000 });
    fakeSocket.trigger('execution.cancel', { executionId: 'exec-1' });
    await flush();

    expect(fakeSocket.emit).not.toHaveBeenCalledWith('execution.completed', expect.anything());
  });

  it('disconnects and notifies when the runtime is replaced', () => {
    const onReplaced = vi.fn();
    const client = makeClient(onReplaced);
    client.connect();
    fakeSocket.trigger('connect');

    fakeSocket.trigger('runtime.replaced', { userId: 'user-1' });

    expect(onReplaced).toHaveBeenCalled();
    expect(fakeSocket.disconnect).toHaveBeenCalled();
  });
});
