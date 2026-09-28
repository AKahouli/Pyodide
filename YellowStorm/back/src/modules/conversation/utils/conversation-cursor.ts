import { createHash } from 'node:crypto';
import { CURSOR_FILTER_HASH, CURSOR_OBJECT_ID, decodeCursor, encodeCursor } from './cursor-codec';

export type ConversationCursorSort = 'lastMessageAt' | 'createdAt' | 'title';
export type ConversationCursorDirection = 'asc' | 'desc';

export interface ConversationCursorPayload {
  v: 1;
  s: ConversationCursorSort;
  d: ConversationCursorDirection;
  n: 0 | 1;
  value: string | null;
  id: string;
  f: string;
}

const KEYS = ['d', 'f', 'id', 'n', 's', 'v', 'value'];

export function conversationFilterHash(filters: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(filters)).digest('hex');
}

export function encodeConversationCursor(payload: ConversationCursorPayload): string {
  return encodeCursor(payload);
}

export function decodeConversationCursor(value: string): ConversationCursorPayload {
  return decodeCursor<ConversationCursorPayload>(
    value,
    KEYS,
    (payload) => {
      if (
        !['lastMessageAt', 'createdAt', 'title'].includes(String(payload.s))
        || !['asc', 'desc'].includes(String(payload.d))
        || ![0, 1].includes(payload.n as number)
        || (payload.value !== null && typeof payload.value !== 'string')
        || !CURSOR_OBJECT_ID.test(String(payload.id))
        || !CURSOR_FILTER_HASH.test(String(payload.f))
      ) {
        throw new Error('invalid cursor');
      }
      if (payload.s === 'lastMessageAt' && ((payload.n === 1) !== (payload.value === null))) {
        throw new Error('invalid null rank');
      }
      if (payload.s !== 'lastMessageAt' && (payload.n !== 0 || payload.value === null)) {
        throw new Error('invalid sort value');
      }
      if (payload.s !== 'title' && payload.value !== null && Number.isNaN(Date.parse(payload.value as string))) {
        throw new Error('invalid cursor timestamp');
      }
    },
    'Invalid conversation cursor',
  );
}
