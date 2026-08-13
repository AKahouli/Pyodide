import { describe, it, expect, beforeEach } from 'vitest';
import { useWorkyStore } from './store';
import type { WorkyMessage } from './types';

const msg = (over: Partial<WorkyMessage>): WorkyMessage => ({
  id: 'm1',
  role: 'owner',
  content: 'Hello',
  planDeltaRef: null,
  createdAt: '2026-07-31T10:00:00.000Z',
  ...over,
});

beforeEach(() => useWorkyStore.getState().reset());

describe('useWorkyStore.appendMessage', () => {
  it('appends a new message', () => {
    useWorkyStore.getState().appendMessage(msg({ id: 'm1' }));
    expect(useWorkyStore.getState().messages).toHaveLength(1);
  });

  it('ignores a message whose id is already in the thread', () => {
    // The owner message reaches the client twice: once via the POST response
    // (React Query cache -> setMessages) and once via the SSE frame the
    // backend emits for the same save.
    const owner = msg({ id: 'm1', content: 'Ship the report' });
    useWorkyStore.getState().setMessages([owner]);
    useWorkyStore.getState().appendMessage(owner);

    expect(useWorkyStore.getState().messages).toHaveLength(1);
  });

  it('keeps distinct messages that share the same content', () => {
    useWorkyStore.getState().appendMessage(msg({ id: 'm1', content: 'ok' }));
    useWorkyStore.getState().appendMessage(msg({ id: 'm2', content: 'ok' }));

    expect(useWorkyStore.getState().messages.map((m) => m.id)).toEqual(['m1', 'm2']);
  });
});

describe('useWorkyStore.setMessages', () => {
  it('collapses same-id duplicates on replace (owner-message flicker guard)', () => {
    // The React Query messages cache can transiently hold the just-sent owner
    // message twice — a racing refetch lands it, then the POST onSuccess appends
    // the same id again. WorkyStreamPage mirrors that cache into the store via
    // setMessages, so the render source must be duplicate-proof by id.
    const owner = msg({ id: 'm1', content: 'Ship the report' });
    useWorkyStore.getState().setMessages([owner, { ...owner }]);

    expect(useWorkyStore.getState().messages).toHaveLength(1);
  });

  it('keeps first occurrence and preserves order', () => {
    useWorkyStore.getState().setMessages([
      msg({ id: 'a', content: 'first' }),
      msg({ id: 'b', content: 'second' }),
      msg({ id: 'a', content: 'dup-of-first' }),
    ]);

    const messages = useWorkyStore.getState().messages;
    expect(messages.map((m) => m.id)).toEqual(['a', 'b']);
    expect(messages[0].content).toBe('first');
  });
});
