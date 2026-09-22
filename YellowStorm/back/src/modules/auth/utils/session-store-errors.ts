/**
 * Classification of session-store failures during authentication.
 *
 * A transient dependency failure (Postgres restart, network partition,
 * connection loss) is NOT proof that a session was revoked. Callers must
 * surface it as a typed 503 so clients preserve their credentials and retry,
 * instead of destroying a valid login context.
 *
 * The session store lives in Postgres (identity.sessions), so detection is
 * delegated to the shared Postgres transient-error matcher, which unwraps
 * drizzle's error.cause chain (remediation plan 3.3 / R-09).
 */
import { isTransientConnectionError } from '@common/utils/transient-connection-error';

/**
 * Returns true when the error represents a transient session-store
 * availability problem rather than an authoritative auth outcome or an
 * unexpected programming error.
 */
export function isTransientSessionStoreError(error: unknown): boolean {
  return isTransientConnectionError(error);
}

/** Sanitized error class for logs/metrics — never includes connection strings or tokens. */
export function classifySessionStoreError(error: unknown): string {
  if (error && typeof error === 'object') {
    // Prefer the underlying pg SQLSTATE (drizzle wraps it in cause) over the
    // generic wrapper name.
    let topName: string | undefined;
    let current: unknown = error;
    for (let depth = 0; depth < 3 && current && typeof current === 'object'; depth++) {
      const candidate = current as { code?: unknown; name?: unknown; cause?: unknown };
      if (typeof candidate.code === 'string' && /^[0-9A-Z]{5}$/.test(candidate.code)) {
        return candidate.code;
      }
      if (depth === 0 && typeof candidate.name === 'string' && candidate.name) {
        topName = candidate.name;
      }
      current = candidate.cause;
    }
    if (topName) return topName;
  }
  return 'UnknownSessionStoreError';
}
