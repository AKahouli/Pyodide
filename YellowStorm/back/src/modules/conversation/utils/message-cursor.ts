import { createHash } from 'node:crypto';
import { CURSOR_FILTER_HASH, CURSOR_OBJECT_ID, decodeCursor, encodeCursor } from './cursor-codec';

export interface MessageCursorPayload {
  v: 1;
  createdAt: string;
  id: string;
  f: string;
}

const KEYS = ['createdAt', 'f', 'id', 'v'];

export function messageFilterHash(conversationType?: 'user' | 'ai'): string {
  return createHash('sha256')
    .update(JSON.stringify({ conversationType: conversationType ?? null }))
    .digest('hex');
}

export function encodeMessageCursor(payload: MessageCursorPayload): string {
  return encodeCursor(payload);
}

export function decodeMessageCursor(value: string): MessageCursorPayload {
  return decodeCursor<MessageCursorPayload>(
    value,
    KEYS,
    (payload) => {
      if (
        typeof payload.createdAt !== 'string'
        || Number.isNaN(Date.parse(payload.createdAt))
        || !CURSOR_OBJECT_ID.test(String(payload.id))
        || !CURSOR_FILTER_HASH.test(String(payload.f))
      ) {
        throw new Error('invalid cursor');
      }
    },
    'Invalid message cursor',
  );
}
