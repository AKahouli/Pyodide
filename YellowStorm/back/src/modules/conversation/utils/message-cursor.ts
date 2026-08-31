import { createHash } from 'node:crypto';
import { BadRequestException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';

export interface MessageCursorPayload {
  v: 1;
  createdAt: string;
  id: string;
  f: string;
}

const KEYS = ['createdAt', 'f', 'id', 'v'];
const OBJECT_ID = /^[0-9a-f]{24}$/;
const HASH = /^[0-9a-f]{64}$/;

export function messageFilterHash(conversationType?: 'user' | 'ai'): string {
  return createHash('sha256')
    .update(JSON.stringify({ conversationType: conversationType ?? null }))
    .digest('hex');
}

export function encodeMessageCursor(payload: MessageCursorPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

export function decodeMessageCursor(value: string): MessageCursorPayload {
  try {
    const payload = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (
      !payload ||
      Array.isArray(payload) ||
      Object.keys(payload).sort().join(',') !== KEYS.join(',') ||
      payload.v !== 1 ||
      typeof payload.createdAt !== 'string' ||
      Number.isNaN(Date.parse(payload.createdAt)) ||
      !OBJECT_ID.test(String(payload.id)) ||
      !HASH.test(String(payload.f))
    ) throw new Error('invalid cursor');
    return payload as unknown as MessageCursorPayload;
  } catch {
    throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Invalid message cursor');
  }
}
