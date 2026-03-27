import { describe, expect, it, vi } from 'vitest';
import { getErrorCode, getErrorMessage } from './errorHelpers';

describe('errorHelpers', () => {
  it('extracts error code when present', () => {
    expect(getErrorCode({ code: 'ERR_1101' })).toBe('ERR_1101');
    expect(getErrorCode(new Error('boom'))).toBeNull();
    expect(getErrorCode(null)).toBeNull();
  });

  it('returns translated message when code translation exists', () => {
    const translate = vi.fn((key: string) => {
      if (key === 'auth.errors.ERR_1101') return 'Email already exists';
      return key;
    });

    const message = getErrorMessage(
      { code: 'ERR_1101', message: 'raw backend message' },
      translate,
      { translationPrefix: 'auth.errors', fallbackKey: 'auth.errors.fallback' },
    );

    expect(message).toBe('Email already exists');
  });

  it('falls back to error.message when translation key is missing', () => {
    const translate = vi.fn((key: string) => key);

    const message = getErrorMessage(
      { code: 'ERR_UNKNOWN', message: 'plain message' },
      translate,
      { translationPrefix: 'auth.errors', fallbackKey: 'auth.errors.fallback' },
    );

    expect(message).toBe('plain message');
  });

  it('falls back to translated fallback key when no code/message exist', () => {
    const translate = vi.fn((key: string) => (key === 'auth.errors.fallback' ? 'Something went wrong' : key));

    const message = getErrorMessage(
      { details: [] },
      translate,
      { translationPrefix: 'auth.errors', fallbackKey: 'auth.errors.fallback' },
    );

    expect(message).toBe('Something went wrong');
  });
});
