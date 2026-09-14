import { describe, expect, it } from 'vitest';
import {
  AuthTransientError,
  bumpAuthGeneration,
  getAuthGeneration,
  getAuthRecoveryState,
  isDefinitiveAuthFailure,
  isTransientAuthFailure,
  notifyAuthRecovered,
  notifyAuthRecovering,
  notifyAuthUnavailable,
  resetAuthRecovery,
  subscribeAuthRecovery,
} from './authRecovery';

describe('isTransientAuthFailure', () => {
  it('treats missing-envelope/network errors as transient', () => {
    expect(isTransientAuthFailure(new Error('Network Error'))).toBe(true);
    expect(isTransientAuthFailure({ code: 'ERR_NETWORK', message: 'timeout' })).toBe(true);
    expect(isTransientAuthFailure(undefined)).toBe(true);
  });

  it('treats 429 and 5xx responses as transient', () => {
    expect(isTransientAuthFailure({ code: 'ERR_1008', statusCode: 503 })).toBe(true);
    expect(isTransientAuthFailure({ code: 'ERR_1130', statusCode: 503 })).toBe(true);
    expect(isTransientAuthFailure({ statusCode: 500 })).toBe(true);
    expect(isTransientAuthFailure({ statusCode: 429 })).toBe(true);
    expect(isTransientAuthFailure({ statusCode: 502 })).toBe(true);
  });

  it('treats rotation conflicts (ERR_1131) as retryable, not credential denials', () => {
    expect(isTransientAuthFailure({ code: 'ERR_1131', statusCode: 409 })).toBe(true);
    expect(isDefinitiveAuthFailure({ code: 'ERR_1131', statusCode: 409 })).toBe(false);
  });

  it('treats definitive credential/account denials as non-transient', () => {
    expect(isTransientAuthFailure({ code: 'ERR_1107', statusCode: 401 })).toBe(false);
    expect(isTransientAuthFailure({ code: 'ERR_1108', statusCode: 401 })).toBe(false);
    expect(isTransientAuthFailure({ code: 'ERR_1113', statusCode: 401 })).toBe(false);
    expect(isTransientAuthFailure({ code: 'ERR_1110', statusCode: 401 })).toBe(false);
    expect(isTransientAuthFailure({ code: 'ERR_1003', statusCode: 401 })).toBe(false);
  });

  it('treats ordinary 4xx permission denials as non-transient', () => {
    expect(isTransientAuthFailure({ code: 'ERR_2100', statusCode: 403 })).toBe(false);
  });

  it('AuthTransientError is transient', () => {
    expect(isTransientAuthFailure(new AuthTransientError())).toBe(true);
    expect(isDefinitiveAuthFailure(new AuthTransientError())).toBe(false);
  });
});

describe('recovery state machine', () => {
  it('moves idle -> recovering -> unavailable -> recovered', () => {
    const seen: Array<ReturnType<typeof getAuthRecoveryState>> = [];
    const unsubscribe = subscribeAuthRecovery((s) => seen.push(s));

    expect(getAuthRecoveryState()).toBe('idle');
    notifyAuthUnavailable();
    expect(getAuthRecoveryState()).toBe('unavailable');
    notifyAuthRecovering();
    notifyAuthRecovered();
    expect(getAuthRecoveryState()).toBe('idle');

    expect(seen).toEqual(['unavailable', 'recovering', 'idle']);
    unsubscribe();
  });

  it('resetAuthRecovery returns to idle (logout cancels recovery)', () => {
    notifyAuthUnavailable();
    resetAuthRecovery();
    expect(getAuthRecoveryState()).toBe('idle');
  });

  it('generation increments on logout', () => {
    const before = getAuthGeneration();
    bumpAuthGeneration();
    expect(getAuthGeneration()).toBe(before + 1);
  });
});
