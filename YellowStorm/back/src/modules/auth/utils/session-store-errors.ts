/**
 * Classification of MongoDB session-store failures during authentication.
 *
 * A transient dependency failure (network partition, server selection timeout,
 * pool/topology shutdown) is NOT proof that a session was revoked. Callers must
 * surface it as a typed 503 so clients preserve their credentials and retry,
 * instead of destroying a valid login context.
 */

interface MongoErrorShape {
  name?: string;
  code?: number;
  message?: string;
}

/** Mongo driver/topology error names treated as transient dependency failures. */
const TRANSIENT_ERROR_NAMES = new Set([
  'MongoServerSelectionError',
  'MongoNetworkError',
  'MongoNetworkTimeoutError',
  'MongoPoolClearedError',
  'MongoTopologyClosedError',
  'MongoConnectionClosedError' /* legacy driver name */,
  'MongooseServerSelectionError',
]);

/** Driver-level error codes treated as transient dependency failures. */
const TRANSIENT_ERROR_CODES = new Set([
  6, // HostNotFound
  7, // HostUnreachable
  89, // NetworkTimeout
  91, // ShutdownInProgress
  134, // FailedToSatisfyReadPreference (topology candidates exhausted)
  13435, // NotPrimaryNoSecondaryOk (legacy)
  11600, // InterruptedAtShutdown
  11602, // InterruptedDueToReplStateChange
]);

/** Substrings in raw messages that indicate transient connectivity loss. */
const TRANSIENT_MESSAGE_PATTERNS = [
  'server selection timed out',
  'topology was destroyed',
  'connection timed out',
  'connection closed',
  'connection refused',
  'socket hang up',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'pool was cleared',
  'endless pool',
  'monitored connection is unhealthy',
];

/**
 * Returns true when the error represents a transient session-store
 * availability problem rather than an authoritative auth outcome or an
 * unexpected programming error.
 */
export function isTransientSessionStoreError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const candidate = error as MongoErrorShape;
  if (candidate.name && TRANSIENT_ERROR_NAMES.has(candidate.name)) {
    return true;
  }

  if (typeof candidate.code === 'number' && TRANSIENT_ERROR_CODES.has(candidate.code)) {
    return true;
  }

  if (typeof candidate.name === 'string' && /timeout/i.test(candidate.name)) {
    return true;
  }

  const message = candidate.message ?? '';
  return TRANSIENT_MESSAGE_PATTERNS.some((pattern) => message.includes(pattern));
}

/** Sanitized error class for logs/metrics — never includes connection strings or tokens. */
export function classifySessionStoreError(error: unknown): string {
  if (error && typeof error === 'object') {
    const candidate = error as MongoErrorShape;
    if (candidate.name && typeof candidate.name === 'string') {
      return candidate.name;
    }
  }
  return 'UnknownSessionStoreError';
}
