import { BadRequestException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';

export const CURSOR_OBJECT_ID = /^[0-9a-f]{24}$/;
export const CURSOR_FILTER_HASH = /^[0-9a-f]{64}$/;

/**
 * Base64url + JSON cursor codec shared by the conversation and message
 * cursors. Payload-specific field validation stays in the callers' wrappers.
 */
export function encodeCursor(payload: object): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

export function decodeCursor<T>(
  value: string,
  expectedKeys: string[],
  validate: (payload: Record<string, unknown>) => void,
  errorMessage: string,
): T {
  try {
    const payload = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (
      !payload
      || Array.isArray(payload)
      || Object.keys(payload).sort().join(',') !== [...expectedKeys].sort().join(',')
      || payload.v !== 1
    ) {
      throw new Error('invalid cursor');
    }
    validate(payload);
    return payload as unknown as T;
  } catch {
    throw new BadRequestException(ErrorCode.VALIDATION_ERROR, errorMessage);
  }
}
