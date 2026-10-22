import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BrowserRuntimeClient } from '../BrowserRuntimeClient';
import { BrowserRuntimeEvents } from '../runtime.types';

// Store event listeners so we can simulate events
type Listener = (...args: unknown[]) => void;
const eventListeners = new Map<string, Listener[]>();

function addListener(event: string, fn: Listener) {
  if (!eventListeners.has(event)) eventListeners.set(event, []);
  eventListeners.get(event)!.push(fn);
}

function fire(event: string, ...args: unknown[]) {
  const listeners = eventListeners.get(event) ?? [];
  for (const fn of listeners) fn(...args);
}

const mockSocket = {
  connected: true,
  on: vi.fn((event: string, fn: Listener) => { addListener(event, fn); }),
  off: vi.fn(),
  emit: vi.fn(),
  disconnect: vi.fn(),
  removeAllListeners: vi.fn(() => { eventListeners.clear(); }),
};

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => {
    eventListeners.clear();
    mockSocket.connected = true;
    // Synchronously register then fire connect
    // connect callback is set by our code in the same tick
    queueMicrotask(() => fire('connect'));
    return mockSocket;
  }),
}));

vi.mock('@/lib/api/config', () => ({
  getSocketBaseUrl: () => 'http://localhost:3000',
}));

describe('BrowserRuntimeClient', () => {
  let client: BrowserRuntimeClient;

  beforeEach(() => {
    vi.clearAllMocks();
    eventListeners.clear();
    mockSocket.connected = true;
    client = new BrowserRuntimeClient();
  });

  afterEach(() => {
    client.disconnect();
  });

  it('connects with ticket auth', async () => {
    const { io } = await import('socket.io-client');
    await client.connect('test-ticket');

    expect(io).toHaveBeenCalledWith('http://localhost:3000/app-runtime', {
      auth: { ticket: 'test-ticket' },
      transports: ['websocket', 'polling'],
      reconnection: false,
    });
    expect(client.connected).toBe(true);
  });

  it('emits register and resolves ack', async () => {
    await client.connect('test-ticket');

    mockSocket.emit.mockImplementationOnce(
      (_event: string, _payload: unknown, cb: (ack: { ok: boolean }) => void) => {
        cb({ ok: true });
      },
    );

    const result = await client.register({
      runtimeSessionId: 'rts_abc',
      workspaceId: 'ws_123',
      revisionId: 'rev_0',
      capabilities: { filesystem: true, npm: true, previewInspection: true, nativeBinaries: false },
    });

    expect(result).toEqual({ ok: true });
    expect(mockSocket.emit).toHaveBeenCalledWith(
      BrowserRuntimeEvents.REGISTER,
      expect.objectContaining({ runtimeSessionId: 'rts_abc' }),
      expect.any(Function),
    );
  });

  it('starts and stops heartbeat', async () => {
    vi.useFakeTimers();
    await client.connect('ticket');

    client.startHeartbeat('ws_1', () => 'rev_0', 1000);

    vi.advanceTimersByTime(3000);
    const heartbeatCalls = mockSocket.emit.mock.calls.filter(
      (c: unknown[]) => c[0] === BrowserRuntimeEvents.HEARTBEAT,
    );
    expect(heartbeatCalls.length).toBe(3);

    client.stopHeartbeat();
    vi.advanceTimersByTime(2000);
    const afterStop = mockSocket.emit.mock.calls.filter(
      (c: unknown[]) => c[0] === BrowserRuntimeEvents.HEARTBEAT,
    );
    expect(afterStop.length).toBe(3);

    vi.useRealTimers();
  });

  it('emits tool.completed', async () => {
    await client.connect('ticket');
    client.emitToolCompleted({ toolCallId: 'tc_1', result: { content: 'hello' } });

    expect(mockSocket.emit).toHaveBeenCalledWith(
      BrowserRuntimeEvents.TOOL_COMPLETED,
      { toolCallId: 'tc_1', result: { content: 'hello' } },
    );
  });

  it('emits tool.failed', async () => {
    await client.connect('ticket');
    client.emitToolFailed({
      toolCallId: 'tc_2',
      error: { code: -32603, message: 'boom' },
    });

    expect(mockSocket.emit).toHaveBeenCalledWith(
      BrowserRuntimeEvents.TOOL_FAILED,
      { toolCallId: 'tc_2', error: { code: -32603, message: 'boom' } },
    );
  });

  it('invokes onToolInvoke handler when tool.invoke fires', async () => {
    const handler = vi.fn();
    client.onToolInvoke(handler);

    await client.connect('ticket');

    // Fire the tool.invoke event
    fire(BrowserRuntimeEvents.TOOL_INVOKE, {
      toolCallId: 'tc_x',
      tool: 'read',
      arguments: {},
      workspaceId: 'ws',
      baseRevisionId: 'rev_0',
      timeoutMs: 5000,
    });

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ toolCallId: 'tc_x', tool: 'read' }),
    );
  });

  it('disconnect cleans up', async () => {
    await client.connect('ticket');
    client.disconnect();

    expect(mockSocket.removeAllListeners).toHaveBeenCalled();
    expect(mockSocket.disconnect).toHaveBeenCalled();
    expect(client.connected).toBe(false);
  });
});
