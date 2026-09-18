import { AsyncLocalStorage } from 'async_hooks';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { NodePgDatabase, NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgTransaction } from 'drizzle-orm/pg-core';

const txStorage = new AsyncLocalStorage<{ db: unknown; tx: unknown }>();

export type PgTx<TSchema extends Record<string, unknown>> = PgTransaction<
  NodePgQueryResultHKT,
  TSchema,
  ExtractTablesWithRelations<TSchema>
>;

export type PgQueryable<TSchema extends Record<string, unknown>> = NodePgDatabase<TSchema> | PgTx<TSchema>;

/**
 * Run `fn` inside a transaction, or join the ambient transaction when already
 * inside an outer withTransaction() on the SAME db. A nested call on a
 * different db opens its own transaction (the ambient one belongs to another
 * pool and must not be reused).
 */
export async function withTransaction<TSchema extends Record<string, unknown>, R>(
  db: NodePgDatabase<TSchema>,
  fn: (tx: PgTx<TSchema>) => Promise<R>,
): Promise<R> {
  const ambient = txStorage.getStore();
  if (ambient?.db === db) return fn(ambient.tx as PgTx<TSchema>);
  return db.transaction((tx) => txStorage.run({ db, tx }, () => fn(tx)));
}

/** The ambient transaction when inside withTransaction() on this db, otherwise the db itself. */
export function resolveQueryable<TSchema extends Record<string, unknown>>(
  db: NodePgDatabase<TSchema>,
): PgQueryable<TSchema> {
  const ambient = txStorage.getStore();
  return (ambient?.db === db ? (ambient.tx as PgTx<TSchema>) : undefined) ?? db;
}
