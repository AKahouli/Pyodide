import { sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { isObjectId, normalizeObjectId } from '@common/postgres';

/** Drops null / undefined entries: optional fields are absent on the records, not null. */
export function defined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null && v !== undefined)) as T;
}

/**
 * Scope visibility: a row is visible when one of its scopes overlaps the caller's
 * accessible scopes, or when it has no scope at all. `*` (or no list) sees everything.
 */
export function scopeFilter(column: PgColumn, scopeIds: string[] | undefined): SQL | undefined {
  if (!scopeIds || scopeIds.includes('*')) return undefined;
  const ids = scopeIds.filter(isObjectId).map(normalizeObjectId);
  if (!ids.length) return sql`cardinality(${column}) = 0`;
  return sql`(${column} && ARRAY[${sql.join(ids.map((id) => sql`${id}`), sql`, `)}]::char(24)[] OR cardinality(${column}) = 0)`;
}

/** Ids reach these queries from callers that used to cast them to ObjectId (and threw on garbage). */
export function ids(values: string[]): string[] {
  return values.filter(isObjectId).map(normalizeObjectId);
}
