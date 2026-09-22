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
  'terminating connection',
  'idle-in-transaction',
  'server closed the connection unexpectedly',
] as const;

/**
 * PostgreSQL SQLSTATEs (matched exactly on `error.code`, or as a token in the
 * message) that mean the session was lost or could not be established.
 */
const TRANSIENT_SQLSTATES = new Set([
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now
  '57P05', // idle_session_timeout
  '25P03', // idle_in_transaction_session_timeout
  '08000', // connection_exception
  '08001', // sqlclient_unable_to_establish_sqlconnection
  '08003', // connection_does_not_exist
  '08004', // sqlserver_rejected_establishment_of_sqlconnection
  '08006', // connection_failure
]);

const SQLSTATE_TOKEN = /\b[0-9A-Z]{5}\b/g;

/** Walk err → cause → cause.cause: drizzle wraps the underlying pg error. */
function* errorChain(error: Error): Generator<Error> {
  let current: unknown = error;
  for (let depth = 0; depth < 3 && current instanceof Error; depth++) {
    yield current;
    current = (current as { cause?: unknown }).cause;
  }
}

export function isTransientConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  for (const candidate of errorChain(error)) {
    const rawCode = (candidate as NodeJS.ErrnoException).code;
    const code = typeof rawCode === 'string' ? rawCode : undefined;
    if (code && TRANSIENT_SQLSTATES.has(code)) return true;
    const message = `${candidate.message} ${code ?? ''}`;
    if (TRANSIENT_CONNECTION_ERROR_PATTERNS.some((pattern) => message.includes(pattern))) return true;
    if ((message.match(SQLSTATE_TOKEN) ?? []).some((token) => TRANSIENT_SQLSTATES.has(token))) return true;
  }
  return false;
}
