import { sql, type SQL } from 'drizzle-orm';

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
 * ponytail: an empty page (offset past the last row) reports total 0 because
 * count(*) over() only appears on returned rows; re-query COUNT separately if
 * a consumer needs exact totals there.
 */
export function pageOf<T extends { total?: number | string | null }>(
  rows: T[],
): { items: Omit<T, 'total'>[]; total: number } {
  const items = rows.map(({ total: _total, ...item }) => item);
  return { items, total: Number(rows[0]?.total ?? 0) };
}
