import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useConversationV2Stream } from './useStream';
import { useConversationV2Store } from './store';

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  closed = false;
  listeners: Record<string, ((e: MessageEvent) => void)[]> = {};
  onerror: ((ev: Event) => void) | null = null;
  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }
  addEventListener(type: string, cb: (e: MessageEvent) => void) {
    (this.listeners[type] ||= []).push(cb);
  }
  close() { this.closed = true; }
  emit(type: string, data: unknown) {
    const ev = { data: JSON.stringify(data) } as MessageEvent;
    (this.listeners[type] || []).forEach((cb) => cb(ev));
  }
}

vi.stubGlobal('EventSource', MockEventSource);

describe('useConversationV2Stream', () => {
  beforeEach(() => {
    MockEventSource.instances.length = 0;
    useConversationV2Store.getState().reset();
  });
  afterEach(() => vi.clearAllMocks());

  it('opens an EventSource with the message + clientEventId in the query string', () => {
    renderHook(() => useConversationV2Stream());
    act(() => {
      useConversationV2Store.getState().setSessionId('s1');
    });
    const { result } = renderHook(() => useConversationV2Stream());
    act(() => result.current.send('hello'));
    const es = MockEventSource.instances.at(-1)!;
    expect(es.url).toContain('conversation-v2/sessions/s1/stream');
    expect(es.url).toContain('message=hello');
    expect(es.url).toMatch(/clientEventId=[0-9a-fA-F-]{36}/);
  });

  it('optimistically echoes the user message and then upserts via SSE without duplicating', () => {
    const { result } = renderHook(() => useConversationV2Stream());
    act(() => useConversationV2Store.getState().setSessionId('s1'));
    act(() => result.current.send('hi'));

    // send() optimistically adds the user message immediately so the bubble
    // is visible before the backend's user frame arrives.
    const stateAfterSend = useConversationV2Store.getState();
    expect(stateAfterSend.events).toHaveLength(1);
    const optimistic = stateAfterSend.events[0] as { role: string; event_id: string };
    expect(optimistic.role).toBe('user');
    const clientEventId = optimistic.event_id;

    // Backend echoes the same user message back over SSE (same event_id,
    // now with a sequence). It should REPLACE the optimistic one, not append.
    const es = MockEventSource.instances.at(-1)!;
    act(() =>
      es.emit('message', {
        event_id: clientEventId,
        timestamp: 1,
        role: 'user',
        content: 'hi',
        sequence: 1,
      }),
    );
    expect(useConversationV2Store.getState().events).toHaveLength(1);

    // Assistant reply appends normally.
    act(() =>
      es.emit('message', {
        event_id: 'a1',
        timestamp: 1,
        role: 'assistant',
        content: 'hi',
        sequence: 2,
      }),
    );
    const finalState = useConversationV2Store.getState();
    expect(finalState.events).toHaveLength(2);
    expect((finalState.events[0] as { role: string }).role).toBe('user');
    expect((finalState.events[1] as { role: string }).role).toBe('assistant');
  });

  it('closes the EventSource on done', () => {
    const { result } = renderHook(() => useConversationV2Stream());
    act(() => useConversationV2Store.getState().setSessionId('s1'));
    act(() => result.current.send('hi'));
    const es = MockEventSource.instances.at(-1)!;
    act(() => es.emit('done', { event_id: 'e1', timestamp: 1 }));
    expect(es.closed).toBe(true);
  });
});
