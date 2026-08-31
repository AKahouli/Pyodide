import {
  conversationFilterHash,
  decodeConversationCursor,
  encodeConversationCursor,
} from './conversation-cursor';

describe('conversation cursor', () => {
  const payload = {
    v: 1 as const,
    s: 'lastMessageAt' as const,
    d: 'desc' as const,
    n: 0 as const,
    value: '2026-08-30T12:00:00.000Z',
    id: '0123456789abcdef01234567',
    f: conversationFilterHash({ archived: false }),
  };

  it('round trips a valid versioned payload', () => {
    expect(decodeConversationCursor(encodeConversationCursor(payload))).toEqual(payload);
  });

  it.each([
    'not-json',
    Buffer.from(JSON.stringify({ ...payload, v: 2 })).toString('base64url'),
    Buffer.from(JSON.stringify({ ...payload, id: 'invalid' })).toString('base64url'),
    Buffer.from(JSON.stringify({ ...payload, n: 1 })).toString('base64url'),
    Buffer.from(JSON.stringify({ ...payload, extra: true })).toString('base64url'),
  ])('rejects malformed payload %s', (cursor) => {
    expect(() => decodeConversationCursor(cursor)).toThrow('Invalid conversation cursor');
  });
});
