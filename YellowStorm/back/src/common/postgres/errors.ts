/** Postgres SQLSTATE for unique_violation. */
export const PG_UNIQUE_VIOLATION = '23505';

interface PgErrorLike {
  code?: unknown;
  constraint?: unknown;
  cause?: unknown;
}

/** The underlying pg error: drizzle may wrap it as `err.cause`. */
function pgError(err: unknown): PgErrorLike | null {
  let current: unknown = err;
  for (let depth = 0; depth < 3 && current && typeof current === 'object'; depth++) {
    const candidate = current as PgErrorLike;
    if (typeof candidate.code === 'string' && /^[0-9A-Z]{5}$/.test(candidate.code)) return candidate;
    current = candidate.cause;
  }
  return null;
}

/**
 * True when `err` (or its drizzle-wrapped cause) is a unique violation,
 * optionally restricted to a named constraint/index.
 */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const pg = pgError(err);
  if (pg?.code !== PG_UNIQUE_VIOLATION) return false;
  return constraint === undefined || pg.constraint === constraint;
}
