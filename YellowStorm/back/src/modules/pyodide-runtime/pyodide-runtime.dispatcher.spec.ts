import { ConfigService } from '@nestjs/config';
import type { Socket } from 'socket.io';
import { PyodideRuntimeDispatcher } from './pyodide-runtime.dispatcher';
import { PyodideRuntimeRegistry } from './pyodide-runtime.registry';
import {
  PyodideErrorCode,
  PyodideExecutionResult,
  PyodideRuntimeEvents,
} from './pyodide-runtime.types';

interface FakeSocket extends Socket {
  emit: jest.Mock;
  disconnect: jest.Mock;
}

function fakeSocket(id = 'socket-1', connected = true): FakeSocket {
  return { id, connected, emit: jest.fn(), disconnect: jest.fn() } as unknown as FakeSocket;
}

function fakeConfig(): ConfigService {
  return { get: jest.fn((_key: string, fallback: unknown) => fallback) } as unknown as ConfigService;
}

function setup() {
  const registry = new PyodideRuntimeRegistry(fakeConfig());
  const dispatcher = new PyodideRuntimeDispatcher(registry, fakeConfig());
  return { registry, dispatcher };
}

function emittedRequest(socket: FakeSocket): string {
  const calls = socket.emit.mock.calls as [string, { executionId?: string }][];
  const requests = calls.filter(([event]) => event === PyodideRuntimeEvents.EXECUTION_REQUEST);
  expect(requests.length).toBeGreaterThan(0);
  return String(requests[requests.length - 1]![1].executionId);
}

function successResult(): PyodideExecutionResult {
  return {
    ok: true,
    result: 2,
    stdout: '2\n',
    stderr: '',
    execution: { runtime: 'pyodide', durationMs: 5, coldStart: false, loadedPackages: [] },
  };
}

describe('PyodideRuntimeDispatcher', () => {
  const request = { code: '1 + 1', input: null, timeoutMs: 30_000 };

  it('returns offline when no runtime is connected', async () => {
    const { dispatcher } = setup();
    const result = await dispatcher.execute('user-1', request);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe(PyodideErrorCode.RUNTIME_OFFLINE);
  });

  it('relays the request and resolves with the browser result', async () => {
    const { registry, dispatcher } = setup();
    const socket = fakeSocket();
    registry.register({ userId: 'user-1', socket, runtimeId: 'rt-1' });

    const pending = dispatcher.execute('user-1', request);
    const executionId = emittedRequest(socket);
    dispatcher.handleCompleted('user-1', { executionId, result: successResult() });

    const result = await pending;
    expect(result.ok).toBe(true);
    expect(result.result).toBe(2);
    expect(result.stdout).toBe('2\n');
    expect(registry.get('user-1')?.status).toBe('ready');
  });

  it('times out by cancelling the browser and resolving deterministically', async () => {
    jest.useFakeTimers();
    try {
      const { registry, dispatcher } = setup();
      const socket = fakeSocket();
      registry.register({ userId: 'user-1', socket, runtimeId: 'rt-1' });

      const pending = dispatcher.execute('user-1', request);
      const executionId = emittedRequest(socket);
      jest.advanceTimersByTime(30_000);
      const result = await pending;

      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe(PyodideErrorCode.EXECUTION_TIMEOUT);
      expect(socket.emit).toHaveBeenCalledWith(
        PyodideRuntimeEvents.EXECUTION_CANCEL,
        { executionId },
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('reports busy when one execution is active and the queue is full', async () => {
    const { registry, dispatcher } = setup();
    registry.register({ userId: 'user-1', socket: fakeSocket(), runtimeId: 'rt-1' });

    void dispatcher.execute('user-1', request);
    void dispatcher.execute('user-1', request);
    void dispatcher.execute('user-1', request);
    void dispatcher.execute('user-1', request);
    const overflow = await dispatcher.execute('user-1', request);

    expect(overflow.ok).toBe(false);
    expect(overflow.error?.code).toBe(PyodideErrorCode.RUNTIME_BUSY);

    dispatcher.failForUser('user-1', PyodideErrorCode.CONNECTION_LOST, 'cleanup');
  });

  it('drains queued executions in order after completion', async () => {
    const { registry, dispatcher } = setup();
    const socket = fakeSocket();
    registry.register({ userId: 'user-1', socket, runtimeId: 'rt-1' });

    const first = dispatcher.execute('user-1', request);
    const firstId = emittedRequest(socket);
    const second = dispatcher.execute('user-1', request);
    expect(dispatcher.queueLength('user-1')).toBe(1);

    dispatcher.handleCompleted('user-1', { executionId: firstId, result: successResult() });
    await first;

    const secondId = emittedRequest(socket);
    expect(secondId).not.toBe(firstId);
    dispatcher.handleCompleted('user-1', { executionId: secondId, result: successResult() });
    expect((await second).ok).toBe(true);
    expect(dispatcher.queueLength('user-1')).toBe(0);
  });

  it('fails active and queued executions when the runtime disconnects', async () => {
    const { registry, dispatcher } = setup();
    registry.register({ userId: 'user-1', socket: fakeSocket(), runtimeId: 'rt-1' });

    const active = dispatcher.execute('user-1', request);
    const queued = dispatcher.execute('user-1', request);
    dispatcher.failForUser('user-1', PyodideErrorCode.CONNECTION_LOST, 'disconnected');

    expect((await active).error?.code).toBe(PyodideErrorCode.CONNECTION_LOST);
    expect((await queued).error?.code).toBe(PyodideErrorCode.CONNECTION_LOST);
  });

  it('caches terminal results for the idempotence window', async () => {
    const { registry, dispatcher } = setup();
    const socket = fakeSocket();
    registry.register({ userId: 'user-1', socket, runtimeId: 'rt-1' });

    const pending = dispatcher.execute('user-1', request);
    const executionId = emittedRequest(socket);
    dispatcher.handleCompleted('user-1', { executionId, result: successResult() });
    await pending;

    expect(dispatcher.getCached(executionId)?.ok).toBe(true);
  });
});

