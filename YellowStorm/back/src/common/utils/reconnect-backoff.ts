import { randomBackoffJitter } from './random.util';

export interface ReconnectBackoffConfig {
  enabled: boolean;
  initialDelayMs: number;
  maxDelayMs: number;
  maxAttempts: number;
  multiplier: number;
}

export interface ReconnectBackoffHooks {
  /** Attempts to (re)establish the connection. */
  connect: () => unknown;
  /** Connection label used in log lines (may vary at runtime, e.g. SMTP vs Outlook). */
  label: () => string;
  log: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

/**
 * Shared reconnect state machine for long-lived external connections (email,
 * document storage, LiteLLM). Owns the attempt counter, the pending timeout
 * and the exponential backoff calculation (with ±10% jitter, capped at
 * maxDelayMs). Timing values and state transitions stay owned by the caller's
 * config; this class only schedules and counts.
 */
export class ReconnectBackoff {
  private attempt = 0;
  private timeout: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: ReconnectBackoffConfig,
    private readonly hooks: ReconnectBackoffHooks,
  ) {}

  get attempts(): number {
    return this.attempt;
  }

  get isWaiting(): boolean {
    return this.timeout !== null;
  }

  /** Marks the connection healthy again; the next failure starts at attempt 1. */
  reset(): void {
    this.attempt = 0;
  }

  clear(): void {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
  }

  schedule(): void {
    const { enabled, maxAttempts, initialDelayMs, maxDelayMs, multiplier } = this.config;
    const label = this.hooks.label();

    if (!enabled) {
      this.hooks.warn(`Reconnection disabled, ${label} will remain disconnected`);
      return;
    }

    if (maxAttempts > 0 && this.attempt >= maxAttempts) {
      this.hooks.error(`Max reconnection attempts (${maxAttempts}) reached for ${label}. Giving up.`);
      return;
    }

    this.clear();

    // Add jitter (±10%) to prevent thundering herd
    const delay = Math.min(initialDelayMs * Math.pow(multiplier, this.attempt) * randomBackoffJitter(), maxDelayMs);
    this.attempt++;
    this.hooks.log(`Scheduling ${label} reconnection attempt ${this.attempt} in ${delay}ms`);

    this.timeout = setTimeout(() => {
      void this.hooks.connect();
    }, delay);

    this.timeout.unref();
  }
}
