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

describe('playbook validation error messages', () => {
  it('preserves the strict flow validation error code', () => {
    expect(getErrorMessage(ErrorCode.PLAYBOOK_FLOW_VALIDATION_FAILED)).toBe('Correct the highlighted workflow issues before saving.');
  });
});

describe('user invitation error messages', () => {
  it.each([
    [ErrorCode.AUTH_INVITE_TOKEN_INVALID, 'This invitation link is invalid or has already been used.'],
    [ErrorCode.AUTH_INVITE_TOKEN_EXPIRED, 'This invitation link has expired. Ask an administrator to send a new one.'],
    [ErrorCode.AUTH_INVITE_EMAIL_MISMATCH, 'This invitation was issued for a different email address.'],
    [ErrorCode.USER_INVITE_EMAIL_FAILED, 'The invitation email could not be sent. Please try again.'],
  ])('maps %s to a specific message', (code, message) => {
    expect(getErrorMessage(code)).toBe(message);
  });
});
