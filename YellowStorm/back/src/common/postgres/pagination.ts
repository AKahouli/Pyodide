import { sql, type AnyColumn, type SQL } from 'drizzle-orm';

export interface PageOptions {
  limit?: number;
  offset?: number;
}

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

/** Clamp limit/offset to safe bounds. */
export function pageParams(options: PageOptions): { limit: number; offset: number } {
  return {
    limit: Math.min(Math.max(Math.trunc(options.limit ?? DEFAULT_PAGE_LIMIT), 1), MAX_PAGE_LIMIT),
    offset: Math.max(Math.trunc(options.offset ?? 0), 0),
  };
}

/** Window column for rows + total in a single round trip (replaces Mongo $facet). */
export function countOver(): SQL<number> {
  return sql<number>`count(*) over()`;
}

/**
 * Split rows that selected countOver() into items + total. pg returns bigint
 * counts as strings, so coerce.
 *
 * count(*) over() only appears on returned rows, so a page past the end
 * (offset > 0, no rows) would report total 0. Pass `offset` and a `count`
 * thunk (plain COUNT(*) with the same WHERE) and it is run only in that case.
 */
export async function pageOf<T extends { total?: number | string | null }>(
  rows: T[],
  fallback?: { offset: number; count: () => Promise<number | string> },
): Promise<{ items: Omit<T, 'total'>[]; total: number }> {
  const items = rows.map(({ total: _total, ...item }) => item);
  if (rows.length === 0 && fallback && fallback.offset > 0) {
    return { items, total: Number(await fallback.count()) };
  }
  return { items, total: Number(rows[0]?.total ?? 0) };
}

/**
 * Keyset ("seek") predicate for DESC ordering on `cursorCols`: rows strictly
 * after the cursor, i.e. `(a, b) < ($1, $2)`. Use with ORDER BY a DESC, b DESC.
 */
export function keysetAfter(cursorCols: (AnyColumn | SQL)[], cursor: unknown[]): SQL {
  if (cursorCols.length === 0 || cursorCols.length !== cursor.length) {
    throw new Error('keysetAfter: cursorCols and cursor must be non-empty and the same length');
  }
  const cols = sql.join(cursorCols.map((c) => sql`${c}`), sql`, `);
  const vals = sql.join(cursor.map((v) => sql`${v}`), sql`, `);
  return sql`(${cols}) < (${vals})`;
}
