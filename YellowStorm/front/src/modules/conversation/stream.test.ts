import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { conversationStreamService } from './stream';

vi.mock('@/lib/api', () => ({
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

  constructor(public readonly url: string) {
    MockEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
    this.readyState = MockEventSource.CLOSED;
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
    localStorage.setItem('accessToken', 'token-123');
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

  it('keeps chart data arrays when chart payload arrives as JSON strings', () => {
    localStorage.setItem('accessToken', 'token-123');
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
    localStorage.setItem('accessToken', 'token-abc');
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
