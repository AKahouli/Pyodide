import { describe, it, expect, vi } from 'vitest';
import { waitForHostReady, HOST_READY_TIMEOUT_MS } from './wait-for-host-ready';
import type { BrowserRuntimeHost } from './BrowserRuntimeHost';
import type { HostState } from './BrowserRuntimeHost';
import type { RuntimeHostStatus } from './runtime.types';

function mockHost(initial: RuntimeHostStatus): {
  host: BrowserRuntimeHost;
  setStatus: (status: RuntimeHostStatus, error?: string) => void;
} {
  let status: RuntimeHostStatus = initial;
  let error: string | null = null;
  const listeners = new Set<(s: HostState) => void>();

  const state = (): HostState => ({
    status,
    previewUrl: null,
    error,
    files: {},
    revisionId: 'rev_0',
  });

  const host = {
    get state() {
      return state();
    },
    subscribe(listener: (s: HostState) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as unknown as BrowserRuntimeHost;

  return {
    host,
    setStatus: (next, err) => {
      status = next;
      error = err ?? null;
      const snapshot = state();
      for (const l of listeners) l(snapshot);
    },
  };
}

describe('waitForHostReady', () => {
  it('resolves immediately when already ready', async () => {
    const { host } = mockHost('ready');
    await expect(waitForHostReady(host, { timeoutMs: 100 })).resolves.toBe('ready');
  });

  it('resolves immediately when already in error', async () => {
    const { host } = mockHost('error');
    await expect(waitForHostReady(host, { timeoutMs: 100 })).resolves.toBe('error');
  });

  it('resolves ready when status becomes ready', async () => {
    const { host, setStatus } = mockHost('installing');
    const pending = waitForHostReady(host, { timeoutMs: 1_000 });
    setStatus('ready');
    await expect(pending).resolves.toBe('ready');
  });

  it('resolves error when boot fails', async () => {
    const { host, setStatus } = mockHost('hydrating');
    const pending = waitForHostReady(host, { timeoutMs: 1_000 });
    setStatus('error', 'boom');
    await expect(pending).resolves.toBe('error');
  });

  it('times out when ready never arrives', async () => {
    vi.useFakeTimers();
    const { host } = mockHost('installing');
    const pending = waitForHostReady(host, { timeoutMs: 500 });
    await vi.advanceTimersByTimeAsync(500);
    await expect(pending).resolves.toBe('timeout');
    vi.useRealTimers();
  });

  it('exports a multi-minute default timeout for cold installs', () => {
    expect(HOST_READY_TIMEOUT_MS).toBeGreaterThanOrEqual(180_000);
  });
});
