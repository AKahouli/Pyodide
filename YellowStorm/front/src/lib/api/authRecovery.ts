/**
 * Auth recovery coordination (shared by the axios client, bootstrap, and SSE).
 *
 * A transient failure (offline, timeout, 429, 5xx, dependency outage) is NOT an
 * authentication denial: credentials must be preserved and the UI enters a
 * retryable recovering state. Only definitive credential/account outcomes may
 * clear auth. This module owns the classification and the recovery state; it
 * must not import the axios client (the client imports it).
 */

export type AuthRecoveryState = 'idle' | 'recovering' | 'unavailable';

/** Typed recoverable failure: callers may retry; it is not a logout. */
export class AuthTransientError extends Error {
  readonly code = 'AUTH_TRANSIENT';

  constructor(message = 'Authentication is temporarily unavailable. Retrying…') {
    super(message);
    this.name = 'AuthTransientError';
  }
}

/** Codes that authoritatively deny the credential or the account. */
const DEFINITIVE_AUTH_CODES = new Set([
  'ERR_1100', // invalid credentials
  'ERR_1103', // session expired
  'ERR_1106', // session not found
  'ERR_1107', // refresh token invalid (covers missing/invalidated session)
  'ERR_1108', // refresh token expired
  'ERR_1110', // account suspended
  'ERR_1112', // invalid token
  'ERR_1113', // session revoked
  'ERR_1003', // generic unauthorized — authoritative 401 from auth endpoints
]);

/** Retryable rotation-conflict outcome: never a credential denial. */
const TRANSIENT_AUTH_CODES = new Set([
  'ERR_1131', // refresh rotation conflict — retry with the same attempt id
  'ERR_1130', // auth dependency unavailable
  'ERR_1008', // service unavailable
]);

interface ApiErrorShape {
  code?: string;
  statusCode?: number;
}

function toApiErrorShape(error: unknown): ApiErrorShape | null {
  if (error && typeof error === 'object' && ('code' in error || 'statusCode' in error)) {
    return error as ApiErrorShape;
  }
  return null;
}

/**
 * True when the failure is transient (transport/dependency) and must not
 * destroy the login context. Definitive auth denials return false.
 */
export function isTransientAuthFailure(error: unknown): boolean {
  if (error instanceof AuthTransientError) {
    return true;
  }

  const shape = toApiErrorShape(error);
  if (!shape) {
    // Raw network/timeout failures carry no response envelope.
    return true;
  }

  const { code, statusCode } = shape;
  if (code === 'ERR_NETWORK' || code === 'AUTH_TRANSIENT' || code === 'ECONNABORTED') {
    return true;
  }

  if (code && DEFINITIVE_AUTH_CODES.has(code)) {
    return false;
  }

  if (code && TRANSIENT_AUTH_CODES.has(code)) {
    return true;
  }

  // No HTTP response at all (timeout/offline/DNS) → transient.
  if (statusCode === undefined || statusCode === 0) {
    return true;
  }

  if (statusCode === 429 || statusCode >= 500) {
    return true;
  }

  return false;
}

export function isDefinitiveAuthFailure(error: unknown): boolean {
  return !isTransientAuthFailure(error);
}

// ---------------------------------------------------------------------------
// Recovery state + listeners
// ---------------------------------------------------------------------------

let recoveryState: AuthRecoveryState = 'idle';
let authGeneration = 0;
const stateListeners = new Set<(state: AuthRecoveryState) => void>();

export function getAuthRecoveryState(): AuthRecoveryState {
  return recoveryState;
}

export function subscribeAuthRecovery(listener: (state: AuthRecoveryState) => void): () => void {
  stateListeners.add(listener);
  return () => stateListeners.delete(listener);
}

function setState(next: AuthRecoveryState): void {
  if (recoveryState === next) {
    return;
  }
  recoveryState = next;
  stateListeners.forEach((listener) => listener(recoveryState));
}

/** Refresh attempt in flight; protected traffic is being retried. */
export function notifyAuthRecovering(): void {
  setState('recovering');
}

/** A protected/authenticated request succeeded again. */
export function notifyAuthRecovered(): void {
  stopUnavailableTimers();
  setState('idle');
}

/** Transient dependency failure; credentials are preserved. */
export function notifyAuthUnavailable(): void {
  setState('unavailable');
  startUnavailableTimers();
}

/** Logout / definitive expiry / account switch: cancel recovery activity. */
export function resetAuthRecovery(): void {
  stopUnavailableTimers();
  setState('idle');
}

/**
 * Generation counter incremented on logout/account switch so a late refresh
 * response cannot restore auth state that the user explicitly ended.
 */
export function bumpAuthGeneration(): number {
  authGeneration += 1;
  return authGeneration;
}

export function getAuthGeneration(): number {
  return authGeneration;
}

// ---------------------------------------------------------------------------
// Foreground recovery loop while unavailable
// ---------------------------------------------------------------------------

const PROBE_THROTTLE_MS = 5_000;
const UNAVAILABLE_PROBE_INTERVAL_MS = 15_000;

type RecoveryProbe = () => Promise<void>;
let recoveryProbe: RecoveryProbe | null = null;
let probeInFlight = false;
let lastProbeAt = 0;
let probeTimer: number | null = null;

/** Register the (client-provided) probe used to revalidate auth while unavailable. */
export function registerRecoveryProbe(probe: RecoveryProbe | null): void {
  recoveryProbe = probe;
}

async function runRecoveryProbe(force = false): Promise<void> {
  if (!recoveryProbe || probeInFlight || recoveryState === 'idle') {
    return;
  }
  const now = Date.now();
  if (!force && now - lastProbeAt < PROBE_THROTTLE_MS) {
    return;
  }
  lastProbeAt = now;
  probeInFlight = true;
  try {
    await recoveryProbe();
  } catch {
    // The probe outcome is applied by the axios client via notify* helpers.
  } finally {
    probeInFlight = false;
  }
}

function startUnavailableTimers(): void {
  if (typeof window === 'undefined' || probeTimer !== null) {
    return;
  }
  probeTimer = window.setInterval(() => {
    void runRecoveryProbe();
  }, UNAVAILABLE_PROBE_INTERVAL_MS);
  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisibility);
}

function stopUnavailableTimers(): void {
  if (typeof window === 'undefined') {
    return;
  }
  if (probeTimer !== null) {
    window.clearInterval(probeTimer);
    probeTimer = null;
  }
  window.removeEventListener('online', onOnline);
  document.removeEventListener('visibilitychange', onVisibility);
}

function onOnline(): void {
  // navigator.onLine is only a hint: the probe's HTTP result decides recovery.
  void runRecoveryProbe(true);
}

function onVisibility(): void {
  if (!document.hidden) {
    void runRecoveryProbe(true);
  }
}
