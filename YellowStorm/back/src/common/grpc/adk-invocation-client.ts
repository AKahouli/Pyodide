export interface AdkReadableCall<T> {
  on(event: 'data', listener: (chunk: T) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'end', listener: () => void): this;
  removeListener(event: string, listener: (...args: any[]) => void): this;
  cancel(): void;
  pause?(): void;
  resume?(): void;
}

export class AdkInvocationError extends Error {
  constructor(readonly kind: 'timeout' | 'transport' | 'consumer' | 'aborted' | 'overflow') {
    super(`ADK invocation ${kind}`);
  }
}

/** Raw transport only: EOF never establishes native completion. */
export class AdkInvocationClient {
  static consume<T>(
    call: AdkReadableCall<T>,
    options: {
      timeoutMs: number;
      signal?: AbortSignal;
      onChunk: (chunk: T) => void | Promise<void>;
    },
  ): Promise<void> {
    if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)
      throw new Error('Invalid ADK transport deadline');
    return new Promise((resolve, reject) => {
      let settled = false;
      let pending = 0;
      let chain = Promise.resolve();
      const cleanup = () => {
        clearTimeout(timer);
        call.removeListener('data', onData);
        call.removeListener('end', onEnd);
        options.signal?.removeEventListener('abort', onAbort);
        // Keep the settled error handler for the RPC's eventual cancellation
        // error; removing it can cause an unhandled EventEmitter error.
      };
      const fail = (kind: AdkInvocationError['kind']) => {
        if (settled) return;
        settled = true;
        cleanup();
        call.cancel();
        reject(new AdkInvocationError(kind));
      };
      const onAbort = () => fail('aborted');
      const onData = (chunk: T) => {
        if (settled) return;
        if (++pending > 64) {
          fail('overflow');
          return;
        }
        call.pause?.();
        chain = chain
          .then(async () => {
            if (!settled) await options.onChunk(chunk);
          })
          .catch(() => fail('consumer'))
          .finally(() => {
            pending--;
            if (!settled && pending === 0) call.resume?.();
          });
      };
      const onEnd = () => {
        void chain.then(() => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve();
        });
      };
      const timer = setTimeout(() => fail('timeout'), options.timeoutMs);
      call.on('data', onData);
      call.on('error', () => fail('transport'));
      call.on('end', onEnd);
      options.signal?.addEventListener('abort', onAbort, { once: true });
      if (options.signal?.aborted) onAbort();
    });
  }
}
