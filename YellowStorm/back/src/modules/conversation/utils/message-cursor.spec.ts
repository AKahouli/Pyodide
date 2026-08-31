import { decodeMessageCursor, encodeMessageCursor, messageFilterHash } from './message-cursor';

describe('message cursor', () => {
  const payload = {
    v: 1 as const,
    createdAt: '2026-08-30T12:00:00.000Z',
    id: '0123456789abcdef01234567',
    f: messageFilterHash('user'),
  };

  it('round trips a valid versioned payload', () => {
    expect(decodeMessageCursor(encodeMessageCursor(payload))).toEqual(payload);
  });

  it.each([
    'not-json',
    Buffer.from(JSON.stringify({ ...payload, v: 2 })).toString('base64url'),
    Buffer.from(JSON.stringify({ ...payload, createdAt: 'invalid' })).toString('base64url'),
    Buffer.from(JSON.stringify({ ...payload, extra: true })).toString('base64url'),
  ])('rejects malformed payload %s', (cursor) => {
    expect(() => decodeMessageCursor(cursor)).toThrow('Invalid message cursor');
  });
});
