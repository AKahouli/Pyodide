/**
 * Opt-in retry helper for idempotent operations (GET/HEAD).
 * Exponential backoff with jitter, cancellation via AbortSignal.
 */

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  signal?: AbortSignal;
}

function jitter(delay: number): number {
  return Math.round(delay * (0.5 + Math.random() * 0.5));
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function isRetryable(error: unknown): boolean {
  if (error && typeof error === 'object') {
    const code = (error as { code?: string }).code;
    if (code === 'ERR_NETWORK' || code === 'ERR_CANCELED') return true;
    const status = (error as { statusCode?: number }).statusCode;
    if (status !== undefined) {
      return status >= 500 || status === 429 || status === 0;
    }
  }
  return false;
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const maxAttempts = options?.maxAttempts ?? 3;
  const baseDelayMs = options?.baseDelayMs ?? 500;
  const maxDelayMs = options?.maxDelayMs ?? 10_000;
  const signal = options?.signal;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts || !isRetryable(error)) {
        throw error;
      }
      const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      await sleep(jitter(delay), signal);
    }
  }

  throw lastError;
}

export async function withRetryGet<T = unknown>(
  url: string,
  config?: import('axios').AxiosRequestConfig & RetryOptions,
): Promise<import('axios').AxiosResponse<T>> {
  const { maxAttempts, baseDelayMs, maxDelayMs, signal, ...axiosConfig } = config ?? {};
  const { apiClient } = await import('./client');
  return withRetry(
    () => apiClient.get<T>(url, { ...axiosConfig, signal }),
    { maxAttempts, baseDelayMs, maxDelayMs, signal },
  );
}
