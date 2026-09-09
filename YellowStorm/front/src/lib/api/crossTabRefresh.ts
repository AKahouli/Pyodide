/**
 * Cross-tab refresh coordination.
 *
 * Browser coordination is an optimization: the server's atomic rotation and
 * rotation-conflict response remain the correctness boundary. Web Locks
 * serialize same-origin refreshes so tabs do not stampede the endpoint;
 * BroadcastChannel spreads non-secret completion/logout signals so stale tabs
 * pick up a newer token instead of starting their own rotation. When the Web
 * Locks API is unavailable the delegate runs directly — a failed lock must
 * never deadlock recovery.
 */

const LOCK_NAME = 'yellostorm.auth.refresh';
const CHANNEL_NAME = 'yellostorm.auth';
const ATTEMPT_STORAGE_KEY = 'yellostorm_refresh_attempt';

export type AuthBroadcastType = 'refreshed' | 'logout';

let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') {
    return null;
  }
  if (!channel) {
    channel = new BroadcastChannel(CHANNEL_NAME);
  }
  return channel;
}

/** Generate an id matching the server's X-Refresh-Attempt-Id grammar. */
function generateAttemptId(): string {
  const bytes = new Uint8Array(12);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Identity for the pending rotation. Persisted BEFORE dispatch so a
 * crashed/closed tab loses the operation identity, and reused for retries of
 * the SAME rotation so the server can serve the receipt path.
 */
export function beginRefreshAttempt(): string {
  const existing = sessionStorage.getItem(ATTEMPT_STORAGE_KEY);
  if (existing && /^[A-Za-z0-9_-]{8,64}$/.test(existing)) {
    return existing;
  }
  const attemptId = generateAttemptId();
  sessionStorage.setItem(ATTEMPT_STORAGE_KEY, attemptId);
  return attemptId;
}

/** A retry of the same logical rotation keeps the original attempt identity. */
export function keepRefreshAttempt(): string {
  return beginRefreshAttempt();
}

export function clearRefreshAttempt(): void {
  sessionStorage.removeItem(ATTEMPT_STORAGE_KEY);
}

/**
 * Run `fn` under an exclusive same-origin refresh lock. Acquisition waits
 * while another tab holds the lock; the hold time is bounded in practice by
 * the owner's work (two 10s HTTP budgets + conflict retry). The server's
 * atomic rotation remains the correctness boundary if this API is unavailable
 * or contended beyond that.
 */
export async function withCrossTabRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
  if (typeof navigator === 'undefined' || !navigator.locks?.request) {
    return fn();
  }
  return navigator.locks.request(LOCK_NAME, { ifAvailable: false }, fn);
}

export function broadcastAuthEvent(type: AuthBroadcastType): void {
  try {
    getChannel()?.postMessage({ type });
  } catch {
    // Channel unavailable/closed: server coordination still guarantees correctness.
  }
}

export function subscribeAuthBroadcast(
  handler: (type: AuthBroadcastType) => void,
): () => void {
  const ch = getChannel();
  if (!ch) {
    return () => undefined;
  }
  const listener = (event: MessageEvent) => {
    const type = (event.data as { type?: AuthBroadcastType } | null)?.type;
    if (type === 'refreshed' || type === 'logout') {
      handler(type);
    }
  };
  ch.addEventListener('message', listener);
  return () => ch.removeEventListener('message', listener);
}
