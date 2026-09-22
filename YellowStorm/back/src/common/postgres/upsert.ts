import { getTableColumns, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { PgQueryable } from './transaction';

const CHUNK_SIZE = 1000;

/**
 * Batched INSERT … ON CONFLICT DO UPDATE. `target` is the conflict constraint's
 * columns; `updateColumns` are TS property names on the table object, each set
 * to its `excluded` value.
 */
export async function upsertMany<TSchema extends Record<string, unknown>, TTable extends PgTable>(
  db: PgQueryable<TSchema>,
  table: TTable,
  rows: TTable['$inferInsert'][],
  target: AnyPgColumn[],
  updateColumns: string[],
): Promise<void> {
  if (rows.length === 0) return;
  const columns = getTableColumns(table) as Record<string, AnyPgColumn | undefined>;
  const set: Record<string, SQL> = {};
  for (const name of updateColumns) {
    const column = columns[name];
    if (!column) throw new Error(`upsertMany: unknown column '${name}'`);
    set[name] = sql`excluded.${sql.identifier(column.name)}`;
  }
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    await db
      .insert(table)
      .values(rows.slice(i, i + CHUNK_SIZE))
      .onConflictDoUpdate({ target, set });
  }
}
