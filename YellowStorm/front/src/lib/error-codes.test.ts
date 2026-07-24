import { describe, expect, it } from 'vitest';
import { ErrorCode, getErrorMessage } from './error-codes';

describe('conversation branch error messages', () => {
  it.each([
    [ErrorCode.CHAT_BRANCH_INVALID, 'The selected conversation branch is invalid.'],
    [ErrorCode.CHAT_BRANCH_UNSUPPORTED, 'This conversation cannot be branched.'],
    [ErrorCode.CHAT_BRANCH_SEED_FAILED, 'The conversation branch could not be created. Please try again.'],
  ])('maps %s to a specific message', (code, message) => {
    expect(getErrorMessage(code)).toBe(message);
  });
});
