import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// The connection hook gates on auth; pretend we're signed in.
vi.mock('@/modules/auth', () => ({ useAuth: () => ({ isAuthenticated: true }) }));

// Sending is now a POST (no EventSource-per-message). Mock the API so we can
// assert the call without hitting the network. The store also imports this
// module, so the same mock backs `store.sendMessage`.
const sendMessageMock = vi.fn().mockResolvedValue(undefined);
const listEventsMock = vi.fn().mockResolvedValue({ items: [], nextSince: 0 });
vi.mock('./api', () => ({
  conversationV2Api: {
    sendMessage: (...args: unknown[]) => sendMessageMock(...args),
    listEvents: (...args: unknown[]) => listEventsMock(...args),
  },
}));

import { useConversationV2StreamConnection } from './useStream';
import { useConversationV2Store } from './store';
import { conversationV2StreamService } from './conversationV2Stream';
import { AUTH_STORAGE_KEYS } from '@/lib/api';

class MockEventSource {
  static instances: MockEventSource[] = [];
  static readonly CLOSED = 2;
  url: string;
  readyState = 1;
  closed = false;
  listeners: Record<string, ((e: MessageEvent) => void)[]> = {};
  onerror: ((ev: Event) => void) | null = null;
  onopen: ((ev: Event) => void) | null = null;
  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }
  addEventListener(type: string, cb: (e: MessageEvent) => void) {
    (this.listeners[type] ||= []).push(cb);
  }
  close() {
    this.closed = true;
    this.readyState = MockEventSource.CLOSED;
  }
  emit(type: string, data: unknown) {
    const ev = { data: JSON.stringify(data) } as MessageEvent;
    (this.listeners[type] || []).forEach((cb) => cb(ev));
  }
}

vi.stubGlobal('EventSource', MockEventSource);

function mountConnection() {
  return renderHook(() => useConversationV2StreamConnection());
}

describe('conversation-v2 per-user stream pipe', () => {
  beforeEach(() => {
    MockEventSource.instances.length = 0;
    localStorage.setItem(AUTH_STORAGE_KEYS.accessToken, 'test-token');
    useConversationV2Store.getState().reset();
    sendMessageMock.mockClear();
    listEventsMock.mockReset();
    listEventsMock.mockResolvedValue({ items: [], nextSince: 0 });
  });
  afterEach(() => {
    conversationV2StreamService.disconnect();
    vi.clearAllMocks();
  });

  it('opens ONE EventSource to the per-user pipe (not per conversation)', () => {
    mountConnection();
    expect(MockEventSource.instances).toHaveLength(1);
    const es = MockEventSource.instances.at(-1)!;
    expect(es.url).toContain('/conversation-v2/stream');
    expect(es.url).toContain('token=test-token');
    // No conversation id in the URL — the pipe carries all conversations.
    expect(es.url).not.toMatch(/sessions\//);
  });

  it('replaces the per-user pipe when the token changes', () => {
    mountConnection();
    const original = MockEventSource.instances.at(-1)!;
    localStorage.setItem(AUTH_STORAGE_KEYS.accessToken, 'refreshed-token');

    conversationV2StreamService.reconnectWithNewToken();

    expect(original.closed).toBe(true);
    expect(MockEventSource.instances.at(-1)?.url).toContain('token=refreshed-token');
  });

  it('reconciles a missed final event when the pipe reconnects', async () => {
    mountConnection();
    useConversationV2Store.getState().setSessionId('s1');
    useConversationV2Store.getState().setStreaming(true);
    listEventsMock.mockResolvedValue({
      items: [{ type: 'done', event_id: 'done-1', timestamp: 1, sequence: 1 }],
      nextSince: 1,
    });

    act(() => MockEventSource.instances.at(-1)!.emit('connected', {}));
    await vi.waitFor(() => expect(useConversationV2Store.getState().streaming).toBe(false));

    expect(listEventsMock).toHaveBeenCalledWith('s1', 0, 200);
  });

  it('sendMessage optimistically echoes the user message and POSTs it', async () => {
    useConversationV2Store.getState().setSessionId('s1');
    await act(async () => {
      await useConversationV2Store.getState().sendMessage('hi');
    });

    const state = useConversationV2Store.getState();
    expect(state.events).toHaveLength(1);
    expect((state.events[0] as { role: string }).role).toBe('user');
    expect(state.streaming).toBe(true);
    expect(sendMessageMock).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ message: 'hi' }),
    );
  });

  it('upserts the SSE echo over the optimistic message without duplicating', async () => {
    mountConnection();
    useConversationV2Store.getState().setSessionId('s1');
    await act(async () => {
      await useConversationV2Store.getState().sendMessage('hi');
    });
    const clientEventId = (
      useConversationV2Store.getState().events[0] as { event_id: string }
    ).event_id;

    const es = MockEventSource.instances.at(-1)!;
    act(() =>
      es.emit('message', {
        sessionId: 's1',
        event_id: clientEventId,
        timestamp: 1,
        role: 'user',
        content: 'hi',
        sequence: 1,
      }),
    );
    expect(useConversationV2Store.getState().events).toHaveLength(1);

    act(() =>
      es.emit('message', {
        sessionId: 's1',
        event_id: 'a1',
        timestamp: 1,
        role: 'assistant',
        content: 'hello',
        sequence: 2,
      }),
    );
    const final = useConversationV2Store.getState();
    expect(final.events).toHaveLength(2);
    expect((final.events[1] as { role: string }).role).toBe('assistant');
  });

  it('routes events for OTHER conversations into the background cache', () => {
    mountConnection();
    useConversationV2Store.getState().setSessionId('s1');

    const es = MockEventSource.instances.at(-1)!;
    act(() =>
      es.emit('message', {
        sessionId: 's2',
        event_id: 'b1',
        timestamp: 1,
        role: 'assistant',
        content: 'background reply',
        sequence: 1,
      }),
    );

    const state = useConversationV2Store.getState();
    // Current view (s1) is untouched...
    expect(state.events).toHaveLength(0);
    // ...but s2's live state accumulated in the cache.
    const cached = state.streamingStateCache.get('s2');
    expect(cached?.events).toHaveLength(1);
  });

  it('clears the thinking state when a done event arrives for the current session', async () => {
    mountConnection();
    useConversationV2Store.getState().setSessionId('s1');
    await act(async () => {
      await useConversationV2Store.getState().sendMessage('hi');
    });
    expect(useConversationV2Store.getState().streaming).toBe(true);

    const es = MockEventSource.instances.at(-1)!;
    // Contiguous sequence (1) so no gap-backfill is triggered — the done is
    // applied synchronously.
    act(() => es.emit('done', { sessionId: 's1', event_id: 'd1', timestamp: 1, sequence: 1 }));
    expect(useConversationV2Store.getState().streaming).toBe(false);
  });
});
