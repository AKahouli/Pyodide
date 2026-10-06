import type { BrowserRuntimeHost } from './BrowserRuntimeHost';
import type { RuntimeHostStatus } from './runtime.types';

/** Cold npm install in NodePod can take several minutes on heavy templates. */
export const HOST_READY_TIMEOUT_MS = 300_000;

export type HostReadyOutcome = 'ready' | 'error' | 'timeout' | 'destroyed';

const TERMINAL: ReadonlySet<RuntimeHostStatus> = new Set(['ready', 'error']);

/**
 * Resolves when BrowserRuntimeHost reaches `ready` (post register) or fails.
 * Used to defer the first agent turn until MCP tools can reach the browser.
 */
export function waitForHostReady(
  host: BrowserRuntimeHost,
  options: { timeoutMs?: number } = {},
): Promise<HostReadyOutcome> {
  const timeoutMs = options.timeoutMs ?? HOST_READY_TIMEOUT_MS;
  const status = host.state.status;
  if (status === 'ready') return Promise.resolve('ready');
  if (status === 'error') return Promise.resolve('error');

  return new Promise((resolve) => {
    let settled = false;
    const finish = (outcome: HostReadyOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      resolve(outcome);
    };

    const timer = setTimeout(() => finish('timeout'), timeoutMs);
    const unsubscribe = host.subscribe((state) => {
      if (state.status === 'ready') finish('ready');
      else if (state.status === 'error') finish('error');
    });

    // Re-check after subscribe in case status flipped during setup.
    const now = host.state.status;
    if (TERMINAL.has(now)) {
      finish(now === 'ready' ? 'ready' : 'error');
    }
  });
}
