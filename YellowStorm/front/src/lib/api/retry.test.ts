import { describe, it, expect, vi } from 'vitest';
import { withRetry } from './retry';

describe('withRetry', () => {
  it('resolves on first attempt when fn succeeds', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    await expect(withRetry(fn, { maxAttempts: 3, baseDelayMs: 10 })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on retryable error and resolves on subsequent attempt', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ code: 'ERR_NETWORK' })
      .mockResolvedValueOnce('ok');
    await expect(withRetry(fn, { maxAttempts: 3, baseDelayMs: 10 })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws after exhausting maxAttempts', async () => {
    const err = { code: 'ERR_NETWORK' };
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withRetry(fn, { maxAttempts: 2, baseDelayMs: 10 })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not retry on non-retryable error (4xx)', async () => {
    const err = { statusCode: 404 };
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withRetry(fn, { maxAttempts: 3, baseDelayMs: 10 })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('rejects immediately on abort', async () => {
    const ac = new AbortController();
    const fn = vi.fn().mockImplementation(() => {
      return new Promise((_resolve, reject) => {
        ac.signal.addEventListener('abort', () => reject(ac.signal.reason ?? new DOMException('Aborted', 'AbortError')), { once: true });
      });
    });
    const promise = withRetry(fn, { maxAttempts: 3, baseDelayMs: 10_000, signal: ac.signal });
    ac.abort();
    await expect(promise).rejects.toThrow('aborted');
  });

  it('does not retry on non-retryable error when first attempt', async () => {
    const err = new Error('some error');
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withRetry(fn, { maxAttempts: 3, baseDelayMs: 10 })).rejects.toThrow('some error');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
