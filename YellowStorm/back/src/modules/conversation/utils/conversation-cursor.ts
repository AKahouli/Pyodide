import { createHash } from 'node:crypto';
import { BadRequestException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';

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
const OBJECT_ID = /^[0-9a-f]{24}$/;
const HASH = /^[0-9a-f]{64}$/;

export function conversationFilterHash(filters: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(filters)).digest('hex');
}

export function encodeConversationCursor(payload: ConversationCursorPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

export function decodeConversationCursor(value: string): ConversationCursorPayload {
  try {
    const payload = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (
      !payload ||
      Array.isArray(payload) ||
      Object.keys(payload).sort().join(',') !== KEYS.join(',') ||
      payload.v !== 1 ||
      !['lastMessageAt', 'createdAt', 'title'].includes(String(payload.s)) ||
      !['asc', 'desc'].includes(String(payload.d)) ||
      ![0, 1].includes(payload.n as number) ||
      (payload.value !== null && typeof payload.value !== 'string') ||
      !OBJECT_ID.test(String(payload.id)) ||
      !HASH.test(String(payload.f))
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
    return payload as unknown as ConversationCursorPayload;
  } catch {
    throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Invalid conversation cursor');
  }
}
