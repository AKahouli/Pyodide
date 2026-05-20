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

  it('opens an EventSource with the message in query string', () => {
    renderHook(() => useConversationV2Stream());
    act(() => {
      useConversationV2Store.getState().setSessionId('s1');
    });
    const { result } = renderHook(() => useConversationV2Stream());
    act(() => result.current.send('hello'));
    const es = MockEventSource.instances.at(-1)!;
    expect(es.url).toContain('conversation-v2/sessions/s1/stream');
    expect(es.url).toContain('message=hello');
  });

  it('routes message events into the store', () => {
    const { result } = renderHook(() => useConversationV2Stream());
    act(() => useConversationV2Store.getState().setSessionId('s1'));
    act(() => result.current.send('hi'));
    // send() optimistically adds the user message (1 event already in store)
    expect(useConversationV2Store.getState().events.length).toBe(1);
    expect((useConversationV2Store.getState().events[0] as any).role).toBe('user');
    const es = MockEventSource.instances.at(-1)!;
    act(() => es.emit('message', { event_id: 'e1', timestamp: 1, role: 'assistant', content: 'hi' }));
    // server response appended → 2 total
    expect(useConversationV2Store.getState().events.length).toBe(2);
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
