/**
 * Error signatures that indicate a dropped or unavailable external connection
 * (e.g. Postgres restart, network blip, server-side timeout). These are
 * transient: the pool/client layer reconnects on demand, so the process must
 * stay alive instead of shutting down on an uncaught exception.
 */
const TRANSIENT_CONNECTION_ERROR_PATTERNS = [
  'Connection terminated unexpectedly',
  'Connection terminated',
  'Connection error',
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'ETIMEDOUT',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
  '57P01',
  'the database system is starting up',
] as const;

export function isTransientConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  const message = `${error.message} ${code ?? ''}`;
  return TRANSIENT_CONNECTION_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}
