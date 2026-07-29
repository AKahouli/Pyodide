import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { conversationStreamService } from './stream';
import { setAccessToken, clearAccessToken } from '@/lib/api/token';

vi.mock('@/lib/api/config', () => ({
  AUTH_STORAGE_KEYS: {
    accessToken: 'accessToken',
  },
  API_CONFIG: {
    baseURL: 'https://api.example.test',
  },
}));

vi.mock('./translation', () => ({
  translateConversation: (key: string) => key,
}));

class MockEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  static instances: MockEventSource[] = [];

  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  readyState = MockEventSource.OPEN;
  closed = false;
  listeners = new Map<string, Array<(event: MessageEvent<string>) => void>>();

  constructor(public readonly url: string) {
    MockEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
    this.readyState = MockEventSource.CLOSED;
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    const callback = listener as (event: MessageEvent<string>) => void;
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), callback]);
  }

  emitNamed(type: string, payload: unknown) {
    const event = { data: JSON.stringify(payload) } as MessageEvent<string>;
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  emitMessage(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent<string>);
  }

  emitError() {
    this.onerror?.();
  }

  static reset() {
    MockEventSource.instances = [];
  }
}

describe('conversationStreamService', () => {
  const originalEventSource = globalThis.EventSource;

  beforeEach(() => {
    globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
    localStorage.clear();
    clearAccessToken();
    MockEventSource.reset();
    conversationStreamService.disconnect();
  });

  it('emits connection_failed when token is missing', () => {
    const listener = vi.fn();
    const unsubscribe = conversationStreamService.subscribe(listener);

    conversationStreamService.connect();

    expect(MockEventSource.instances).toHaveLength(0);
    expect(listener).toHaveBeenCalledWith({
      type: 'connection_failed',
      data: { reason: 'sse.connectionErrors.noToken' },
    });

    unsubscribe();
  });

  it('connects and emits stream events to listeners', () => {
    setAccessToken( 'token-123');
    const listener = vi.fn();
    const unsubscribe = conversationStreamService.subscribe(listener);

    conversationStreamService.connect();

    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0]?.url).toContain('/conversations/stream?token=token-123');

    MockEventSource.instances[0]?.emitMessage({
      type: 'connected',
      data: { connectionId: 'conn-1' },
    });
    MockEventSource.instances[0]?.emitMessage({
      type: 'stream_chunk',
      data: { conversationId: 'c1', messageId: 'm1', component: { id: 'cmp1' } },
    });

    expect(conversationStreamService.getIsConnected()).toBe(true);
    expect(listener).toHaveBeenCalledWith({
      type: 'connected',
      data: { connectionId: 'conn-1' },
    });
    expect(listener).toHaveBeenCalledWith({
      type: 'stream_chunk',
      data: { conversationId: 'c1', messageId: 'm1', component: { id: 'cmp1' } },
    });

    unsubscribe();
  });

  it('handles Nest named SSE events', () => {
    setAccessToken( 'token-123');
    const listener = vi.fn();
    const unsubscribe = conversationStreamService.subscribe(listener);

    conversationStreamService.connect();
    const source = MockEventSource.instances[0];
    source.emitNamed('connected', { connectionId: 'conn-1' });
    source.emitNamed('stream_start', { conversationId: 'c1', messageId: 'm1' });

    expect(conversationStreamService.getIsConnected()).toBe(true);
    expect(listener).toHaveBeenCalledWith({
      type: 'stream_start',
      data: { conversationId: 'c1', messageId: 'm1' },
    });
    unsubscribe();
  });

  it('resolves a pending connection wait when the server confirms the pipe', async () => {
    setAccessToken( 'token-123');

    const ready = conversationStreamService.waitForConnection();
    MockEventSource.instances[0]?.emitNamed('connected', { connectionId: 'conn-1' });

    await expect(ready).resolves.toBe(true);
  });

  it('replaces the existing EventSource when the token is refreshed', () => {
    setAccessToken( 'old-token');
    conversationStreamService.connect();
    const original = MockEventSource.instances[0];

    setAccessToken( 'new-token');
    conversationStreamService.reconnectWithNewToken();

    expect(original.closed).toBe(true);
    expect(MockEventSource.instances).toHaveLength(2);
    expect(MockEventSource.instances[1].url).toContain('token=new-token');
  });

  it('replaces a connected pipe when another singleton changes the shared token', async () => {
    setAccessToken( 'old-token');
    conversationStreamService.connect();
    const original = MockEventSource.instances[0];
    original.emitNamed('connected', { connectionId: 'old-connection' });

    setAccessToken( 'new-token');
    const ready = conversationStreamService.waitForConnection();

    expect(original.closed).toBe(true);
    expect(MockEventSource.instances).toHaveLength(2);
    expect(MockEventSource.instances[1].url).toContain('token=new-token');

    MockEventSource.instances[1].emitNamed('connected', { connectionId: 'new-connection' });
    await expect(ready).resolves.toBe(true);
  });

  it('closes native CONNECTING retries so reconnects can read the latest token', () => {
    vi.useFakeTimers();
    setAccessToken( 'old-token');
    conversationStreamService.connect();
    const original = MockEventSource.instances[0];
    original.emitNamed('connected', { connectionId: 'old-connection' });

    setAccessToken( 'new-token');
    original.readyState = MockEventSource.CONNECTING;
    original.emitError();
    vi.advanceTimersByTime(1000);

    expect(original.closed).toBe(true);
    expect(MockEventSource.instances[1].url).toContain('token=new-token');
    vi.useRealTimers();
  });

  it('keeps chart data arrays when chart payload arrives as JSON strings', () => {
    setAccessToken( 'token-123');
    const listener = vi.fn();
    const unsubscribe = conversationStreamService.subscribe(listener);

    conversationStreamService.connect();

    const source = MockEventSource.instances[0];
    expect(source).toBeDefined();

    source.emitMessage({
      type: 'stream_chunk',
      data: {
        conversationId: 'c1',
        action: 'add',
        component: {
          id: 'chart-1',
          type: 'chart',
          data: {
            title: 'Revenue trend',
            data: '[{"month":"Jan","revenue":42},{"month":"Feb","revenue":84}]',
            chartData: '[{"month":"Jan","revenue":42},{"month":"Feb","revenue":84}]',
            config: '{"revenue":{"label":"Revenue"}}',
            xAxisKey: 'month',
            series: '[{"dataKey":"revenue","label":"Revenue"}]',
            kind: 'CHART_KIND_LINE',
          },
        },
      },
    });

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'stream_chunk',
        data: expect.objectContaining({
          component: expect.objectContaining({
            type: 'chart',
            data: expect.objectContaining({
              data: [
                { month: 'Jan', revenue: 42 },
                { month: 'Feb', revenue: 84 },
              ],
              chartData: [
                { month: 'Jan', revenue: 42 },
                { month: 'Feb', revenue: 84 },
              ],
            }),
          }),
        }),
      }),
    );

    unsubscribe();
  });

  it('emits rejected connection_failed when socket closes before connected', () => {
    setAccessToken( 'token-abc');
    const listener = vi.fn();
    const unsubscribe = conversationStreamService.subscribe(listener);

    conversationStreamService.connect();
    const source = MockEventSource.instances[0];
    expect(source).toBeDefined();

    source.readyState = MockEventSource.CLOSED;
    source.emitError();

    expect(listener).toHaveBeenCalledWith({
      type: 'connection_failed',
      data: { reason: 'sse.connectionErrors.rejected' },
    });

    unsubscribe();
  });

  afterEach(() => {
    conversationStreamService.disconnect();
    globalThis.EventSource = originalEventSource;
  });
});
