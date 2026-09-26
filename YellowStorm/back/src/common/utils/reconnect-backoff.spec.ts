import { ReconnectBackoff } from './reconnect-backoff';

describe('ReconnectBackoff', () => {
  const makeBackoff = (configOverrides: Partial<{ enabled: boolean; maxAttempts: number; maxDelayMs: number }> = {}) => {
    const calls: string[] = [];
    const backoff = new ReconnectBackoff(
      {
        enabled: true,
        initialDelayMs: 1000,
        maxDelayMs: 120000,
        maxAttempts: 0,
        multiplier: 2,
        ...configOverrides,
      },
      {
        connect: () => calls.push('connect'),
        label: () => 'Test',
        log: (message) => calls.push(`log:${message}`),
        warn: (message) => calls.push(`warn:${message}`),
        error: (message) => calls.push(`error:${message}`),
      },
    );
    return { backoff, calls };
  };

  it('increments the attempt counter and reports a pending timeout while waiting', () => {
    jest.useFakeTimers();
    try {
      const { backoff } = makeBackoff();
      backoff.schedule();
      expect(backoff.attempts).toBe(1);
      expect(backoff.isWaiting).toBe(true);
      backoff.clear();
      expect(backoff.isWaiting).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('gives up once the max attempt count is reached', () => {
    jest.useFakeTimers();
    try {
      const { backoff, calls } = makeBackoff({ maxAttempts: 2 });
      backoff.schedule();
      backoff.schedule();
      backoff.schedule();
      expect(backoff.attempts).toBe(2);
      expect(calls.some((call) => call.startsWith('error:Max reconnection attempts (2)'))).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('grows the delay exponentially and caps it at maxDelayMs', () => {
    jest.useFakeTimers();
    try {
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
      const { backoff, calls } = makeBackoff({ maxDelayMs: 3000 });
      backoff.schedule();
      backoff.schedule();
      backoff.schedule();
      backoff.schedule();

      const delays = setTimeoutSpy.mock.calls.map((call) => call[1] as number);
      expect(delays[0]).toBeGreaterThanOrEqual(900); // 1000ms with ±10% jitter
      expect(delays[1]).toBeGreaterThanOrEqual(1800); // 2000ms with ±10% jitter
      expect(delays[2]).toBe(3000); // capped, not 4000ms * jitter
      expect(delays[3]).toBe(3000); // capped, not 8000ms * jitter
      expect(backoff.attempts).toBe(4);
      expect(calls.filter((call) => call.startsWith('log:')).length).toBe(4);
      setTimeoutSpy.mockRestore();
      backoff.clear();
    } finally {
      jest.useRealTimers();
    }
  });

  it('resets the attempt counter after a successful reconnection', () => {
    const { backoff } = makeBackoff({ maxAttempts: 1 });
    backoff.schedule();
    expect(backoff.attempts).toBe(1);
    backoff.reset();
    expect(backoff.attempts).toBe(0);
    backoff.schedule();
    expect(backoff.attempts).toBe(1);
  });
});
